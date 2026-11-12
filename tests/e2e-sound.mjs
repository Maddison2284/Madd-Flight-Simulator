// DEV-ONLY end-to-end check (not part of `pnpm test`): run the harness app
// (npx vite --config harness/app/vite.config.ts) then `node tests/e2e-sound.mjs`.
// Real user-like clicks/taps in Chromium and WebKit (iPhone emulation).
import { chromium, webkit, devices } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
const BASE = process.env.TEST_URL || "http://localhost:5209";
const OUT = process.env.SHOTS || "/workspace/maddflight/shots/sound";
fs.mkdirSync(OUT, { recursive: true });
const ent = { userId: "u", email: "pilot@example.com", isAdmin: true, entitled: true, trialRemainingMs: 0, token: "t", reason: "admin", hasSubscription: false, lifetime: false, plan: null, periodEnd: null, cancelAtPeriodEnd: false };
const only = process.env.ONLY || "";
const results = [];
const log = (...a) => { console.log(...a); results.push(a.join(" ")); };

async function prepare(page, ls) {
  await page.route("https://tile.openstreetmap.org/**", (r) => r.abort());
  await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
  await page.route("https://fonts.gstatic.com/**", (r) => r.abort());
  await page.route("**/api/entitlement", (r) => r.fulfill({ json: ent }));
  await page.addInitScript((ls) => {
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    localStorage.clear();
    for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v);
  }, ls);
}
async function start(page, { touch = false } = {}) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  const btn = page.getByRole("button", { name: "Start flight" });
  await btn.waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  if (touch) await btn.tap(); else await btn.click();
  await page.locator(".instruments, .phone-hud").locator("visible=true").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(600);
}
const dbg = (page) => page.evaluate(() => window.__mfAudioDebug());
async function waitAudible(page, ms = 6000) {
  const t0 = Date.now();
  let d;
  while (Date.now() - t0 < ms) {
    d = await dbg(page);
    if (d.state === "running" && d.gain > 0.05 && d.rms > 0.001) return d;
    await page.waitForTimeout(250);
  }
  return d;
}
function hav(a, b) {
  const r = Math.PI / 180, R = 6371008.8 + Math.max(0, a.alt);
  const s = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return Math.hypot(2 * R * Math.asin(Math.sqrt(s)), b.alt - a.alt);
}

const glArgs = ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=user-gesture-required"];

