import { createClerkClient, verifyToken } from "@clerk/backend";
import {
  ADMIN_EMAIL,
  applyTrialHeartbeat,
  computeEntitlement,
  emptyTrial,
  generateAccessCode,
  isAdminEmail,
  normalizeCode,
  normalizeEmail,
  formatDate,
  mergeCodeGrant,
  mergeStripeSubscription,
  redeemCode,
  signUnlockToken,
  stripePeriodEnd,
  stripePriceId,
  type BillingMeta,
  timingSafeEqual,
  type AccessCode,
  type Entitlement,
  type TrialRecord,
} from "../src/billing";

export interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  MADDFLIGHT: KVNamespace;
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET?: string;
  UNLOCK_HMAC_SECRET: string;
  TRIAL_DEBUG_SECRET?: string;
  GOOGLE_MAPS_API_KEY?: string;
  STRIPE_PRICE_MONTHLY: string;
  STRIPE_PRICE_YEARLY: string;
  ENVIRONMENT?: string;
}

const TRIAL_KEY = (userId: string) => `trial:${userId}`;
const CODE_KEY = (code: string) => `code:${code}`;
const CODE_INDEX = "codes:index";
const SITE = "https://maddflight.maddisonempire.com";

type ClerkUser = {
  id: string;
  email: string | null;
  emails: string[];
  /** True only when a *verified* email on the account is ADMIN_EMAIL. */
  isAdmin: boolean;
  firstName?: string | null;
  publicMetadata: Record<string, unknown>;
  privateMetadata: Record<string, unknown>;
};

type FlightMeta = BillingMeta;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function clerk(env: Env) {
  return createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
}

