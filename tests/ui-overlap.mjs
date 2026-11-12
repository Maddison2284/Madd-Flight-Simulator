// DEV-ONLY: in-flight HUD overlap / offscreen check across many viewports and
// camera views. Run against the harness dev server (mocked Clerk + API):
//   npx vite --config harness/app/vite.config.ts --port 5211
//   npm run test:overlap   (TAG, WIDTHS, ONLY=desktop|touch, ENT=trial|pro, OUT)
// Exit code 1 on any overlap, offscreen/clipped item, covered credit,
// detached avatar, HUD panel in cockpit, or panel off the bottom edge.
import { chromium } from "playwright";
import fs from "node:fs";
const BASE = process.env.TEST_URL || "http://localhost:5211";
const OUT = process.env.OUT || "test-results/ui-overlap";
const TAG = process.env.TAG || "run";
fs.mkdirSync(OUT, { recursive: true });
const ent = { userId: "u", email: "pilot@example.com", isAdmin: true, entitled: true, trialRemainingMs: 0, token: "t", reason: "admin", hasSubscription: false, lifetime: false, plan: null, periodEnd: null, cancelAtPeriodEnd: false };
if (process.env.ENT === "trial") Object.assign(ent, { isAdmin: false, entitled: false, reason: "trial", trialRemainingMs: 300000 });
if (process.env.ENT === "pro") Object.assign(ent, { isAdmin: false, entitled: true, reason: "subscription", plan: "monthly", periodEnd: Date.now() + 20 * 864e5, hasSubscription: true });
const WIDTHS = (process.env.WIDTHS || "360,390,600,768,820,900,1024,1100,1180,1240,1280,1440,1920,2560").split(",").map(Number);
const sizes = [];
for (const w of WIDTHS) {
  sizes.push([w, w <= 1024 ? Math.min(1366, Math.round((w * 16) / 9)) : Math.round((w * 10) / 16)]);
  sizes.push([w, w < 600 ? Math.round((w * 16) / 9) + 1 : Math.max(360, Math.round((w * 9) / 16))]);
}
if (!process.env.WIDTHS || process.env.EXTRA) sizes.push([1280, 800], [390, 844]);
const PHONE_LAND = [[740, 360], [844, 390], [932, 430]];
const LEAVES = [
  "header .brand", "header .top-right > *", ".flight-actions > *", ".heading-strip", ".touch-toggle", ".desktop-boost",
  ".phone-actions > *", ".phone-hud", ".instruments", ".touch-controls .stick-group", ".touch-controls .touch-power",
  ".touch-controls .vert-buttons", "footer > div", "footer > span", ".cesium-credit-logoContainer", ".cesium-credit-textContainer",
  ".rotate-hint", ".cockpit-art",
];
const browser = await chromium.launch({ headless: true, executablePath: process.env.PW_EXE || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let fails = 0, checked = 0;
const report = [];
const SHOT_AT = new Set(["1280x800", "390x844", "844x390", "1024x1366", "1100x688", "900x1200", "820x1366", "1180x738", "768x1366"]);
async function measure(page) {
  return page.evaluate((LEAVES) => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      for (let n = e; n && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return null;
      }
      return r;
    };
    const items = [];
    for (const sel of LEAVES)
      document.querySelectorAll(sel).forEach((e, i) => {
        const r = vis(e);
        if (r) items.push({ sel, i, el: e, r: [r.left, r.top, r.right, r.bottom], label: (e.getAttribute("aria-label") || e.textContent || e.className || "").trim().replace(/\s+/g, " ").slice(0, 28) });
      });
    const issues = [];
    const W = innerWidth, H = innerHeight;
    for (const a of items)
      if (a.sel !== ".cockpit-art" && (a.r[0] < -0.5 || a.r[1] < -0.5 || a.r[2] > W + 0.5 || a.r[3] > H + 0.5))
        issues.push(`OFFSCREEN ${a.sel}#${a.i} "${a.label}" ${a.r.map(Math.round)}`);
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (a.sel === ".cockpit-art" || b.sel === ".cockpit-art") continue; // full-screen artwork layer
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const ox = Math.min(a.r[2], b.r[2]) - Math.max(a.r[0], b.r[0]);
        const oy = Math.min(a.r[3], b.r[3]) - Math.max(a.r[1], b.r[1]);
        if (ox > 1 && oy > 1) issues.push(`OVERLAP ${a.sel}#${a.i} "${a.label}" × ${b.sel}#${b.i} "${b.label}" (${Math.round(ox)}x${Math.round(oy)})`);
      }
    const cam = document.querySelector("main")?.dataset.camera;
    const inst = items.find((x) => x.sel === ".instruments");
    const hud = items.find((x) => x.sel === ".phone-hud");
    const credit = items.find((x) => x.sel === ".cesium-credit-logoContainer");
    if (!credit) issues.push("CREDIT not visible");
    const av = document.querySelector("header .cl-userButtonTrigger")?.getBoundingClientRect();
    const cr = [...document.querySelectorAll("header .top-right > button")].map((b) => b.getBoundingClientRect()).find((b) => b.width);
    if (av && av.width && cr) {
      if (Math.abs((av.top + av.bottom) / 2 - (cr.top + cr.bottom) / 2) > 3 || Math.abs(av.height - cr.height) > 2) issues.push(`AVATAR not in row (avatar ${Math.round(av.top)}-${Math.round(av.bottom)}, buttons ${Math.round(cr.top)}-${Math.round(cr.bottom)})`);
      if (cr.left - av.right > 12) issues.push(`AVATAR detached (gap ${Math.round(cr.left - av.right)} px)`);
    }
    for (const el of document.querySelectorAll(".cesium-credit-logoContainer, .cesium-credit-textContainer")) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      for (const fx of [0.2, 0.5, 0.8]) {
        const top = document.elementFromPoint(r.left + r.width * fx, r.top + r.height / 2);
        if (top && !el.contains(top) && !top.contains(el) && !top.closest(".cesium-viewer-bottom")) { issues.push(`CREDIT covered by ${top.className || top.tagName}`); break; }
      }
    }
    for (const el of document.querySelectorAll(".instruments, .phone-hud, .flight-actions, .top-right, header .top-right > button, header .top-right > a, header .top-right > .trial-chip, header .top-right > .plan-chip, .flight-actions > *, .hud-right > *")) {
      const cs = getComputedStyle(el);
      if (cs.display !== "none" && el.scrollWidth > el.clientWidth + 2) issues.push(`CLIPPED ${el.className} content ${el.scrollWidth} > ${el.clientWidth}`);
    }
    if (cam === "cockpit") {
      if (inst) issues.push("COCKPIT shows .instruments panel");
      if (hud) issues.push("COCKPIT shows .phone-hud");
      if (!items.find((x) => x.sel === ".cockpit-art")) issues.push("COCKPIT gauges missing");
    } else if (inst && document.querySelector("main")?.dataset.touch !== "true") {
      const gap = H - inst.r[3];
      if (gap > 48) issues.push(`INSTRUMENTS not at bottom (gap ${Math.round(gap)} px)`);
    }
    return { n: items.length, issues, touch: document.querySelector("main")?.dataset.touch, cam, instGap: inst ? Math.round(H - inst.r[3]) : null };
  }, LEAVES);
}
async function setCam(page, want) {
  for (let i = 0; i < 5; i++) {
    if ((await page.evaluate(() => document.querySelector("main")?.dataset.camera)) === want) return;
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("c");
    await page.waitForTimeout(400);
  }
}
async function run(kind, list) {
  const mobile = kind === "touch";
  const ctx = await browser.newContext({ viewport: { width: list[0][0], height: list[0][1] }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.route("https://tile.openstreetmap.org/**", (r) => r.abort());
  await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
  await page.route("https://fonts.gstatic.com/**", (r) => r.abort());
  await page.route("**/api/entitlement", (r) => r.fulfill({ json: ent }));
  await page.addInitScript(() => {
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    localStorage.clear();
    localStorage.setItem("maddflight-aircraft", "fighter");
  });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  const btn = page.getByRole("button", { name: "Start flight" });
  await btn.waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  await btn.click({ force: true });
  await page.locator(".instruments, .phone-hud").locator("visible=true").first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(2500);
  for (const [w, h] of list) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(600);
    const views = SHOT_AT.has(`${w}x${h}`) ? ["chase", "wing", "front", "cockpit"] : ["chase", "cockpit"];
    for (const cam of views) {
      await setCam(page, cam);
      await page.waitForTimeout(500);
      const res = await measure(page);
      checked++;
      const name = `${kind}-${w}x${h}-${cam}`;
      report.push({ name, ...res });
      console.log(`${res.issues.length ? "FAIL" : "PASS"} ${name} (${res.n} el, touch=${res.touch}, instGap=${res.instGap})`);
      for (const s of res.issues) console.log("   ", s);
      if (res.issues.length) fails++;
      if (SHOT_AT.has(`${w}x${h}`) || res.issues.length) await page.screenshot({ path: `${OUT}/${TAG}-${name}.png` });
    }
    await setCam(page, "chase");
  }
  await ctx.close();
}
if (process.env.ONLY !== "touch") await run("desktop", sizes.filter(([w]) => w >= 600));
if (process.env.ONLY !== "desktop") await run("touch", [...sizes.filter(([w]) => w <= 1024), ...PHONE_LAND]);
await browser.close();
fs.writeFileSync(`${OUT}/${TAG}-report.json`, JSON.stringify(report, null, 1));
console.log(`${checked} checks, ${fails} with issues`);
process.exit(fails ? 1 : 0);
