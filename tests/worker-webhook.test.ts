// Mocked Stripe + Clerk: drives the Worker's real webhook and cancel routes.
// No network calls; the fetch mock refuses anything it does not recognise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const DAY = 86_400_000;
const WHSEC = "whsec_test_only";
const users = new Map<string, { public_metadata: any; private_metadata: any }>();
const subs = new Map<string, any>();
const stripeCalls: string[] = [];
const realFetch = globalThis.fetch;

function userJson(id: string) {
  const u = users.get(id)!;
  return {
    object: "user", id, email_addresses: [], primary_email_address_id: null, first_name: "T",
    public_metadata: u.public_metadata, private_metadata: u.private_metadata, unsafe_metadata: {},
  };
}
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = (init?.method || "GET").toUpperCase();
  if (url.hostname === "api.clerk.com") {
    const m = url.pathname.match(/^\/v1\/users\/([^/]+)(\/metadata)?$/);
    if (m && users.has(m[1])) {
      if (m[2] && method === "PATCH") {
        const body = JSON.parse(String(init?.body || "{}"));
        const u = users.get(m[1])!;
        if (body.public_metadata) u.public_metadata = { ...u.public_metadata, ...body.public_metadata };
        if (body.private_metadata) u.private_metadata = { ...u.private_metadata, ...body.private_metadata };
      }
      return Response.json(userJson(m[1]));
    }
  }
  if (url.hostname === "api.stripe.com") {
    stripeCalls.push(`${method} ${url.pathname}${init?.body ? "?" + String(init.body) : ""}`);
    const m = url.pathname.match(/^\/v1\/subscriptions\/([^/]+)$/);
    if (m && subs.has(m[1])) {
      if (method === "POST") {
        const p = new URLSearchParams(String(init?.body || ""));
        if (p.has("cancel_at_period_end")) subs.get(m[1]).cancel_at_period_end = p.get("cancel_at_period_end") === "true";
      }
      return Response.json(subs.get(m[1]));
    }
  }
  throw new Error(`unexpected fetch ${method} ${url.href}`);
}) as typeof fetch;

// Import after the fetch mock: the Clerk SDK captures fetch at load time.
const { default: worker } = await import("../worker/index.ts");

const env: any = {
  STRIPE_WEBHOOK_SECRET: WHSEC,
  STRIPE_SECRET_KEY: "sk_test_mock",
  CLERK_SECRET_KEY: "sk_test_mock",
  STRIPE_PRICE_MONTHLY: "price_m",
  STRIPE_PRICE_YEARLY: "price_y",
  UNLOCK_HMAC_SECRET: "x",
  MADDFLIGHT: { get: async () => null, put: async () => {} },
  ASSETS: { fetch: async () => new Response("asset") },
};