async function requireUser(request: Request, env: Env): Promise<ClerkUser | Response> {
  const header = request.headers.get("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7) : "";
  if (!token) return json({ error: "Sign in required." }, 401);
  try {
    const payload = await verifyToken(token, {
      secretKey: env.CLERK_SECRET_KEY,
      authorizedParties: ["https://maddflight.maddisonempire.com"],
    });
    const userId = payload.sub;
    if (!userId) return json({ error: "Sign in required." }, 401);
    const user = await clerk(env).users.getUser(userId);
    const emails = user.emailAddresses.map((e) => normalizeEmail(e.emailAddress)).filter(Boolean);
    const verifiedEmails = user.emailAddresses
      .filter((e) => e.verification?.status === "verified")
      .map((e) => normalizeEmail(e.emailAddress))
      .filter(Boolean);
    const primary = user.primaryEmailAddressId
      ? user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress
      : emails[0];
    return {
      id: user.id,
      email: primary ? normalizeEmail(primary) : emails[0] || null,
      emails,
      isAdmin: verifiedEmails.some((e) => isAdminEmail(e)),
      firstName: user.firstName,
      publicMetadata: (user.publicMetadata || {}) as Record<string, unknown>,
      privateMetadata: (user.privateMetadata || {}) as Record<string, unknown>,
    };
  } catch {
    return json({ error: "Sign in required." }, 401);
  }
}

function isResponse(value: ClerkUser | Response): value is Response {
  return value instanceof Response;
}

function readMeta(user: ClerkUser): FlightMeta {
  const pub = (user.publicMetadata.maddflight || {}) as FlightMeta;
  const pri = (user.privateMetadata.maddflight || {}) as FlightMeta;
  return { ...pub, ...pri };
}

/** Read-modify-write of the stored billing state. */
async function updateMeta(env: Env, userId: string, fn: (meta: FlightMeta) => FlightMeta) {
  const user = await clerk(env).users.getUser(userId);
  const pub = (user.publicMetadata?.maddflight || {}) as FlightMeta;
  const pri = (user.privateMetadata?.maddflight || {}) as FlightMeta;
  const next = fn({ ...pub, ...pri });
  await clerk(env).users.updateUserMetadata(userId, {
    publicMetadata: { maddflight: { ...pub, ...next } },
    privateMetadata: { maddflight: { ...pri, ...next } },
  });
  return next;
}

async function writeMeta(env: Env, userId: string, patch: FlightMeta) {
  const user = await clerk(env).users.getUser(userId);
  const pub = { ...((user.publicMetadata.maddflight || {}) as object), ...patch };
  const pri = { ...((user.privateMetadata.maddflight || {}) as object), ...patch };
  await clerk(env).users.updateUserMetadata(userId, {
    publicMetadata: { maddflight: pub },
    privateMetadata: { maddflight: pri },
  });
}

async function loadTrial(env: Env, userId: string): Promise<TrialRecord> {
  const raw = await env.MADDFLIGHT.get(TRIAL_KEY(userId), "json");
  if (!raw || typeof raw !== "object") return emptyTrial();
  const rec = raw as TrialRecord;
  return { ms: Number(rec.ms) || 0, updatedAt: Number(rec.updatedAt) || 0 };
}

async function saveTrial(env: Env, userId: string, record: TrialRecord) {
  await env.MADDFLIGHT.put(TRIAL_KEY(userId), JSON.stringify(record));
}

function entitlementFor(user: ClerkUser, trial: TrialRecord, now: number): Entitlement {
  const meta = readMeta(user);
  return computeEntitlement({
    trial,
    admin: user.isAdmin,
    plan: meta.plan,
    periodEnd: meta.periodEnd ?? null,
    lifetime: meta.lifetime,
    cancelAtPeriodEnd: meta.cancelAtPeriodEnd,
    hasSubscription: Boolean(meta.stripeSubscriptionId && meta.subPlan),
    now,
  });
}

function canFly(ent: Entitlement): boolean {
  return ent.entitled || ent.trialRemainingMs > 0;
}

async function signToken(env: Env, user: ClerkUser, ent: Entitlement): Promise<string | null> {
  if (!ent.entitled) return null;
  return signUnlockToken(env.UNLOCK_HMAC_SECRET, {
    sub: user.id,
    plan: ent.plan,
    exp: ent.lifetime ? nowPlusYears(10) : ent.periodEnd || nowPlusYears(1),
    lifetime: ent.lifetime,
  });
}

function nowPlusYears(years: number): number {
  return Date.now() + years * 365 * 24 * 60 * 60 * 1000;
}

async function publicEntitlement(env: Env, user: ClerkUser, trial: TrialRecord, now: number) {
  const entitlement = entitlementFor(user, trial, now);
  const token = await signToken(env, user, entitlement);
  return {
    userId: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
    ...entitlement,
    token,
  };
}

async function stripe(
  env: Env,
  method: string,
  path: string,
  params?: Record<string, string>,
) {
  const body = params ? new URLSearchParams(params) : undefined;
  const res = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: { message?: string } }).error?.message || "Stripe request failed.";
    const err = new Error(message);
    (err as Error & { status: number }).status = 502;
    throw err;
  }
  return data as Record<string, unknown>;
}

function knownPrice(env: Env, priceId: string): "pro-month" | "pro-year" | null {
  if (priceId === env.STRIPE_PRICE_MONTHLY) return "pro-month";
  if (priceId === env.STRIPE_PRICE_YEARLY) return "pro-year";
  return null;
}

async function handleConfig(env: Env) {
  return json({
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    trialMinutes: 5,
    prices: {
      month: { id: env.STRIPE_PRICE_MONTHLY, amount: 499, interval: "month", label: "$4.99 / month" },
      year: { id: env.STRIPE_PRICE_YEARLY, amount: 2999, interval: "year", label: "$29.99 / year" },
    },
  });
}

async function handleEntitlement(request: Request, env: Env) {
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  const trial = await loadTrial(env, user.id);
  return json(await publicEntitlement(env, user, trial, Date.now()));
}

