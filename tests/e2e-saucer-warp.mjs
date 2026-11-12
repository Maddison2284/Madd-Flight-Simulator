// DEV-ONLY (not part of `pnpm test`): saucer vertical + warp overlay checks on
// the harness app (npx vite --config harness/app/vite.config.ts).
//   TEST_URL=http://localhost:5209 TAG=after node tests/e2e-saucer-warp.mjs
// WebKit iPhone 15 portrait: real taps (Start, Warp); UP/DOWN holds as
// touch-type PointerEvents (Playwright WebKit has no touch-hold API); keyboard
// W/S/R/F. Chromium iPhone-sized touch device: real CDP touch holds on the
// UP/DOWN buttons and the joystick. Warp frames + frame-to-frame diffs saved.
import { chromium, webkit, devices } from "playwright";
import fs from "node:fs";
const BASE = process.env.TEST_URL || "http://localhost:5209";
const TAG = process.env.TAG || "after";
const OUT = process.env.SHOTS || "/workspace/maddflight/shots/saucer2";
const STRICT = TAG === "after";
fs.mkdirSync(OUT, { recursive: true });
const ent = { userId: "u", email: "pilot@example.com", isAdmin: true, entitled: true, trialRemainingMs: 0, token: "t", reason: "admin", hasSubscription: false, lifetime: false, plan: null, periodEnd: null, cancelAtPeriodEnd: false };
const results = { tag: TAG, checks: [] };
let failed = 0;
const check = (name, ok, detail) => {
  results.checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail ?? ""}`);
  if (!ok) failed++;
};
async function prepare(page) {
  await page.route("https://tile.openstreetmap.org/**", (r) => r.abort());
  await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
  await page.route("https://fonts.gstatic.com/**", (r) => r.abort());
  await page.route("**/api/entitlement", (r) => r.fulfill({ json: ent }));
  await page.addInitScript(() => {
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    localStorage.clear();
    localStorage.setItem("maddflight-aircraft", "saucer");
  });
}
async function start(page) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  const btn = page.getByRole("button", { name: "Start flight" });
  await btn.waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  for (let i = 0; i < 4; i++) {
    if (await btn.isVisible().catch(() => false)) await btn.tap().catch(() => {});
    try {
      await page.locator(".phone-hud").waitFor({ timeout: 15000 });
      break;
    } catch {
      await page.screenshot({ path: `${OUT}/${TAG}-start-retry${i}.png` });
    }
  }
  await page.locator(".phone-hud").waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
}
const altFt = (page) =>
  page.evaluate(() => {
    for (const s of document.querySelectorAll(".phone-hud span")) {
      const label = s.querySelector("small")?.textContent || "";
      if (label.includes("MSL")) return Number(s.textContent.replace(label, "").replace(/[^\d.-]/g, ""));
    }
    return NaN;
  });
const hud = (page) => page.locator(".phone-hud").innerText().then((t) => t.replace(/\s+/g, " "));
async function synthHold(page, selector, ms) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const b = el.getBoundingClientRect();
    const o = { pointerId: 41, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 };
    el.dispatchEvent(new PointerEvent("pointerdown", o));
  }, selector);
  await page.waitForTimeout(ms);
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    el.dispatchEvent(new PointerEvent("pointerup", { pointerId: 41, pointerType: "touch", isPrimary: true, bubbles: true }));
  }, selector);
}
async function holdCheck(page, label, doHold, sign) {
  // settle hover first
  await page.waitForTimeout(800);
  const a0 = await altFt(page);
  await doHold();
  const a1 = await altFt(page);
  const d = (a1 - a0) * sign;
  check(`${label}`, STRICT ? d > 1000 : true, `${a0} -> ${a1} ft (Δ ${(a1 - a0).toFixed(0)} ft)`);
  return a1 - a0;
}

// ---------- WebKit iPhone 15 portrait ----------
{
  const browser = await webkit.launch({ headless: true, env: { ...process.env, GST_REGISTRY_FORK: "no", GST_PLUGIN_SYSTEM_PATH: "/usr/lib/x86_64-linux-gnu/gstreamer-1.0" } });
  const ctx = await browser.newContext({ ...devices["iPhone 15"] });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await prepare(page);
  await start(page);
  await page.screenshot({ path: `${OUT}/${TAG}-webkit-iphone15-start.png` });
  const rot = await page.locator(".rotate-hint").isVisible();
  console.log("rotate hint visible at start:", rot);
  await page.waitForTimeout(5500);
  const rotLater = await page.locator(".rotate-hint").isVisible();
  check("rotate hint auto-hides after ~5 s", STRICT ? !rotLater : true, `visible after 7 s: ${rotLater}`);
  results.webkit = {};
  results.webkit.up = await holdCheck(page, "WebKit iPhone: hold UP button 2 s gains > 1,000 ft", () => synthHold(page, ".vert-btn.vert-up", 2000), 1);
  results.webkit.down = await holdCheck(page, "WebKit iPhone: hold DOWN button 2 s loses > 1,000 ft", () => synthHold(page, ".vert-btn.vert-down", 2000), -1);
  await page.evaluate(() => document.activeElement?.blur?.());
  for (const [k, sign] of [["w", 1], ["s", -1], ["r", 1], ["f", -1]]) {
    await holdCheck(page, `WebKit iPhone: keyboard ${k.toUpperCase()} 2 s`, async () => {
      await page.keyboard.down(k);
      await page.waitForTimeout(2000);
      await page.keyboard.up(k);
    }, sign);
  }
  // Warp frames (real taps on the WARP button)
  const warpBtn = page.locator(".phone-actions button[aria-label='Warp'], button[aria-label='Warp']").locator("visible=true").first();
  results.webkit.warp = {};
  for (const level of [1, 2, 3]) {
    await warpBtn.tap();
    await page.waitForTimeout(3500);
    const text = await hud(page);
    await page.screenshot({ path: `${OUT}/${TAG}-webkit-iphone15-warp${level}.png` });
    results.webkit.warp[level] = text;
    console.log(`warp ${level} HUD:`, text);
  }
  // climbing at WARP 3
  const w3 = await holdCheck(page, "WebKit iPhone: hold UP at WARP 3 climbs > 1,000 ft", () => synthHold(page, ".vert-btn.vert-up", 2000), 1);
  // 10 consecutive frames at warp 3 for strobe analysis
  for (let i = 0; i < 10; i++) {
    await page.screenshot({ path: `${OUT}/${TAG}-webkit-warp3-seq${String(i).padStart(2, "0")}.png` });
    await page.waitForTimeout(60);
  }
  await browser.close();
}

// ---------- Chromium, iPhone-sized touch device, real CDP touches ----------
{
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices["iPhone 15"].userAgent });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await prepare(page);
  await start(page);
  const cdp = await ctx.newCDPSession(page);
  const touchHold = async (x, y, ms, moveTo) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 3 }] });
    if (moveTo) for (let i = 1; i <= 5; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + ((moveTo.x - x) * i) / 5, y: y + ((moveTo.y - y) * i) / 5, id: 3 }] });
    await page.waitForTimeout(ms);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const center = async (sel) => {
    const b = await page.locator(sel).boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, h: b.height };
  };
  const up = await center(".vert-btn.vert-up");
  await holdCheck(page, "Chromium touch: hold UP button 2 s (real touch)", () => touchHold(up.x, up.y, 2000), 1);
  const dn = await center(".vert-btn.vert-down");
  await holdCheck(page, "Chromium touch: hold DOWN button 2 s (real touch)", () => touchHold(dn.x, dn.y, 2000), -1);
  const st = await center(".touch-stick");
  await holdCheck(page, "Chromium touch: joystick pushed UP 2 s (real touch)", () => touchHold(st.x, st.y, 2000, { x: st.x, y: st.y - st.h }), 1);
  await holdCheck(page, "Chromium touch: joystick pulled DOWN 2 s (real touch)", () => touchHold(st.x, st.y, 2000, { x: st.x, y: st.y + st.h }), -1);
  await page.screenshot({ path: `${OUT}/${TAG}-chromium-touch.png` });
  console.log("chromium errors:", JSON.stringify(await page.evaluate(() => window.__mfErrors ?? [])));
  await browser.close();
}
fs.writeFileSync(`${OUT}/${TAG}-results.json`, JSON.stringify(results, null, 2));
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(STRICT && failed ? 1 : 0);
