// DEV-ONLY: loses the WebGL context mid-flight and checks the friendly recover screen (harness app on :5209).
import { chromium, devices } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, userAgent: devices["iPhone 15"].userAgent });
const page = await ctx.newPage();
await page.route("**/api/entitlement", (r) => r.fulfill({ json: { userId: "u", email: "p@example.com", isAdmin: true, entitled: true, trialRemainingMs: 0, token: "t", reason: "admin" } }));
await page.route("https://tile.openstreetmap.org/**", (r) => r.abort());
await page.goto("http://localhost:5209/", { waitUntil: "domcontentloaded" });
const btn = page.getByRole("button", { name: "Start flight" });
await btn.waitFor({ timeout: 60000 }); await page.waitForTimeout(1500); await btn.tap();
await page.locator(".phone-hud").waitFor({ timeout: 30000 });
await page.evaluate(() => { const c = document.querySelector(".globe canvas"); const gl = c.getContext("webgl2") || c.getContext("webgl"); gl.getExtension("WEBGL_lose_context").loseContext(); });
await page.waitForTimeout(1500);
console.log("crash screen visible:", await page.locator(".crash-screen").isVisible(), await page.locator(".crash-screen").innerText().catch(() => ""));
await page.screenshot({ path: "/workspace/maddflight/shots/saucer2/after-context-lost-recover.png" });
await browser.close();
