import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {}),
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1024, height: 768 },
  ]) {
    const page = await browser.newPage({
      viewport,
      hasTouch: true,
      isMobile: true,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("https://tile.openstreetmap.org/**", (r) => r.abort());
    await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
    await page.goto(process.env.TEST_URL || "http://localhost:5173", {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: "Start flight" }).tap();
    await page.getByRole("region", { name: "Touch flight controls" }).waitFor();
    const stick = page.getByRole("group", { name: /Flight stick/ }),
      box = await stick.boundingBox(),
      rudder = await page
        .getByRole("button", { name: "Yaw right", exact: true })
        .boundingBox();
    assert.ok(box && rudder);
    const session = await page.context().newCDPSession(page);
    const point = {
      x: box.x + box.width / 2 + 25,
      y: box.y + box.height / 2 + 30,
      id: 1,
    };
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        point,
        {
          x: rudder.x + rudder.width / 2,
          y: rudder.y + rudder.height / 2,
          id: 2,
        },
      ],
    });
    await page.waitForTimeout(2000);
    assert.ok(
      Number(
        (
          await page
            .locator(".instrument")
            .filter({ has: page.locator("small", { hasText: "ALTITUDE" }) })
            .locator("strong")
            .innerText()
        ).replaceAll(",", ""),
      ) > 3000,
      "touch stick climbs",
    );
    assert.notEqual(
      (await page.locator(".heading-strip").innerText()).trim(),
      "090°\nHEADING",
      "simultaneous rudder and roll turn aircraft",
    );
    await session.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    assert.match(
      await page.locator(".stick-knob").getAttribute("style"),
      /translate\(0px, 0px\)/,
      "cancellation centers stick",
    );
    const slider = await page
      .getByRole("slider", { name: "Touch throttle" })
      .boundingBox();
    await page.touchscreen.tap(
      slider.x + slider.width * 0.85,
      slider.y + slider.height / 2,
    );
    assert.ok(
      Number(
        await page.getByRole("slider", { name: "Touch throttle" }).inputValue(),
      ) >= 75,
      "touch throttle adjusts",
    );
    await page.getByLabel("Camera view").selectOption("cockpit");
    await page.getByLabel("Business jet cockpit interior").waitFor();
    await page.getByRole("button", { name: /Pause/ }).tap();
    await page.getByText("FLIGHT PAUSED", { exact: true }).waitFor();
    const instrumentBox = await page.locator(".instruments").boundingBox();
    assert.ok(
      instrumentBox.y + instrumentBox.height <= box.y ||
        instrumentBox.x >= box.x + box.width,
      "instruments clear the stick",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `touch-${viewport.width}.png` });
    await page.close();
    console.log(`PASS touch controls ${viewport.width}×${viewport.height}`);
  }
} finally {
  await browser.close();
}
