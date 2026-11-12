/** Shared billing/trial helpers used by the Worker and unit tests. */

export const TRIAL_MS = 5 * 60 * 1000;
export const PRICE_AMOUNT_MONTH = 499;
export const PRICE_AMOUNT_YEAR = 2999;

export type AccessCodeType = "lifetime" | "days";

export type AccessCode = {
  code: string;
  type: AccessCodeType;
  days?: number;
  maxRedemptions: number;
  redemptions: { userId: string; at: number }[];
  createdAt: number;
  createdBy: string;
};

export type TrialRecord = {
  ms: number;
  updatedAt: number;
};

export type Entitlement = {
  entitled: boolean;
  reason: "admin" | "subscription" | "code" | "trial" | "none";
  plan: "pro-month" | "pro-year" | "comp" | null;
  periodEnd: number | null;
  lifetime: boolean;
  trialRemainingMs: number;
  trialUsedMs: number;
  /** Subscription set to end at periodEnd (no renewal, no refund). */
  cancelAtPeriodEnd?: boolean;
  /** True when the user has a Stripe subscription they can manage. */
  hasSubscription?: boolean;
};

export type UnlockPayload = {
  sub: string;
  plan: Entitlement["plan"];
  exp: number;
  lifetime?: boolean;
};

export function emptyTrial(): TrialRecord {
  return { ms: 0, updatedAt: 0 };
}

/** Apply a client-reported flight interval, capped so the clock cannot be spoofed forward. */
export function applyTrialHeartbeat(
  record: TrialRecord,
  elapsedMs: number,
  now: number,
): TrialRecord {
  const reported = Math.max(0, Math.min(Number(elapsedMs) || 0, 15_000));
  const sinceUpdate =
    record.updatedAt > 0 ? Math.max(0, now - record.updatedAt) : reported;
  const add = Math.min(reported, sinceUpdate + 2_000);
  return { ms: record.ms + add, updatedAt: now };
}

export function trialRemainingMs(record: TrialRecord, entitled: boolean): number {
  if (entitled) return TRIAL_MS;
  return Math.max(0, TRIAL_MS - record.ms);
}