async function handleHeartbeat(request: Request, env: Env) {
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  const body = (await request.json().catch(() => ({}))) as {
    elapsedMs?: number;
    debugExpire?: boolean;
  };
  const debugHeader = request.headers.get("x-maddflight-debug") || "";
  const debugOk = Boolean(env.TRIAL_DEBUG_SECRET && timingSafeEqual(debugHeader, env.TRIAL_DEBUG_SECRET));
  let trial = await loadTrial(env, user.id);
  const now = Date.now();
  if (body.debugExpire && debugOk) {
    trial = { ms: 5 * 60 * 1000, updatedAt: now };
  } else {
    trial = applyTrialHeartbeat(trial, Number(body.elapsedMs) || 0, now);
  }
  await saveTrial(env, user.id, trial);
  return json(await publicEntitlement(env, user, trial, now));
}

async function handleMapsKey(request: Request, env: Env) {
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  const trial = await loadTrial(env, user.id);
  const ent = entitlementFor(user, trial, Date.now());
  if (!canFly(ent)) return json({ error: "A Pro subscription or remaining trial is required." }, 403);
  if (!env.GOOGLE_MAPS_API_KEY) return json({ error: "Google 3D is not configured." }, 503);
  return json({ key: env.GOOGLE_MAPS_API_KEY });
}

async function ensureCustomer(env: Env, user: ClerkUser): Promise<string> {
  const meta = readMeta(user);
  if (meta.stripeCustomerId) return meta.stripeCustomerId;
  const created = (await stripe(env, "POST", "/v1/customers", {
    email: user.email || "",
    name: user.firstName || user.email || "Madd Flight pilot",
    "metadata[clerk_user_id]": user.id,
  })) as { id: string };
  await writeMeta(env, user.id, { stripeCustomerId: created.id });
  return created.id;
}

async function handleCheckout(request: Request, env: Env) {
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  const body = (await request.json().catch(() => ({}))) as { priceId?: string };
  const plan = knownPrice(env, body.priceId || "");
  if (!plan) return json({ error: "Choose the monthly or yearly Madd-Flight Pro plan." }, 400);
  const existing = readMeta(user);
  if (existing.subPlan && existing.subPeriodEnd && existing.subPeriodEnd > Date.now() && !existing.cancelAtPeriodEnd) {
    return json({ error: "You already have an active Madd-Flight Pro subscription." }, 409);
  }
  const customer = await ensureCustomer(env, user);
  const params: Record<string, string> = {
    mode: "subscription",
    customer,
    client_reference_id: user.id,
    "line_items[0][price]": body.priceId!,
    "line_items[0][quantity]": "1",
    success_url: `${SITE}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE}/?checkout=cancel`,
    "metadata[clerk_user_id]": user.id,
    "subscription_data[metadata][clerk_user_id]": user.id,
    "subscription_data[metadata][plan]": plan,
    "automatic_tax[enabled]": "false",
    "managed_payments[enabled]": "false",
  };
  const consent = {
    "consent_collection[terms_of_service]": "required",
    "custom_text[terms_of_service_acceptance][message]":
      "I agree to the [Madd-Flight Terms](https://maddflight.maddisonempire.com/terms): auto-renewing, cancel anytime, no refunds; access continues until the end of the billing period.",
  };
  let session: { id: string; url: string };
  try {
    session = (await stripe(env, "POST", "/v1/checkout/sessions", { ...params, ...consent })) as {
      id: string;
      url: string;
    };
  } catch (err) {
    // Fail-safe: Stripe rejects consent_collection until the account's public
    // terms-of-service URL is set. Never let that break checkout.
    console.warn("checkout: terms consent rejected, retrying without it:", (err as Error).message);
    session = (await stripe(env, "POST", "/v1/checkout/sessions", params)) as { id: string; url: string };
  }
  return json({ id: session.id, url: session.url });
}

