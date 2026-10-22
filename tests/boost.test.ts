import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, step } from "../src/physics.ts";
const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
test("arcade departure permits 2000 knots", () => {
  const f = spawn(0, 0, 10000, 90, 2000 * 0.514444, true);
  assert.ok(f.speed > 1000 && f.boost);
});
test("boost accelerates beyond normal jet speed", () => {
  let f = spawn(0, 0, 10000, 90, 120, true);
  f.throttle = 1;
  for (let i = 0; i < 600; i++) f = step(f, neutral, 1 / 60, 0);
  assert.ok(f.speed > 700 && f.speed <= 1100);
});
test("turning boost off slows gradually", () => {
  const f = { ...spawn(0, 0, 10000, 90, 900, true), boost: false };
  const n = step(f, neutral, 0.05, 0);
  assert.ok(n.speed < f.speed && n.speed > 850);
});
