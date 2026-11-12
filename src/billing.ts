/** Shared billing/trial helpers used by the Worker and unit tests. */

export const TRIAL_MS = 5 * 60 * 1000;
export const ADMIN_EMAIL = "support@maddflight.maddisonempire.com";
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
  /** Admins (verified ADMIN_EMAIL) always fly free: no trial, no paywall. */
  admin?: boolean;
  now: number;
}): Entitlement {
  if (input.admin) {
    return {
      entitled: true,
      reason: "admin",
      plan: "comp",
      periodEnd: null,
      lifetime: true,
      trialRemainingMs: trialRemainingMs(input.trial, true),
      trialUsedMs: input.trial.ms,
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
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export function isAdminEmail(email: string | null | undefined): boolean {
  return normalizeEmail(email || "") === ADMIN_EMAIL;
}

export function redeemCode(
  record: AccessCode,
  userId: string,
  now: number,
): { ok: true; record: AccessCode; lifetime: boolean; periodEnd: number | null } | { ok: false; error: string } {
  if (record.redemptions.some((row) => row.userId === userId)) {
    const lifetime = record.type === "lifetime";
    const periodEnd =
      lifetime || !record.days ? null : now + record.days * 24 * 60 * 60 * 1000;
    return { ok: true, record, lifetime, periodEnd };
  }
  if (record.redemptions.length >= record.maxRedemptions) {
    return { ok: false, error: "This access code has no remaining uses." };
  }
  const next: AccessCode = {
    ...record,
    redemptions: [...record.redemptions, { userId, at: now }],
  };
  const lifetime = record.type === "lifetime";
  const periodEnd =
    lifetime || !record.days ? null : now + record.days * 24 * 60 * 60 * 1000;
  return { ok: true, record: next, lifetime, periodEnd };
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
