// DEV-ONLY memory soak (not part of `pnpm test`). Harness app must be running.
//   TEST_URL=http://localhost:5209 TAG=after BROWSER=chromium|webkit node tests/soak-memory.mjs
// Saucer: cycles WARP 1→2→3→off every few seconds while spamming Jump, for
// SAUCER_S seconds; then the fighter at full throttle for FIGHTER_S seconds.
// Samples: browser process-tree RSS (both engines) + JS heap after GC,
// DOM nodes and JS listeners (Chromium CDP).
import { chromium, webkit, devices } from "playwright";
import { execSync } from "node:child_process";
import fs from "node:fs";
const BASE = process.env.TEST_URL || "http://localhost:5209";
const TAG = process.env.TAG || "after";
const BROWSER = process.env.BROWSER || "chromium";
const SAUCER_S = Number(process.env.SAUCER_S || 180);
const FIGHTER_S = Number(process.env.FIGHTER_S || 60);
const OUT = process.env.SHOTS || "/workspace/maddflight/shots/saucer2";
const ent = { userId: "u", email: "pilot@example.com", isAdmin: true, entitled: true, trialRemainingMs: 0, token: "t", reason: "admin", hasSubscription: false, lifetime: false, plan: null, periodEnd: null, cancelAtPeriodEnd: false };
function treeRssMb() {
  const rows = execSync("ps -e -o pid=,ppid=,rss=").toString().trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
  const kids = new Map();
  for (const [pid, ppid] of rows) (kids.get(ppid) ?? kids.set(ppid, []).get(ppid)).push(pid);
  const rss = new Map(rows.map(([pid, , r]) => [pid, r]));
  let total = 0;
  const stack = [...(kids.get(process.pid) ?? [])];
  while (stack.length) {
    const p = stack.pop();
    total += rss.get(p) ?? 0;
    stack.push(...(kids.get(p) ?? []));
  }
  return Math.round(total / 1024);
}
const isChromium = BROWSER === "chromium";
const browser = isChromium
  ? await chromium.launch({ headless: true, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-precise-memory-info"] })
  : await webkit.launch({ headless: true, env: { ...process.env, GST_REGISTRY_FORK: "no", GST_PLUGIN_SYSTEM_PATH: "/usr/lib/x86_64-linux-gnu/gstreamer-1.0" } });
const ctx = await browser.newContext(isChromium ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: devices["iPhone 15"].userAgent } : { ...devices["iPhone 15"] });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
let crashed = false;
page.on("crash", () => (crashed = true));
await page.route("https://tile.openstreetmap.org/**", (r) => r.abort());
await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
await page.route("https://fonts.gstatic.com/**", (r) => r.abort());
await page.route("**/api/entitlement", (r) => r.fulfill({ json: ent }));
const cdp = isChromium ? await ctx.newCDPSession(page) : null;
if (cdp) await cdp.send("Performance.enable");
const samples = [];
async function sample(phase, t) {
  const s = { phase, t, rssMb: treeRssMb() };
  if (cdp) {
    await cdp.send("HeapProfiler.collectGarbage");
    const m = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
    s.heapMb = +(m.JSHeapUsedSize / 1048576).toFixed(1);
    s.nodes = m.Nodes;
    s.listeners = m.JSEventListeners;
  }
  samples.push(s);
  console.log(JSON.stringify(s));
}
async function fly(aircraft) {
  await page.evaluate((a) => { localStorage.setItem("maddflight-aircraft", a); }, aircraft);
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  const btn = page.getByRole("button", { name: "Start flight" });
  await btn.waitFor({ timeout: 60000 });
  await page.waitForTimeout(1000);
  for (let i = 0; i < 4; i++) {
    if (await btn.isVisible().catch(() => false)) await btn.tap().catch(() => {});
    try { await page.locator(".phone-hud").waitFor({ timeout: 15000 }); break; } catch {}
  }
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.activeElement?.blur?.());
}
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await fly("saucer");
const t0 = Date.now();
await sample("saucer", 0);
let lastSample = Date.now(), step = 0;
const warpBtn = page.locator("button[aria-label='Warp']").locator("visible=true").first();
await page.keyboard.down("w");
while (Date.now() - t0 < SAUCER_S * 1000 && !crashed) {
  // cycle warp every ~4 s (1→2→3→off), jump-spam: hold J ~1.5 s, plus bursts of taps
  if (step % 4 === 0) await warpBtn.tap().catch(() => {});
  await page.keyboard.down("j");
  await page.waitForTimeout(1500);
  await page.keyboard.up("j");
  for (let i = 0; i < 4; i++) { await page.keyboard.press("j"); await page.waitForTimeout(330); }
  if (step % 6 === 3) { await page.keyboard.up("w"); await page.keyboard.down("s"); await page.waitForTimeout(800); await page.keyboard.up("s"); await page.keyboard.down("w"); }
  step++;
  if (Date.now() - lastSample > 15000) { lastSample = Date.now(); await sample("saucer", Math.round((Date.now() - t0) / 1000)); }
}
await page.keyboard.up("w");
await sample("saucer-end", Math.round((Date.now() - t0) / 1000));
await page.screenshot({ path: `${OUT}/${TAG}-soak-${BROWSER}-saucer.png` });
if (FIGHTER_S > 0 && !crashed) {
  await fly("fighter");
  const t1 = Date.now();
  await page.keyboard.down("=");
  await page.waitForTimeout(3000);
  await page.keyboard.up("=");
  await page.keyboard.press("b");
  lastSample = Date.now();
  while (Date.now() - t1 < FIGHTER_S * 1000 && !crashed) {
    await page.waitForTimeout(5000);
    if (Date.now() - lastSample > 15000) { lastSample = Date.now(); await sample("fighter", Math.round((Date.now() - t0) / 1000)); }
  }
  await sample("fighter-end", Math.round((Date.now() - t0) / 1000));
  await page.screenshot({ path: `${OUT}/${TAG}-soak-${BROWSER}-fighter.png` });
}
const appErrors = await page.evaluate(() => window.__mfErrors ?? null).catch(() => "page gone");
const res = { tag: TAG, browser: BROWSER, crashed, pageErrors, appErrors, samples };
fs.writeFileSync(`${OUT}/${TAG}-soak-${BROWSER}.json`, JSON.stringify(res, null, 2));
console.log("crashed:", crashed, "pageErrors:", pageErrors.length);
await browser.close();
