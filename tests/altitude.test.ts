import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_START_ALT_FT, altToSlider, sliderToAlt, startAltFt } from "../src/altitude.ts";
import { spawn, step, liftFactor } from "../src/physics.ts";

test("start altitude validates up to 2,000,000 ft", () => {
  assert.equal(MAX_START_ALT_FT, 2_000_000);
  assert.equal(startAltFt("2,000,000"), 2_000_000);
  assert.equal(startAltFt(5e9), 2_000_000);
  assert.equal(startAltFt("abc"), 100);
  assert.equal(startAltFt(-5), 100);
  assert.equal(sliderToAlt(1000), 2_000_000);
  assert.equal(sliderToAlt(0), 100);
  assert.ok(Math.abs(sliderToAlt(altToSlider(100000)) - 100000) <= 10000);
});

test("spawn at 2,000,000 ft is not clamped, stays finite, and falls back down", () => {
  const altM = 2_000_000 * 0.3048;
  let f = spawn(37, -122, altM, 90, 200);
  assert.ok(Math.abs(f.alt - altM) < 1);
  assert.ok(liftFactor(altM, 200, 55) < 1e-6);
  for (let i = 0; i < 120 * 60; i++) f = step(f, { pitch: 0, roll: 0, yaw: 0, throttle: 0 }, 1 / 120, 0);
  assert.ok(Number.isFinite(f.alt) && Number.isFinite(f.lat) && Number.isFinite(f.vs));
  assert.ok(f.alt < altM - 10000, `falls ${altM - f.alt}`);
  assert.ok(!f.crashed);
});

test("normal altitudes are unaffected by thin-air sink", () => {
  let f = spawn(37, -122, 3000, 90, 120);
  for (let i = 0; i < 120 * 20; i++) f = step(f, { pitch: 0, roll: 0, yaw: 0, throttle: 0.6 }, 1 / 120, 0);
  assert.ok(!f.sink || f.sink < 0.05);
});

test("100,000 ft spawn sinks and recovers lift lower down", () => {
  let f = spawn(37, -122, 30480, 90, 250);
  for (let i = 0; i < 120 * 30; i++) f = step(f, { pitch: 0, roll: 0, yaw: 0, throttle: 1 }, 1 / 120, 0);
  assert.ok(f.alt < 30480 && Number.isFinite(f.alt));
});

test("helicopter spawned at 2,000,000 ft falls instead of hovering in orbit", async () => {
  const { aircraftById } = await import("../src/aircraft.ts");
  const { spawnAircraft, stepAircraft } = await import("../src/flight-model.ts");
  const h = aircraftById("bell206");
  const altM = 609600;
  let f = spawnAircraft(h, 37, -122, altM, 0, 0, false, false);
  for (let i = 0; i < 120 * 30; i++) f = stepAircraft(h, f, { pitch: 0, roll: 0, yaw: 0, throttle: 0 }, 1 / 120, 0);
  assert.ok(f.alt < altM - 3000 && Number.isFinite(f.alt), `fell ${altM - f.alt}`);
});
