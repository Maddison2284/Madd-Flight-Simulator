import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, step, wrap } from "../src/physics.ts";
const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
test("spawns anywhere with normalized heading and longitude", () => {
  const f = spawn(-33, 181, 1000, 450, 120);
  assert.equal(f.lon, -179);
  assert.equal(f.heading, 90);
  assert.equal(f.alt, 1000);
});
test("eastbound flight advances longitude", () => {
  const f = spawn(0, 0, 1000, 90, 120);
  const n = step(f, neutral, 0.05, 0);
  assert.ok(n.lon > 0);
  assert.ok(Math.abs(n.lat) < 0.00001);
});
test("pitch, roll, yaw and throttle respond to controls", () => {
  const n = step(
    spawn(0, 0, 1000, 0, 120),
    { pitch: 1, roll: 1, yaw: 1, throttle: 1 },
    0.05,
    0,
  );
  assert.ok(n.pitch > 0 && n.roll > 0 && n.heading > 0 && n.throttle > 0.65);
});
test("terrain collision stops subsequent motion", () => {
  const f = spawn(0, 0, 100, 0, 120);
  f.alt = 1;
  const n = step(f, neutral, 0.05, 0);
  assert.ok(n.crashed);
  assert.equal(n.alt, 3);
  assert.equal(step(n, neutral, 0.05, 0), n);
});
test("low speed produces stall and descent", () => {
  const f = spawn(0, 0, 1000, 0, 120);
  f.speed = 30;
  const n = step(f, neutral, 0.05, 0);
  assert.ok(n.stall && n.vs < 0);
});
test("long simulation remains finite near date line and pole", () => {
  let f = spawn(89.8, 179.99, 10000, 90, 120);
  for (let i = 0; i < 10000; i++) f = step(f, neutral, 0.016, 0);
  assert.ok(
    Object.values(f).every((v) => typeof v !== "number" || Number.isFinite(v)),
  );
  assert.ok(f.lon >= -180 && f.lon <= 180);
  assert.equal(wrap(-5), 355);
});
test("frame stalls are capped", () =>
  assert.deepEqual(
    step(spawn(0, 0, 1000, 0, 120), neutral, 5, 0),
    step(spawn(0, 0, 1000, 0, 120), neutral, 0.05, 0),
  ));
