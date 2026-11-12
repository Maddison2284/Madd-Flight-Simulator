import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRIAL_MS,
  applyTrialHeartbeat,
  computeEntitlement,
  emptyTrial,
  isAdminEmail,
  normalizeCode,
  redeemCode,
  signUnlockToken,
  verifyUnlockToken,
  type AccessCode,
} from "../src/billing.ts";

test("trial heartbeat caps reported elapsed time and cannot skip to expiry in one call", () => {
  const now = 1_000_000;
  const first = applyTrialHeartbeat(emptyTrial(), 60_000, now);
  assert.ok(first.ms <= 15_000);
  const second = applyTrialHeartbeat(first, 60_000, now + 1000);
  assert.ok(second.ms - first.ms <= 15_000);
});

test("five minutes of accumulated flight time ends the free trial", () => {
  let trial = emptyTrial();
  let now = 5_000;
  while (trial.ms < TRIAL_MS) {
    now += 10_000;
    trial = applyTrialHeartbeat(trial, 10_000, now);
  }
  const ent = computeEntitlement({ trial, now });
  assert.equal(ent.reason, "none");
  assert.equal(ent.entitled, false);
  assert.equal(ent.trialRemainingMs, 0);
});

test("active subscription and lifetime codes stay entitled after the trial clock", () => {
  const trial = { ms: TRIAL_MS, updatedAt: 1 };
  const sub = computeEntitlement({
    trial,
    plan: "pro-month",
    periodEnd: 2_000_000,
    now: 1_000,
  });
  assert.equal(sub.entitled, true);
  assert.equal(sub.reason, "subscription");
  const comp = computeEntitlement({ trial, lifetime: true, now: 1_000 });
  assert.equal(comp.entitled, true);
  assert.equal(comp.reason, "code");
});

test("access codes enforce max redemptions and are reusable by the same user", () => {
  const base: AccessCode = {
    code: "MADD-TEST-CODE-0001",
    type: "lifetime",
    maxRedemptions: 1,
    redemptions: [],
    createdAt: 1,
    createdBy: "test",
  };
  const first = redeemCode(base, "user_1", 10);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const again = redeemCode(first.record, "user_1", 20);
  assert.equal(again.ok, true);
  const other = redeemCode(first.record, "user_2", 30);
  assert.equal(other.ok, false);
  assert.equal(normalizeCode(" madd-ab12-cd34 "), "MADD-AB12-CD34");
  assert.equal(isAdminEmail("support@maddflight.maddisonempire.com"), true);
  assert.equal(isAdminEmail("someone@else.com"), false);
});

test("unlock tokens verify and expire with the subscription period", async () => {
  const secret = "test-secret-value";
  const token = await signUnlockToken(secret, {
    sub: "user_123",
    plan: "pro-year",
    exp: 2_000,
  });
  const ok = await verifyUnlockToken(secret, token, 1_000);
  assert.equal(ok?.sub, "user_123");
  const expired = await verifyUnlockToken(secret, token, 3_000);
  assert.equal(expired, null);
  const bad = await verifyUnlockToken("other-secret", token, 1_000);
  assert.equal(bad, null);
});

test("admins are always entitled with no trial clock", () => {
  const e = computeEntitlement({ trial: { ms: 10 * 60 * 1000, updatedAt: 0 }, admin: true, now: Date.now() });
  assert.equal(e.entitled, true);
  assert.equal(e.reason, "admin");
  assert.equal(e.lifetime, true);
});