// ---------- Chromium desktop ----------
if (!only || only === "chromium") {
  const browser = await chromium.launch({ headless: true, args: glArgs });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => log("pageerror", e.message));
    // Stale prefs from before the fix: muted + volume 0. Saucer selected.
    await prepare(page, { "maddflight-muted": "1", "maddflight-volume": "0", "maddflight-aircraft": "saucer" });
    await start(page);
    const d = await waitAudible(page);
    log("chromium audio", JSON.stringify(d));
    assert.equal(d.state, "running");
    assert.ok(d.gain > 0.5, "gain > 0 after migrating stale mute/0 volume");
    assert.ok(d.rms > 0.001, "analyser hears the engine");
    assert.equal(await page.getByRole("button", { name: "Mute" }).first().innerText().then((t) => t.includes("Sound on")), true);
    await page.screenshot({ path: `${OUT}/chromium-saucer-flight.png` });
    // Mute / unmute via the button (real click)
    await page.locator(".flight-actions .mute-toggle").click();
    await page.waitForTimeout(400);
    let m = await dbg(page);
    assert.ok(m.muted && m.gain < 0.05, `muted ${JSON.stringify(m)}`);
    await page.locator(".flight-actions .mute-toggle").click();
    await page.waitForTimeout(600);
    m = await dbg(page);
    assert.ok(!m.muted && m.gain > 0.5 && m.rms > 0.001, `unmuted ${JSON.stringify(m)}`);
    log("chromium mute/unmute ok");
    // Saucer W = up
    await page.locator("canvas").first().click({ position: { x: 700, y: 400 } });
    const alt0 = await page.evaluate(() => Number(document.querySelector("main").getAttribute("data-alt") ?? "NaN"));
    const altText = async () => (await page.locator(".instrument").filter({ hasText: "ALTITUDE" }).locator("strong").innerText()).replace(/,/g, "");
    const a0 = Number(await altText());
    await page.keyboard.down("w");
    await page.waitForTimeout(2000);
    await page.keyboard.up("w");
    const a1 = Number(await altText());
    log("chromium saucer W climb ft", a0, "->", a1);
    assert.ok(a1 > a0 + 20, "W climbs");
    await page.keyboard.down("s");
    await page.waitForTimeout(4000);
    await page.keyboard.up("s");
    const a2 = Number(await altText());
    log("chromium saucer S descend ft", a1, "->", a2);
    assert.ok(a2 < a1 - 20, "S descends");
    // Jump warp: J
    await page.keyboard.press("j");
    await page.waitForTimeout(80);
    await page.screenshot({ path: `${OUT}/chromium-jump-flash.png` });
    const j = await page.evaluate(() => window.__mfLastJump);
    const dist = hav(j.from, j.to);
    log("chromium jump distance m", dist.toFixed(1), JSON.stringify(j));
    assert.ok(Math.abs(dist - 1609.344) < 5, "≈1 mile");
    await page.waitForTimeout(400);
    await page.keyboard.down("Shift");
    await page.keyboard.press("j");
    await page.keyboard.up("Shift");
    const jb = await page.evaluate(() => window.__mfLastJump);
    const distB = hav(jb.from, jb.to);
    log("chromium shift+J distance m", distB.toFixed(1));
    assert.ok(Math.abs(distB - 16093.44) < 40);
    // hold J repeats with cooldown
    await page.waitForTimeout(400);
    const n0 = Number(await page.locator("main").getAttribute("data-jumps"));
    await page.keyboard.down("j");
    await page.waitForTimeout(1100);
    await page.keyboard.up("j");
    const n1 = Number(await page.locator("main").getAttribute("data-jumps"));
    log("chromium hold J jumps in 1.1 s", n1 - n0);
    // Speed warp B x3
    for (const lvl of [1, 2, 3]) {
      await page.keyboard.press("b");
      await page.waitForTimeout(150);
      assert.equal(await page.locator("main").getAttribute("data-warp"), String(lvl));
    }
    await page.waitForTimeout(6000);
    const machTxt = await page.locator(".instrument").filter({ hasText: "MACH" }).innerText();
    log("chromium warp 3 HUD", machTxt.replace(/\s+/g, " "));
    assert.match(machTxt, /WARP 3/);
    await page.screenshot({ path: `${OUT}/chromium-warp3.png` });
    await page.keyboard.press("b");
    await page.waitForTimeout(150);
    assert.equal(await page.locator("main").getAttribute("data-warp"), "0");
    const end = await dbg(page);
    log("chromium audio after warp", JSON.stringify(end));
    await ctx.close();

    // Units: HUD screenshot in each mode
    for (const u of ["imperial", "aviation", "metric"]) {
      const c2 = await browser.newContext({ viewport: { width: 1366, height: 860 } });
      const p2 = await c2.newPage();
      await prepare(p2, { "maddflight-aircraft": "citation", ...(u === "imperial" ? {} : { "maddflight-units": u }) });
      await start(p2);
      await p2.waitForTimeout(800);
      const hud = await p2.locator(".instruments").innerText();
      log(`units ${u}:`, hud.replace(/\s+/g, " ").slice(0, 200));
      const want = { imperial: /MPH[\s\S]*FT MSL[\s\S]*FT \/ MIN/, aviation: /KT[\s\S]*FT MSL/, metric: /KM\/H[\s\S]*M MSL[\s\S]*M \/ S/ }[u];
      assert.match(hud, want);
      await p2.screenshot({ path: `${OUT}/hud-${u}.png` });
      await p2.keyboard.press("c"); // cockpit view
      await p2.waitForTimeout(600);
      await p2.screenshot({ path: `${OUT}/cockpit-${u}.png` });
      await c2.close();
    }
  } finally {
    await browser.close();
  }
}