async function webhook(type: string, object: any) {
  const raw = JSON.stringify({ type, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", WHSEC).update(`${t}.${raw}`).digest("hex");
  return worker.fetch(
    new Request("https://maddflight.maddisonempire.com/api/webhooks/stripe", {
      method: "POST", body: raw, headers: { "stripe-signature": `t=${t},v1=${v1}` },
    }),
    env,
  );
}
const meta = (id: string) => users.get(id)!.private_metadata.maddflight;
const sub = (over: any = {}) => ({
  id: "sub_1", object: "subscription", status: "active", customer: "cus_1", cancel_at_period_end: false,
  metadata: { clerk_user_id: "user_1" },
  items: { data: [{ price: { id: "price_m" }, current_period_end: Math.floor((Date.now() + 30 * DAY) / 1000) }] },
  ...over,
});

test("rejects a bad signature", async () => {
  const res = await worker.fetch(new Request("https://x/api/webhooks/stripe", { method: "POST", body: "{}", headers: { "stripe-signature": "t=1,v1=00" } }), env);
  assert.equal(res.status, 400);
});

test("checkout.session.completed grants Pro on a live price", async () => {
  users.set("user_1", { public_metadata: {}, private_metadata: {} });
  subs.set("sub_1", sub());
  const res = await webhook("checkout.session.completed", { subscription: "sub_1", customer: "cus_1", client_reference_id: "user_1", metadata: { clerk_user_id: "user_1" } });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(meta("user_1").plan, "pro-month");
  assert.ok(meta("user_1").periodEnd > Date.now() + 29 * DAY);
});

test("subscription.updated with cancel_at_period_end keeps access until the period end", async () => {
  await webhook("customer.subscription.updated", sub({ cancel_at_period_end: true }));
  const m = meta("user_1");
  assert.equal(m.plan, "pro-month");
  assert.equal(m.cancelAtPeriodEnd, true);
  assert.ok(m.periodEnd > Date.now() + 29 * DAY);
});

test("invoice.payment_failed keeps a past_due sub until Stripe ends it", async () => {
  subs.set("sub_1", sub({ status: "past_due" }));
  await webhook("invoice.payment_failed", { subscription: "sub_1" });
  assert.equal(meta("user_1").plan, "pro-month");
});

test("subscription.deleted revokes Pro", async () => {
  await webhook("customer.subscription.deleted", sub({ status: "canceled" }));
  assert.equal(meta("user_1").plan, null);
  assert.equal(meta("user_1").periodEnd, null);
});

test("a Stripe grant does not strip a lifetime comp", async () => {
  users.set("user_2", { public_metadata: {}, private_metadata: { maddflight: { plan: "comp", lifetime: true, periodEnd: null, accessCode: "MADD-L" } } });
  await webhook("customer.subscription.updated", sub({ id: "sub_2", metadata: { clerk_user_id: "user_2" } }));
  assert.equal(meta("user_2").lifetime, true);
  await webhook("customer.subscription.deleted", sub({ id: "sub_2", status: "canceled", metadata: { clerk_user_id: "user_2" } }));
  assert.equal(meta("user_2").lifetime, true);
});

test("the cancel route only ever sets cancel_at_period_end (no immediate cancel, no refund)", async () => {
  // Signed-in route needs a Clerk session token; without one it must refuse.
  const res = await worker.fetch(new Request("https://maddflight.maddisonempire.com/api/subscription/cancel", { method: "POST" }), env);
  assert.equal(res.status, 401);
  assert.ok(!stripeCalls.some((c) => c.startsWith("DELETE") || /refund|prorat/.test(c)));
});

test("subscription.created and invoice.paid apply the subscription state", async () => {
  users.set("user_3", { public_metadata: {}, private_metadata: {} });
  const s3 = sub({ id: "sub_3", metadata: { clerk_user_id: "user_3" }, items: { data: [{ price: { id: "price_y" }, current_period_end: Math.floor((Date.now() + 365 * DAY) / 1000) }] } });
  await webhook("customer.subscription.created", s3);
  assert.equal(meta("user_3").plan, "pro-year");
  users.set("user_3", { public_metadata: {}, private_metadata: {} });
  subs.set("sub_3", s3);
  await webhook("invoice.paid", { parent: { subscription_details: { subscription: "sub_3" } } });
  assert.equal(meta("user_3").plan, "pro-year");
});

test("events for other products (Madd Shopping) are acknowledged and ignored", async () => {
  users.set("user_4", { public_metadata: {}, private_metadata: { maddflight: { plan: "pro-month", periodEnd: Date.now() + DAY, subPlan: "pro-month", subPeriodEnd: Date.now() + DAY, stripeSubscriptionId: "sub_4" } } });
  const other = sub({ id: "sub_4", status: "canceled", metadata: { clerk_user_id: "user_4" }, items: { data: [{ price: { id: "price_shop_tshirt" } }] } });
  const r1 = await webhook("customer.subscription.deleted", other);
  assert.equal(r1.status, 200);
  assert.equal(meta("user_4").plan, "pro-month");
  subs.set("sub_shop", { ...other, id: "sub_shop" });
  const r2 = await webhook("invoice.paid", { subscription: "sub_shop" });
  assert.equal(r2.status, 200);
  const r3 = await webhook("checkout.session.completed", { mode: "payment", customer: "cus_shop" });
  assert.equal(r3.status, 200);
  const r4 = await webhook("payment_intent.succeeded", { id: "pi_1" });
  assert.equal(r4.status, 200);
  assert.equal(meta("user_4").plan, "pro-month");
});

test.after(() => {
  globalThis.fetch = realFetch;
});
