import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_UNITS, parseUnits, speedFromMs, speedToMs, speedFromKt, speedToKt,
  altFromM, altToM, altFromFt, altToFt, vsFromMs, fmtInt, fmtVs, speedLabel, altLabel, vsLabel,
  formatDistanceUnits,
} from "../src/units.ts";

test("default units are Imperial (mph / ft / ft/min); bad saved value falls back", () => {
  assert.equal(DEFAULT_UNITS, "imperial");
  assert.equal(parseUnits(null), "imperial");
  assert.equal(parseUnits("bogus"), "imperial");
  assert.equal(parseUnits("metric"), "metric");
  assert.equal(speedLabel("imperial"), "MPH");
  assert.equal(altLabel("imperial"), "FT");
  assert.equal(vsLabel("imperial"), "FT / MIN");
  assert.equal(speedLabel("aviation"), "KT");
  assert.equal(speedLabel("metric"), "KM/H");
  assert.equal(altLabel("metric"), "M");
});

test("exact conversions", () => {
  assert.ok(Math.abs(speedFromMs(44.704, "imperial") - 100) < 1e-9);
  assert.ok(Math.abs(speedFromMs(51.4444444444, "aviation") - 100) < 1e-6);
  assert.ok(Math.abs(speedFromMs(10, "metric") - 36) < 1e-9);
  assert.ok(Math.abs(speedFromKt(100, "imperial") - 115.0779448) < 1e-6);
  assert.ok(Math.abs(altFromM(304.8, "imperial") - 1000) < 1e-9);
  assert.equal(altFromM(500, "metric"), 500);
  assert.ok(Math.abs(vsFromMs(5.08, "imperial") - 1000) < 1e-9);
  assert.equal(vsFromMs(3, "metric"), 3);
  assert.ok(Math.abs(altFromFt(2_000_000, "metric") - 609600) < 1e-6);
});

test("round trips do not drift", () => {
  for (const u of ["imperial", "aviation", "metric"] as const) {
    let kt = 230;
    let ft = 3000;
    for (let i = 0; i < 1000; i++) {
      kt = speedToKt(speedFromKt(kt, u), u);
      ft = altToFt(altFromFt(ft, u), u);
    }
    assert.ok(Math.abs(kt - 230) < 1e-9, `${u} kt ${kt}`);
    assert.ok(Math.abs(ft - 3000) < 1e-9, `${u} ft ${ft}`);
    for (const ms of [0, 1, 77.7, 340.29, 1000]) {
      assert.ok(Math.abs(speedToMs(speedFromMs(ms, u), u) - ms) < 1e-9);
      assert.ok(Math.abs(altToM(altFromM(ms, u), u) - ms) < 1e-9);
    }
    // what you type is what you see after switching back and forth
    const typed = 150;
    assert.equal(Math.round(speedFromKt(speedToKt(typed, u), u)), typed);
  }
});

test("big numbers get commas; no -0", () => {
  assert.equal(fmtInt(2_000_000), "2,000,000");
  assert.equal(fmtInt(12345.6), "12,346");
  assert.equal(fmtInt(-0.2), "0");
  assert.equal(fmtVs(-10.16, "imperial"), "-2,000");
  assert.equal(fmtVs(-2.04, "metric"), "-2.0");
  assert.equal(formatDistanceUnits(16093.44, "imperial"), "10 mi");
  assert.equal(formatDistanceUnits(18520, "aviation"), "10 NM");
  assert.equal(formatDistanceUnits(1500, "metric"), "1.5 km");
});