// ---------- WebKit iPhone / iPad (touch) ----------
if (!only || only === "webkit") {
  const browser = await webkit.launch({ headless: true, env: { ...process.env, GST_REGISTRY_FORK: "no", GST_PLUGIN_SYSTEM_PATH: "/usr/lib/x86_64-linux-gnu/gstreamer-1.0" } });
  try {
    for (const [name, dev, landscape] of [
      ["iphone15-portrait", devices["iPhone 15"], false],
      ["iphone15-landscape", devices["iPhone 15 landscape"], true],
      ["ipad-portrait", devices["iPad (gen 7)"], false],
      ["ipad-landscape", devices["iPad (gen 7) landscape"], true],
    ]) {
      for (const craft of ["saucer", "bell206"]) {
        const ctx = await browser.newContext({ ...dev });
        const page = await ctx.newPage();
        page.on("pageerror", (e) => log("pageerror", name, e.message));
        await prepare(page, { "maddflight-muted": "1", "maddflight-aircraft": craft });
        await start(page, { touch: true });
        let d = await waitAudible(page, 5000);
        log(`webkit ${name} ${craft} audio`, JSON.stringify(d));
        // If WebKit did not count the tap, the prompt must be visible and work.
        if (d.state !== "running") {
          const prompt = page.getByRole("button", { name: /Tap for sound/ }).first();
          log(`webkit ${name} tap-for-sound visible`, await prompt.isVisible());
          await prompt.tap();
          d = await waitAudible(page, 5000);
          log(`webkit ${name} after prompt`, JSON.stringify(d));
        }
        assert.equal(d.state, "running", `${name} running`);
        assert.ok(d.gain > 0.05, `${name} gain`);
        assert.ok(d.rms > 0.001, `${name} analyser non-silent`);
        // Up/Down hold buttons visible, not overlapping menus
        const up = page.getByRole("button", { name: /Hold to (go up|climb)/ });
        const down = page.getByRole("button", { name: /Hold to (go down|descend)/ });
        assert.ok(await up.isVisible() && await down.isVisible(), `${name} up/down visible`);
        const ub = await up.boundingBox();
        const overlaps = await page.evaluate(({ x, y, width, height }) => {
          const hits = [];
          for (const sel of [".phone-actions", ".flight-actions", ".instruments", ".phone-hud", "header", ".touch-power", ".stick-group", ".heading-strip"]) {
            for (const el of document.querySelectorAll(sel)) {
              const r = el.getBoundingClientRect();
              if (getComputedStyle(el).display === "none" || r.width === 0) continue;
              if (r.left < x + width && r.right > x && r.top < y + height && r.bottom > y) hits.push(sel);
            }
          }
          return hits;
        }, ub);
        log(`webkit ${name} ${craft} up-button box`, JSON.stringify(ub), "overlaps:", JSON.stringify(overlaps));
        assert.equal(overlaps.length, 0, `${name} ${craft} UP overlaps ${overlaps}`);
        // Hold UP for 1.5 s with a real touch-ish press
        const altOf = async () => Number((await page.evaluate(() => {
          const el = [...document.querySelectorAll(".phone-hud span, .instrument")].find((e) => /MSL/.test(e.textContent || ""));
          return (el?.querySelector("strong")?.textContent ?? el?.textContent ?? "").replace(/[^0-9.-]/g, "");
        })));
        const h0 = await altOf();
        await up.dispatchEvent("pointerdown", { pointerId: 7, pointerType: "touch", isPrimary: true });
        await page.waitForTimeout(3000);
        await up.dispatchEvent("pointerup", { pointerId: 7, pointerType: "touch", isPrimary: true });
        const h1 = await altOf();
        log(`webkit ${name} ${craft} hold UP alt`, h0, "->", h1);
        assert.ok(h1 > h0 + 10, "UP climbs");
        await page.screenshot({ path: `${OUT}/webkit-${name}-${craft}.png` });
        if (craft === "saucer") {
          const jump = page.getByRole("button", { name: "Jump" }).first();
          if (await jump.isVisible()) {
            await jump.tap();
            const j = await page.evaluate(() => window.__mfLastJump);
            log(`webkit ${name} jump m`, j ? hav(j.from, j.to).toFixed(1) : "none");
          }
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
}
fs.writeFileSync(`${OUT}/e2e-log.txt`, results.join("\n") + "\n");
console.log("E2E OK");
