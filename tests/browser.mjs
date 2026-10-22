// End-to-end test against npm run dev or npm run preview.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const launchOptions = {
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
};
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)
  launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const browser = await chromium.launch(launchOptions);
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Deterministic fallback test: neither external maps nor external geocoding is required.
  await page.route("https://tile.openstreetmap.org/**", (r) => r.abort());
  await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
  await page.route("https://nominatim.openstreetmap.org/**", (r) =>
    r.fulfill({
      json: [
        { display_name: "Sydney, Australia", lat: "-33.856", lon: "151.215" },
      ],
    }),
  );
  await page.goto(process.env.TEST_URL || "http://localhost:5173", {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "Start flight" }).waitFor();
  const search = page.getByRole("textbox", { name: "Search worldwide" });
  await search.fill("Sydney");
  await page.getByRole("button", { name: "Find location" }).click();
  await page.getByRole("button", { name: "Sydney, Australia" }).click();
  assert.match(
    await page.locator(".destination").innerText(),
    /Sydney, Australia/,
  );
  await search.fill("40.7, -74.0");
  await search.press("Enter");
  assert.match(await page.locator(".destination").innerText(), /40.7000/);
  await page.waitForTimeout(1500);
  await page.locator("canvas").click({ position: { x: 850, y: 400 } });
  assert.match(
    await page.locator(".destination").innerText(),
    /Custom departure/,
  );
  const inputs = page.locator(".settings input");
  await inputs.nth(0).fill("6500");
  await inputs.nth(1).fill("180");
  await inputs.nth(2).fill("250");
  await page.getByRole("button", { name: "Start flight" }).click();
  await page.locator(".instruments").waitFor();
  assert.match(await page.locator(".heading-strip").innerText(), /180/);
  const instrument = (label) =>
    page
      .locator(".instrument")
      .filter({ has: page.locator("small", { hasText: label }) })
      .locator("strong");
  const startingAltitude = Number(
    (await instrument("ALTITUDE").innerText()).replaceAll(",", ""),
  );
  assert.ok(startingAltitude >= 6500);
  await page.locator("canvas").click({ position: { x: 900, y: 350 } });
  await page.keyboard.down("ArrowDown");
  await page.keyboard.down("=");
  await page.waitForTimeout(2500);
  await page.keyboard.up("ArrowDown");
  await page.keyboard.up("=");
  await page.waitForTimeout(500);
  assert.ok(
    Number(await instrument("THROTTLE").innerText()) > 65,
    "keyboard raises throttle",
  );
  assert.ok(
    Number((await instrument("ALTITUDE").innerText()).replaceAll(",", "")) >
      startingAltitude,
    "pitch control climbs",
  );
  await page.keyboard.press("c");
  await page.getByRole("button", { name: /Cockpit/ }).waitFor();
  await page.getByLabel("Business jet cockpit interior").waitFor();
  await page.getByLabel("Camera view").selectOption("wing");
  assert.equal(await page.locator("main").getAttribute("data-camera"), "wing");
  await page.getByLabel("Camera view").selectOption("front");
  assert.equal(await page.locator("main").getAttribute("data-camera"), "front");
  await page.getByLabel("Camera view").selectOption("cockpit");
  await page.locator("canvas").click({ position: { x: 900, y: 350 } });
  await page.keyboard.press("p");
  await page.getByText("FLIGHT PAUSED", { exact: true }).waitFor();
  await page.keyboard.press("p");
  await page
    .getByText("FLIGHT PAUSED", { exact: true })
    .waitFor({ state: "hidden" });
  await page.getByRole("button", { name: /Enable Google 3D/ }).click();
  assert.match(
    await page.getByRole("alert").innerText(),
    /needs VITE_GOOGLE_MAPS_API_KEY/,
  );
  await page.getByRole("alert").click();
  await page.screenshot({ path: "flight.png" });
  await page.getByRole("button", { name: /Flight planner/ }).click();
  await page.getByRole("button", { name: "Start flight" }).waitFor();
  await page.screenshot({ path: "planner.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
    "mobile layout fits viewport",
  );
  assert.deepEqual(errors, [], "no browser JavaScript errors");
  console.log(
    "PASS: search, coordinates, map pick, spawn, keyboard flight, cameras, pause, scenery fallback, missing-key handling and mobile layout.",
  );
} finally {
  await browser.close();
}