export function subscriptionPeriodEnd(sub: Record<string, unknown>): number | null {
  return stripePeriodEnd(sub);
}

function subscriptionPlan(env: Env, sub: Record<string, unknown>): "pro-month" | "pro-year" | null {
  return knownPrice(env, stripePriceId(sub));
}

/** Apply a Stripe subscription to the user's stored state. Keeps any
 * lifetime / longer access-code comp (see mergeStripeSubscription). */
async function grantSubscription(
  env: Env,
  userId: string,
  sub: Record<string, unknown>,
  customerId?: string,
) {
  return updateMeta(env, userId, (meta) =>
    mergeStripeSubscription(meta, sub, subscriptionPlan(env, sub), customerId),
  );
}

/** Cancel at the end of the paid period (or undo that). Never cancels
 * immediately and never prorates or refunds: no refunds, access continues
 * until the current billing period ends. */
async function handleSubscriptionChange(request: Request, env: Env, cancel: boolean) {
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  const meta = readMeta(user);
  const subId = meta.stripeSubscriptionId || "";
  if (!subId.startsWith("sub_")) return json({ error: "No Madd-Flight Pro subscription on this account." }, 404);
  const current = (await stripe(env, "GET", `/v1/subscriptions/${subId}`)) as Record<string, unknown>;
  const owner = (current.metadata as { clerk_user_id?: string } | undefined)?.clerk_user_id;
  if ((owner && owner !== user.id) || (!owner && current.customer !== meta.stripeCustomerId)) {
    return json({ error: "This subscription belongs to a different account." }, 403);
  }
  const status = String(current.status || "");
  if (!["active", "trialing", "past_due"].includes(status)) {
    return json({ error: "This subscription has already ended." }, 409);
  }
  const updated = (await stripe(env, "POST", `/v1/subscriptions/${subId}`, {
    cancel_at_period_end: cancel ? "true" : "false",
  })) as Record<string, unknown>;
  await grantSubscription(env, user.id, updated, meta.stripeCustomerId);
  const fresh = await requireUser(request, env);
  if (isResponse(fresh)) return fresh;
  const trial = await loadTrial(env, user.id);
  const ent = await publicEntitlement(env, fresh, trial, Date.now());
  return json({
    ...ent,
    message: cancel
      ? `Subscription cancelled. No refunds; your access continues until ${ent.periodEnd ? formatDate(ent.periodEnd) : "the end of the billing period"}.`
      : "Subscription resumed. It will renew automatically.",
  });
}

async function handleVerify(request: Request, env: Env) {
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  const sessionId = new URL(request.url).searchParams.get("session_id") || "";
  if (!sessionId.startsWith("cs_")) return json({ error: "Missing checkout session." }, 400);
  const session = (await stripe(env, "GET", `/v1/checkout/sessions/${sessionId}`)) as {
    client_reference_id?: string;
    customer?: string;
    subscription?: string;
    payment_status?: string;
    status?: string;
    metadata?: { clerk_user_id?: string };
  };
  const owner = session.metadata?.clerk_user_id || session.client_reference_id;
  if (owner !== user.id) return json({ error: "This checkout session belongs to a different account." }, 403);
  if (session.status !== "complete" && session.payment_status !== "paid") {
    return json({ error: "Checkout is not complete yet." }, 402);
  }
  if (session.subscription) {
    const sub = (await stripe(env, "GET", `/v1/subscriptions/${session.subscription}`)) as Record<
      string,
      unknown
    >;
    await grantSubscription(env, user.id, sub, session.customer);
  }
  const trial = await loadTrial(env, user.id);
  return json(await publicEntitlement(env, user, trial, Date.now()));
}

