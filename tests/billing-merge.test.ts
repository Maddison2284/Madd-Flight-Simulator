import { test } from "node:test";
import assert from "node:assert/strict";
import {
  combineGrants,
  computeEntitlement,
  emptyTrial,
  grantParts,
  mergeCodeGrant,
  mergeStripeSubscription,
  redeemCode,
  type AccessCode,
  type BillingMeta,
} from "../src/billing.ts";

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 11);
const sub = (over: Record<string, unknown> = {}) => ({
  id: "sub_1",
  status: "active",
  customer: "cus_1",
  cancel_at_period_end: false,
  items: { data: [{ price: { id: "price_m" }, current_period_end: (now + 30 * DAY) / 1000 }] },
  ...over,
});
const ent = (m: BillingMeta, at = now) =>
  computeEntitlement({ trial: emptyTrial(), plan: m.plan, periodEnd: m.periodEnd, lifetime: m.lifetime, cancelAtPeriodEnd: m.cancelAtPeriodEnd, now: at });

test("re-redeeming a days code keeps the original expiry", () => {
  const code: AccessCode = { code: "MADD-A", type: "days", days: 30, maxRedemptions: 5, redemptions: [], createdAt: 0, createdBy: "x" };
  const first = redeemCode(code, "u1", now);
  assert.ok(first.ok && !first.alreadyRedeemed);
  const again = redeemCode(first.ok ? first.record : code, "u1", now + 20 * DAY);
  assert.ok(again.ok && again.alreadyRedeemed);
  assert.equal(again.ok && again.periodEnd, now + 30 * DAY);
  assert.equal(again.ok && again.record.redemptions.length, 1);
  // and the merged state does not move either
  let meta = mergeCodeGrant({}, { lifetime: false, periodEnd: first.ok ? first.periodEnd : null, code: "MADD-A" });
  meta = mergeCodeGrant(meta, { lifetime: false, periodEnd: again.ok ? again.periodEnd : null, code: "MADD-A" });
  assert.equal(meta.periodEnd, now + 30 * DAY);
});

test("re-redeeming after the period ended is rejected with a friendly message", () => {
  const code: AccessCode = { code: "MADD-B", type: "days", days: 7, maxRedemptions: 5, redemptions: [{ userId: "u1", at: now - 10 * DAY }], createdAt: 0, createdBy: "x" };
  const r = redeemCode(code, "u1", now);
  assert.ok(!r.ok && /already used this code/.test(r.error));
});

test("a Stripe grant never strips a lifetime comp", () => {
  const lifetime = mergeCodeGrant({}, { lifetime: true, periodEnd: null, code: "MADD-L" });
  const after = mergeStripeSubscription(lifetime, sub(), "pro-month", "cus_1");
  assert.equal(after.lifetime, true);
  assert.equal(ent(after).lifetime, true);
  const deleted = mergeStripeSubscription(after, sub({ status: "canceled" }), "pro-month");
  assert.equal(deleted.lifetime, true);
  assert.ok(ent(deleted, now + 400 * DAY).entitled);
});

test("legacy combined records keep lifetime too", () => {
  const legacy: BillingMeta = { plan: "comp", lifetime: true, periodEnd: null, accessCode: "MADD-OLD" };
  const after = mergeStripeSubscription(legacy, sub(), "pro-year");
  assert.equal(after.lifetime, true);
});

test("a Stripe grant keeps a longer access-code comp, then the comp outlasts a deleted sub", () => {
  const comp = mergeCodeGrant({}, { lifetime: false, periodEnd: now + 90 * DAY, code: "MADD-90" });
  const withSub = mergeStripeSubscription(comp, sub(), "pro-month");
  assert.equal(withSub.periodEnd, now + 90 * DAY);
  assert.equal(withSub.plan, "comp");
  const gone = mergeStripeSubscription(withSub, sub({ status: "canceled" }), "pro-month");
  assert.equal(gone.periodEnd, now + 90 * DAY);
  assert.ok(ent(gone, now + 60 * DAY).entitled);
});

test("a short code does not shorten an active subscription", () => {
  const s = mergeStripeSubscription({}, sub(), "pro-month");
  const c = mergeCodeGrant(s, { lifetime: false, periodEnd: now + 3 * DAY, code: "MADD-3" });
  assert.equal(c.plan, "pro-month");
  assert.equal(c.periodEnd, now + 30 * DAY);
});

test("cancel_at_period_end keeps access until the period end; deleted revokes", () => {
  const active = mergeStripeSubscription({}, sub(), "pro-month");
  const cancelled = mergeStripeSubscription(active, sub({ cancel_at_period_end: true }), "pro-month");
  assert.equal(cancelled.cancelAtPeriodEnd, true);
  assert.equal(cancelled.periodEnd, now + 30 * DAY);
  assert.ok(ent(cancelled, now + 29 * DAY).entitled);
  assert.equal(ent(cancelled, now + 29 * DAY).cancelAtPeriodEnd, true);
  assert.ok(!ent(cancelled, now + 31 * DAY).entitled);
  const deleted = mergeStripeSubscription(cancelled, sub({ status: "canceled" }), "pro-month");
  assert.equal(deleted.plan, null);
  assert.ok(!ent(deleted).entitled);
});

test("an event for an older subscription cannot revoke the current one", () => {
  const current = mergeStripeSubscription({}, sub({ id: "sub_new" }), "pro-year");
  const old = mergeStripeSubscription(current, sub({ id: "sub_old", status: "canceled" }), "pro-month");
  assert.equal(old.plan, "pro-year");
  assert.equal(old.stripeSubscriptionId, "sub_new");
});

test("unknown prices never grant access; period end read from items or the subscription", () => {
  assert.equal(mergeStripeSubscription({}, sub(), null).plan, null);
  const legacyShape = mergeStripeSubscription({}, { ...sub(), items: { data: [{ price: { id: "price_m" } }] }, current_period_end: (now + 5 * DAY) / 1000 }, "pro-month");
  assert.equal(legacyShape.periodEnd, now + 5 * DAY);
});

test("grantParts / combineGrants round-trip", () => {
  assert.deepEqual(combineGrants(grantParts({})), { plan: null, periodEnd: null, lifetime: false });
});
