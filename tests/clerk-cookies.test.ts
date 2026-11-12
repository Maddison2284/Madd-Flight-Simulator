import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clientCookieValues,
  keepNewestClientCookie,
  responseSetsClientCookie,
  strayClientCookieDeletions,
} from "../worker/clerk-cookies";

test("finds every __client cookie in order", () => {
  assert.deepEqual(clientCookieValues("a=1; __client=old; __client_uat=0; __client=new"), ["old", "new"]);
  assert.deepEqual(clientCookieValues(null), []);
  assert.deepEqual(clientCookieValues("__client_uat=5"), []);
});

test("keeps only the newest __client and leaves other cookies alone", () => {
  assert.equal(
    keepNewestClientCookie("__client=old; __client_uat=0; x=1; __client=new"),
    "__client_uat=0; x=1; __client=new",
  );
  assert.equal(keepNewestClientCookie("__client=only; y=2"), "__client=only; y=2");
});

test("expires host-only and parent-domain strays, never Clerk's own domain", () => {
  const dels = strayClientCookieDeletions("maddflight.maddisonempire.com");
  assert.equal(dels.length, 2);
  assert.ok(dels.every((d) => d.startsWith("__client=;") && /Max-Age=0/.test(d)));
  assert.ok(!/Domain/.test(dels[0]));
  assert.match(dels[1], /Domain=maddisonempire\.com$/);
  assert.ok(!dels.some((d) => /Domain=\.?maddflight/.test(d)));
});

test("detects a fresh __client in the upstream response", () => {
  const h = new Headers();
  h.append("Set-Cookie", "__client_uat=0; Path=/");
  assert.equal(responseSetsClientCookie(h), false);
  h.append("Set-Cookie", "__client=abc; Path=/; Domain=maddflight.maddisonempire.com");
  assert.equal(responseSetsClientCookie(h), true);
});