async function handleRestore(request: Request, env: Env) {
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  const body = (await request.json().catch(() => ({}))) as { email?: string };
  const email = normalizeEmail(body.email || user.email || "");
  if (!email) return json({ error: "Enter the email used for the Stripe purchase." }, 400);
  if (!user.emails.includes(email)) {
    return json(
      { error: "That email does not match this Clerk account. Sign in with the email you used to pay." },
      403,
    );
  }
  const found = (await stripe(env, "GET", `/v1/customers?email=${encodeURIComponent(email)}&limit=10`)) as {
    data?: Array<{ id: string }>;
  };
  for (const customer of found.data || []) {
    const subs = (await stripe(
      env,
      "GET",
      `/v1/subscriptions?customer=${customer.id}&status=active&limit=10`,
    )) as { data?: Array<Record<string, unknown>> };
    for (const sub of subs.data || []) {
      if (!subscriptionPlan(env, sub) && !knownPrice(env, ((sub.items as { data?: Array<{ price?: { id?: string } }> })?.data || [])[0]?.price?.id || ""))
        continue;
      if (!knownPrice(env, ((sub.items as { data?: Array<{ price?: { id?: string } }> })?.data || [])[0]?.price?.id || ""))
        continue;
      await grantSubscription(env, user.id, sub, customer.id);
      const trial = await loadTrial(env, user.id);
      return json({ restored: true, ...(await publicEntitlement(env, user, trial, Date.now())) });
    }
  }
  return json({ error: "No active Madd-Flight Pro subscription was found for that email." }, 404);
}

async function loadCode(env: Env, code: string): Promise<AccessCode | null> {
  const raw = await env.MADDFLIGHT.get(CODE_KEY(code), "json");
  return raw && typeof raw === "object" ? (raw as AccessCode) : null;
}

async function handleRedeem(request: Request, env: Env) {
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const code = normalizeCode(body.code || "");
  if (!code) return json({ error: "Enter an access code." }, 400);
  const record = await loadCode(env, code);
  if (!record) return json({ error: "That access code was not recognized." }, 404);
  const result = redeemCode(record, user.id, Date.now());
  if (!result.ok) return json({ error: result.error }, 409);
  if (!result.alreadyRedeemed)
    await env.MADDFLIGHT.put(CODE_KEY(code), JSON.stringify({ ...result.record, code }));
  // Merge, never overwrite: lifetime stays lifetime, longer access stays longer,
  // and re-redeeming keeps the original expiry.
  await updateMeta(env, user.id, (meta) =>
    mergeCodeGrant(meta, { lifetime: result.lifetime, periodEnd: result.periodEnd, code }),
  );
  const fresh = await requireUser(request, env);
  if (isResponse(fresh)) return fresh;
  const trial = await loadTrial(env, user.id);
  return json({
    redeemed: true,
    alreadyRedeemed: result.alreadyRedeemed,
    message: result.alreadyRedeemed
      ? result.lifetime
        ? "You already redeemed this code. Your lifetime access is unchanged."
        : `You already redeemed this code. Your access runs until ${formatDate(result.periodEnd!)}.`
      : undefined,
    ...(await publicEntitlement(env, fresh, trial, Date.now())),
  });
}

async function requireAdmin(request: Request, env: Env): Promise<ClerkUser | Response> {
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;
  if (!user.isAdmin) return json({ error: "Admin only." }, 403);
  return user;
}

async function listCodeIndex(env: Env): Promise<string[]> {
  const raw = await env.MADDFLIGHT.get(CODE_INDEX, "json");
  return Array.isArray(raw) ? (raw as string[]) : [];
}

async function handleAdminList(request: Request, env: Env) {
  const user = await requireAdmin(request, env);
  if (isResponse(user)) return user;
  const codes = await listCodeIndex(env);
  const rows = [];
  for (const code of codes) {
    const rec = await loadCode(env, code);
    if (rec) rows.push({ ...rec, code, used: rec.redemptions.length });
  }
  return json({ codes: rows });
}

