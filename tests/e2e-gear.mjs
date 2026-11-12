// DEV-ONLY (not part of `npm test`): landing-gear retract/extend checks on the
// harness app (npx vite --config harness/app/vite.config.ts).
//   TEST_URL=http://localhost:5209 node tests/e2e-gear.mjs
// Chromium desktop: fighter spawns airborne gear UP; G extends (animated),
// G retracts; screenshots from a low orbit angle. WebKit iPhone 15
// portrait/landscape + iPad: GEAR button visible, inside the viewport, not
// overlapping other controls, and a tap toggles the gear.
import { chromium, webkit, devices } from "playwright";
import fs from "node:fs";
const BASE = process.env.TEST_URL || "http://localhost:5209";
const OUT = process.env.SHOTS || "/workspace/maddflight/shots/gear";
fs.mkdirSync(OUT, { recursive: true });
const ent = { userId: "u", email: "pilot@example.com", isAdmin: true, entitled: true, trialRemainingMs: 0, token: "t", reason: "admin", hasSubscription: false, lifetime: false, plan: null, periodEnd: null, cancelAtPeriodEnd: false };
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);
  if (!ok) failed++;
};
async function prepare(page, aircraft = "fighter") {
  await page.route("https://tile.openstreetmap.org/**", (r) => r.abort());
  await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
  await page.route("https://fonts.gstatic.com/**", (r) => r.abort());
  await page.route("**/api/entitlement", (r) => r.fulfill({ json: ent }));
  await page.addInitScript((id) => {
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    localStorage.clear();
    localStorage.setItem("maddflight-aircraft", id);
  }, aircraft);
}
async function start(page, tap = false) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  const btn = page.getByRole("button", { name: "Start flight" });
  await btn.waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  for (let i = 0; i < 4; i++) {
    if (await btn.isVisible().catch(() => false)) await (tap ? btn.tap() : btn.click()).catch(() => {});
    try {
      await page.waitForFunction(() => window.__mfGear?.aircraft && document.querySelector("main")?.dataset.gear, null, { timeout: 15000 });
      if (await page.evaluate(() => document.documentElement.classList.contains("in-flight") || !!document.querySelector(".instruments")))
        break;
    } catch {}
  }
  await page.waitForTimeout(1500);
}
const gear = (page) => page.evaluate(() => window.__mfGear);
async function frontView(page) {
  // C cycles chase → cockpit → wing → front; the front camera looks back at
  // the nose and belly, where the gear is.
  for (let i = 0; i < 3; i++) await page.keyboard.press("c");
  await page.waitForFunction(() => document.querySelector("main")?.dataset.camera === "front", null, { timeout: 10000 }).catch(() => {});
}
async function wingView(page) {
  for (let i = 0; i < 2; i++) await page.keyboard.press("c");
}
async function desktop() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await prepare(page);
  await start(page);
  let g = await gear(page);
  check("desktop fighter retractable", g.retractable === true, JSON.stringify(g));
  check("airborne spawn (>500 ft) starts gear UP", g.up === true && g.status === "up", JSON.stringify(g));
  const btn = page.locator(".desktop-gear");
  check("desktop Gear button visible", await btn.isVisible());
  check("desktop Gear button label", /Gear up/.test(await btn.innerText()), await btn.innerText());
  await page.keyboard.press("g");
  await page.waitForTimeout(500);
  g = await gear(page);
  check("G extends: moving", g.up === false && g.status === "moving" && g.pos > 0 && g.pos < 1, JSON.stringify(g));
  // Software GL runs at a few fps (frame dt capped at 0.25 s), so wait on state.
  await page.waitForFunction(() => window.__mfGear.status === "down", null, { timeout: 20000 }).catch(() => {});
  g = await gear(page);
  check("gear DOWN after the cycle", g.status === "down" && g.pos === 0, JSON.stringify(g));
  check("HUD indicator DOWN", (await page.locator(".gear-ind span").innerText()) === "DOWN");
  await frontView(page);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/desktop-gear-down.png` });
  await page.keyboard.press("g");
  await page.waitForFunction(() => window.__mfGear.pos > 0.05, null, { timeout: 20000 }).catch(() => {});
  g = await gear(page);
  check("G retracts: moving", g.up === true && g.status === "moving", JSON.stringify(g));
  check("HUD indicator MOVING", (await page.locator(".gear-ind span").innerText()) === "MOVING");
  await page.screenshot({ path: `${OUT}/desktop-gear-retracting.png` });
  await page.waitForFunction(() => window.__mfGear.status === "up", null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
  g = await gear(page);
  check("gear UP", g.status === "up" && g.pos === 1, JSON.stringify(g));
  await page.screenshot({ path: `${OUT}/desktop-gear-up.png` });
  // Button click toggles too.
  await btn.click();
  await page.waitForFunction(() => window.__mfGear.up === false, null, { timeout: 10000 }).catch(() => {});
  g = await gear(page);
  check("Gear button click extends", g.up === false, JSON.stringify(g));
  // Help lists G.
  const help = await page.evaluate(() => document.body.innerText.includes("Landing gear up / down") || null);
  console.log("help text in DOM (only if open):", help);
  await browser.close();
}

async function mobile() {
  const browser = await webkit.launch({ headless: true, env: { ...process.env, GST_REGISTRY_FORK: "no", GST_PLUGIN_SYSTEM_PATH: "/usr/lib/x86_64-linux-gnu/gstreamer-1.0" } });
  const iphone = devices["iPhone 15"];
  const ipad = devices["iPad (gen 7)"];
  const land = (d) => ({ ...d, viewport: { width: d.viewport.height, height: d.viewport.width } });
  for (const [name, dev] of [
    ["iphone15-portrait", iphone],
    ["iphone15-landscape", land(iphone)],
    ["ipad-portrait", ipad],
    ["ipad-landscape", land(ipad)],
  ]) {
    const ctx = await browser.newContext({ ...dev });
    const page = await ctx.newPage();
    await prepare(page);
    await start(page, true);
    const btn = page.locator(".phone-actions .gear-btn");
    const desk = page.locator(".desktop-gear");
    const visible = (await btn.isVisible().catch(() => false)) || (await desk.isVisible().catch(() => false));
    const el = (await btn.isVisible().catch(() => false)) ? btn : desk;
    check(`${name} GEAR button visible`, visible);
    const box = await el.boundingBox();
    const vp = page.viewportSize();
    check(`${name} GEAR inside viewport`, box && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height, JSON.stringify(box));
    const overlaps = await page.evaluate(({ x, y, width, height }) => {
      const hits = [];
      for (const sel of [".flight-actions button", ".flight-actions select", ".phone-actions > button:not(.gear-btn)", ".phone-actions .gauge-size", ".desktop-boost:not(.desktop-gear)", ".touch-toggle", ".instruments", ".phone-hud", "header", ".touch-power", ".stick-group", ".heading-strip"]) {
        for (const el of document.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect();
          if (getComputedStyle(el).display === "none" || getComputedStyle(el).visibility === "hidden" || r.width === 0) continue;
          if (r.left < x + width - 1 && r.right > x + 1 && r.top < y + height - 1 && r.bottom > y + 1) hits.push(sel);
        }
      }
      return hits;
    }, box);
    check(`${name} GEAR no overlap`, overlaps.length === 0, JSON.stringify(overlaps));
    const before = await gear(page);
    await el.tap();
    await page.waitForFunction((u) => window.__mfGear.up !== u && window.__mfGear.status !== "moving", before.up, { timeout: 20000 }).catch(() => {});
    const after = await gear(page);
    check(`${name} tap toggles gear`, after.up !== before.up && after.status === (after.up ? "up" : "down"), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    const hudGear = await page.locator(".hud-gear").isVisible().catch(() => false);
    console.log(`${name} phone HUD gear chip visible: ${hudGear}`);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    await ctx.close();
  }
  await browser.close();
}

if (process.env.ONLY !== "mobile") await desktop();
if (process.env.ONLY !== "desktop") await mobile();
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