export function computeEntitlement(input: {
  trial: TrialRecord;
  plan?: Entitlement["plan"];
  periodEnd?: number | null;
  lifetime?: boolean;
  /** Admins (a verified email listed in the Worker ADMIN_EMAILS secret) always fly free: no trial, no paywall. */
  admin?: boolean;
  cancelAtPeriodEnd?: boolean;
  hasSubscription?: boolean;
  now: number;
}): Entitlement {
  const extra = {
    cancelAtPeriodEnd: Boolean(input.cancelAtPeriodEnd),
    hasSubscription: Boolean(input.hasSubscription),
  };
  if (input.admin) {
    return {
      entitled: true,
      reason: "admin",
      plan: "comp",
      periodEnd: null,
      lifetime: true,
      trialRemainingMs: trialRemainingMs(input.trial, true),
      trialUsedMs: input.trial.ms,
      ...extra,
    };
  }
  const lifetime = Boolean(input.lifetime);
  const periodEnd = input.periodEnd ?? null;
  const subActive = Boolean(input.plan && periodEnd && periodEnd > input.now);
  const entitled = lifetime || subActive;
  const reason: Entitlement["reason"] = lifetime
    ? "code"
    : subActive
      ? "subscription"
      : trialRemainingMs(input.trial, false) > 0
        ? "trial"
        : "none";
  return {
    entitled,
    reason: entitled ? reason : reason,
    plan: lifetime ? input.plan || "comp" : subActive ? input.plan || null : null,
    periodEnd: lifetime ? null : periodEnd && periodEnd > input.now ? periodEnd : null,
    lifetime,
    trialRemainingMs: trialRemainingMs(input.trial, entitled),
    trialUsedMs: input.trial.ms,
    ...extra,
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Admin emails live only in the Worker secret ADMIN_EMAILS (comma-separated),
 * never in source or the client bundle. Unset → nobody is admin (fail closed).
 */
export function isAdminEmail(
  email: string | null | undefined,
  adminEmails: string | null | undefined,
): boolean {
  const e = normalizeEmail(email || "");
  if (!e || !adminEmails) return false;
  return adminEmails
    .split(",")
    .map((a) => normalizeEmail(a))
    .filter(Boolean)
    .includes(e);
}

export type RedeemResult =
  | {
      ok: true;
      record: AccessCode;
      lifetime: boolean;
      periodEnd: number | null;
      /** The user had already redeemed this code: nothing changes. */
      alreadyRedeemed: boolean;
    }
  | { ok: false; error: string };

const DAY_MS = 24 * 60 * 60 * 1000;

export function redeemCode(record: AccessCode, userId: string, now: number): RedeemResult {
  const lifetime = record.type === "lifetime";
  const prior = record.redemptions.find((row) => row.userId === userId);
  if (prior) {
    // Re-redeeming never restarts a days-limited period: keep the original expiry.
    const periodEnd = lifetime || !record.days ? null : prior.at + record.days * DAY_MS;
    if (!lifetime && periodEnd !== null && periodEnd <= now) {
      return {
        ok: false,
        error: `You already used this code. Its free access ended on ${formatDate(periodEnd)}.`,
      };
    }
    return { ok: true, record, lifetime, periodEnd, alreadyRedeemed: true };
  }
  if (record.redemptions.length >= record.maxRedemptions) {
    return { ok: false, error: "This access code has no remaining uses." };
  }
  const next: AccessCode = {
    ...record,
    redemptions: [...record.redemptions, { userId, at: now }],
  };
  const periodEnd = lifetime || !record.days ? null : now + record.days * DAY_MS;
  return { ok: true, record: next, lifetime, periodEnd, alreadyRedeemed: false };
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
}

/** Stored billing state (Clerk user metadata `maddflight`). Comp grants
 * (access codes) and the Stripe subscription are kept separately so neither
 * can overwrite the other; `plan` / `periodEnd` / `lifetime` are the combined
 * view that computeEntitlement reads. Older records only have the combined
 * fields; grantParts() reads both shapes. */
export type BillingMeta = {
  plan?: Entitlement["plan"];
  periodEnd?: number | null;
  lifetime?: boolean;
  accessCode?: string;
  compPeriodEnd?: number | null;
  subPlan?: "pro-month" | "pro-year" | null;
  subPeriodEnd?: number | null;
  subStatus?: string;
  cancelAtPeriodEnd?: boolean;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
};

export type GrantParts = {
  lifetime: boolean;
  compPeriodEnd: number | null;
  subPlan: "pro-month" | "pro-year" | null;
  subPeriodEnd: number | null;
};

export function grantParts(meta: BillingMeta): GrantParts {
  const legacySub = meta.plan === "pro-month" || meta.plan === "pro-year";
  return {
    lifetime: Boolean(meta.lifetime),
    compPeriodEnd:
      meta.compPeriodEnd !== undefined
        ? meta.compPeriodEnd
        : meta.plan === "comp"
          ? (meta.periodEnd ?? null)
          : null,
    subPlan:
      meta.subPlan !== undefined
        ? meta.subPlan
        : legacySub
          ? (meta.plan as "pro-month" | "pro-year")
          : null,
    subPeriodEnd:
      meta.subPeriodEnd !== undefined ? meta.subPeriodEnd : legacySub ? (meta.periodEnd ?? null) : null,
  };
}

/** Combined view: lifetime beats everything, otherwise the later expiry wins. */
export function combineGrants(parts: GrantParts): Pick<BillingMeta, "plan" | "periodEnd" | "lifetime"> {
  if (parts.lifetime) return { plan: "comp", periodEnd: null, lifetime: true };
  const sub = parts.subPlan && parts.subPeriodEnd ? parts.subPeriodEnd : 0;
  const comp = parts.compPeriodEnd || 0;
  if (!sub && !comp) return { plan: null, periodEnd: null, lifetime: false };
  return sub >= comp
    ? { plan: parts.subPlan, periodEnd: sub, lifetime: false }
    : { plan: "comp", periodEnd: comp, lifetime: false };
}

export type StripeSubscriptionLike = {
  id?: unknown;
  status?: unknown;
  customer?: unknown;
  current_period_end?: unknown;
  cancel_at_period_end?: unknown;
  cancel_at?: unknown;
  items?: unknown;
};

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/** Period end of a Stripe subscription (ms). Newer API versions put
 * current_period_end on the subscription item instead of the subscription. */
export function stripePeriodEnd(sub: StripeSubscriptionLike): number | null {
  const items = ((sub.items as { data?: Array<{ current_period_end?: number }> })?.data || []);
  const end = Number(sub.current_period_end || items[0]?.current_period_end || 0);
  return end > 0 ? end * 1000 : null;
}

export function stripePriceId(sub: StripeSubscriptionLike): string {
  const item = ((sub.items as { data?: Array<{ price?: { id?: string } }> })?.data || [])[0];
  return item?.price?.id || "";
}

/** Merge a Stripe subscription into stored billing state. Never touches the
 * comp grant (a lifetime or longer access-code period survives any Stripe
 * event). Cancel-at-period-end keeps access until the period end; a deleted /
 * unpaid / expired subscription revokes only the subscription part. Events for
 * an older subscription than the one on file cannot revoke the current one. */
export function mergeStripeSubscription(
  meta: BillingMeta,
  sub: StripeSubscriptionLike,
  plan: "pro-month" | "pro-year" | null,
  customerId?: string,
): BillingMeta {
  const status = String(sub.status || "");
  const id = String(sub.id || "");
  const active = ACTIVE_STATUSES.has(status) && Boolean(plan);
  if (!active && meta.stripeSubscriptionId && id && meta.stripeSubscriptionId !== id) {
    const parts = grantParts(meta);
    if (parts.subPlan && parts.subPeriodEnd) return { ...meta };
  }
  let periodEnd = active ? stripePeriodEnd(sub) : null;
  const cancelAt = Number(sub.cancel_at || 0) * 1000;
  if (periodEnd && cancelAt > 0) periodEnd = Math.min(periodEnd, cancelAt);
  const parts: GrantParts = {
    ...grantParts(meta),
    subPlan: active ? plan : null,
    subPeriodEnd: periodEnd,
  };
  return {
    ...meta,
    ...combineGrants(parts),
    compPeriodEnd: parts.compPeriodEnd,
    subPlan: parts.subPlan,
    subPeriodEnd: parts.subPeriodEnd,
    subStatus: status,
    cancelAtPeriodEnd: active && (Boolean(sub.cancel_at_period_end) || cancelAt > 0),
    stripeCustomerId: customerId || (typeof sub.customer === "string" ? sub.customer : meta.stripeCustomerId),
    stripeSubscriptionId: id || meta.stripeSubscriptionId,
  };
}

/** Merge an access-code grant: lifetime is sticky, and a days code only ever
 * extends access (never shortens a longer comp or touches the subscription). */
export function mergeCodeGrant(
  meta: BillingMeta,
  grant: { lifetime: boolean; periodEnd: number | null; code: string },
): BillingMeta {
  const prev = grantParts(meta);
  const parts: GrantParts = {
    ...prev,
    lifetime: prev.lifetime || grant.lifetime,
    compPeriodEnd: Math.max(prev.compPeriodEnd || 0, grant.periodEnd || 0) || null,
  };
  return {
    ...meta,
    ...combineGrants(parts),
    compPeriodEnd: parts.compPeriodEnd,
    subPlan: parts.subPlan,
    subPeriodEnd: parts.subPeriodEnd,
    accessCode: grant.code,
  };
}

export function generateAccessCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const chunk = (n: number) =>
    Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(
      "",
    );
  return `MADD-${chunk(4)}-${chunk(4)}-${chunk(4)}`;
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const bin =
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of bin) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signUnlockToken(
  secret: string,
  payload: UnlockPayload,
): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${b64url(sig)}`;
}

export async function verifyUnlockToken(
  secret: string,
  token: string,
  now: number,
): Promise<UnlockPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlDecode(sig) as BufferSource,
    new TextEncoder().encode(body),
  );
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as UnlockPayload;
    if (!payload?.sub) return null;
    if (!payload.lifetime && !(payload.exp > now)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