async function handleAdminCreate(request: Request, env: Env) {
  const user = await requireAdmin(request, env);
  if (isResponse(user)) return user;
  const body = (await request.json().catch(() => ({}))) as {
    type?: string;
    days?: number;
    maxRedemptions?: number;
    code?: string;
  };
  const type = body.type === "days" ? "days" : "lifetime";
  const days = type === "days" ? Math.max(1, Math.min(3650, Number(body.days) || 30)) : undefined;
  const maxRedemptions = Math.max(1, Math.min(10000, Number(body.maxRedemptions) || 1));
  const code = normalizeCode(body.code || generateAccessCode());
  if (await loadCode(env, code)) return json({ error: "That code already exists." }, 409);
  const record: AccessCode = {
    code,
    type,
    days,
    maxRedemptions,
    redemptions: [],
    createdAt: Date.now(),
    createdBy: user.email || user.id,
  };
  await env.MADDFLIGHT.put(CODE_KEY(code), JSON.stringify(record));
  const index = await listCodeIndex(env);
  if (!index.includes(code)) {
    index.unshift(code);
    await env.MADDFLIGHT.put(CODE_INDEX, JSON.stringify(index.slice(0, 500)));
  }
  return json({ code: record });
}

async function applyStripeSubscription(env: Env, sub: Record<string, unknown>) {
  const metadata = (sub.metadata || {}) as { clerk_user_id?: string };
  let userId = metadata.clerk_user_id;
  const customerId = typeof sub.customer === "string" ? sub.customer : "";
  if (!userId && customerId) {
    const customer = (await stripe(env, "GET", `/v1/customers/${customerId}`)) as {
      metadata?: { clerk_user_id?: string };
    };
    userId = customer.metadata?.clerk_user_id;
  }
  if (!userId) return;
  await grantSubscription(env, userId, sub, customerId);
}

/** The Stripe account is shared with Madd Shopping: only subscriptions on the
 * two Madd-Flight Pro prices are ours. Everything else is acknowledged (200)
 * and ignored. */
function isOurSubscription(env: Env, sub: Record<string, unknown>): boolean {
  return Boolean(knownPrice(env, stripePriceId(sub)));
}

function invoiceSubscriptionId(invoice: Record<string, unknown>): string | undefined {
  if (typeof invoice.subscription === "string") return invoice.subscription;
  const parent = invoice.parent as { subscription_details?: { subscription?: string } } | undefined;
  return parent?.subscription_details?.subscription || undefined;
}

async function handleStripeWebhook(request: Request, env: Env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "Webhook secret is not configured." }, 503);
  const sig = request.headers.get("stripe-signature") || "";
  const raw = await request.text();
  if (!(await verifyStripeSignature(raw, sig, env.STRIPE_WEBHOOK_SECRET))) {
    return json({ error: "Invalid signature." }, 400);
  }
  const event = JSON.parse(raw) as { type: string; data: { object: Record<string, unknown> } };
  const obj = event.data.object;
  if (event.type === "checkout.session.completed") {
    const subscriptionId = obj.subscription as string | undefined;
    const userId = (obj.metadata as { clerk_user_id?: string } | undefined)?.clerk_user_id ||
      (obj.client_reference_id as string | undefined);
    // Madd Shopping checkouts carry no Clerk user and no Pro subscription.
    if (subscriptionId && userId) {
      const sub = (await stripe(env, "GET", `/v1/subscriptions/${subscriptionId}`)) as Record<
        string,
        unknown
      >;
      if (isOurSubscription(env, sub)) await grantSubscription(env, userId, sub, obj.customer as string);
    }
  } else if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    if (isOurSubscription(env, obj)) await applyStripeSubscription(env, obj);
  } else if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const subId = invoiceSubscriptionId(obj);
    if (subId) {
      const sub = (await stripe(env, "GET", `/v1/subscriptions/${subId}`)) as Record<string, unknown>;
      if (isOurSubscription(env, sub)) await applyStripeSubscription(env, sub);
    }
  }
  return json({ received: true });
}

