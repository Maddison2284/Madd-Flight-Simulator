// Stale Clerk client cookies.
//
// Clerk keeps the browser's sign-in state in a `__client` cookie that it sets
// on `.maddflight.maddisonempire.com` through our /__clerk proxy. A browser can
// also hold an older `__client` from an earlier setup (host-only on
// maddflight.maddisonempire.com, or on the parent `.maddisonempire.com`). The
// browser then sends two `__client` cookies, the old one first, and Clerk reads
// the old one: every sign-up starts on a fresh client, the next step
// (prepare_verification) answers 401 "signed_out", no code email goes out, and
// the Google return fails with authorization_invalid.
//
// Fix: forward only the newest `__client` (browsers list older cookies first)
// and expire the stray variants. Clerk's own cookie (Domain=.maddflight...) is
// never touched by these deletions.

export const CLIENT_COOKIE = "__client";

/** Every `__client` value in a Cookie header, in the order the browser sent them. */
export function clientCookieValues(cookieHeader: string | null): string[] {
  if (!cookieHeader) return [];
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(CLIENT_COOKIE + "="))
    .map((part) => part.slice(CLIENT_COOKIE.length + 1));
}

/** The Cookie header with only the last `__client` kept (others removed). */
export function keepNewestClientCookie(cookieHeader: string): string {
  const parts = cookieHeader.split(";").map((p) => p.trim()).filter(Boolean);
  const lastIdx = parts.map((p) => p.startsWith(CLIENT_COOKIE + "=")).lastIndexOf(true);
  return parts.filter((p, i) => !p.startsWith(CLIENT_COOKIE + "=") || i === lastIdx).join("; ");
}

/** Set-Cookie values that expire the stray `__client` variants for this host. */
export function strayClientCookieDeletions(hostname: string): string[] {
  const expire = "=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax";
  const out = [CLIENT_COOKIE + expire]; // host-only on this host
  const labels = hostname.split(".");
  // Every parent domain above the one Clerk uses (e.g. .maddisonempire.com).
  for (let i = 2; i < labels.length; i++) {
    const parent = labels.slice(i - 1).join(".");
    if (parent.split(".").length >= 2) out.push(`${CLIENT_COOKIE}${expire}; Domain=${parent}`);
  }
  return out;
}

/** True when the upstream response sets a new `__client`. */
export function responseSetsClientCookie(headers: Headers): boolean {
  const all = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ??
    (headers.get("Set-Cookie") ? [headers.get("Set-Cookie") as string] : []);
  return all.some((v) => v.trimStart().startsWith(CLIENT_COOKIE + "=") && !/Max-Age=0/i.test(v));
}