async function verifyStripeSignature(payload: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const [k, ...rest] = p.split("=");
      return [k.trim(), rest.join("=")];
    }),
  ) as { t?: string; v1?: string };
  if (!parts.t || !parts.v1) return false;
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!Number.isFinite(age) || age > 60 * 5) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${parts.t}.${payload}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(hex, parts.v1);
}

// Clerk Frontend API proxy: https://maddflight.maddisonempire.com/__clerk/* ->
// https://frontend-api.clerk.dev/*. Keeps every Clerk request and the Google
// OAuth return first-party on maddflight.* (clerk.com/docs proxy-fapi).
const CLERK_PROXY_PATH = "/__clerk";
const CLERK_FAPI_ORIGIN = "https://frontend-api.clerk.dev";

async function handleClerkProxy(request: Request, env: Env, url: URL): Promise<Response> {
  const target = CLERK_FAPI_ORIGIN + (url.pathname.slice(CLERK_PROXY_PATH.length) || "/") + url.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set("Clerk-Proxy-Url", url.origin + CLERK_PROXY_PATH);
  headers.set("Clerk-Secret-Key", env.CLERK_SECRET_KEY);
  headers.set("X-Forwarded-For", request.headers.get("CF-Connecting-IP") || "");
  const hasBody = !["GET", "HEAD"].includes(request.method);
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: "manual",
  });
  // Friendly fallback: if Clerk rejects the Google return, send the user back
  // to the site with a message instead of a raw JSON error page.
  if (url.pathname === CLERK_PROXY_PATH + "/v1/oauth_callback") {
    // Clerk either answers 403 JSON, or redirects to
    // /v1/oauth_callback?err_code=authorization_invalid (outside the proxy path).
    const location = upstream.headers.get("Location") || "";
    const body = upstream.status === 403 ? await upstream.clone().text() : "";
    if (body.includes("authorization_invalid") || location.includes("err_code=")) {
      return new Response(null, {
        status: 302,
        headers: { Location: url.origin + "/?auth_error=google", "Cache-Control": "no-store" },
      });
    }
  }
  return upstream;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/v1/oauth_callback" && url.searchParams.has("err_code")) {
      return new Response(null, { status: 302, headers: { Location: url.origin + "/?auth_error=google" } });
    }
    if (url.pathname === CLERK_PROXY_PATH || url.pathname.startsWith(CLERK_PROXY_PATH + "/")) {
      return handleClerkProxy(request, env, url);
    }
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }
    try {
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const method = request.method;
      if (method === "GET" && path === "/api/config") return await handleConfig(env);
      if (method === "GET" && path === "/api/entitlement") return await handleEntitlement(request, env);
      if (method === "POST" && path === "/api/trial/heartbeat") return await handleHeartbeat(request, env);
      if (method === "GET" && path === "/api/maps-key") return await handleMapsKey(request, env);
      if (method === "POST" && path === "/api/checkout") return await handleCheckout(request, env);
      if (method === "GET" && path === "/api/checkout/verify") return await handleVerify(request, env);
      if (method === "POST" && path === "/api/restore") return await handleRestore(request, env);
      if (method === "POST" && path === "/api/codes/redeem") return await handleRedeem(request, env);
      if (method === "POST" && path === "/api/subscription/cancel")
        return await handleSubscriptionChange(request, env, true);
      if (method === "POST" && path === "/api/subscription/resume")
        return await handleSubscriptionChange(request, env, false);
      if (method === "GET" && path === "/api/admin/codes") return await handleAdminList(request, env);
      if (method === "POST" && path === "/api/admin/codes") return await handleAdminCreate(request, env);
      if (method === "POST" && path === "/api/webhooks/stripe") return await handleStripeWebhook(request, env);
      return json({ error: "Not found." }, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Server error.";
      const status = (err as { status?: number }).status || 500;
      return json({ error: message }, status);
    }
  },
};
