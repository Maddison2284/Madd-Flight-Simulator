import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, step } from "../src/physics.ts";
const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
for (const direction of [-1, 1])
  test(`continuous ${direction > 0 ? "right" : "left"} roll completes 360 degrees`, () => {
    let f = spawn(0, 0, 10000, 90, 120),
      total = 0,
      sawInverted = false;
    for (let i = 0; i < 480; i++) {
      const before = f.roll;
      f = step(f, { ...neutral, roll: direction }, 1 / 60, 0);
      const delta = ((f.roll - before + 540) % 360) - 180;
      total += delta;
      sawInverted ||= Math.abs(f.roll) > 170;
      assert.ok(
        Object.values(f).every(
          (x) => typeof x !== "number" || Number.isFinite(x),
        ),
      );
    }
    assert.ok(sawInverted);
    assert.ok(Math.abs(total - direction * 360) < 1e-6);
    assert.ok(Math.abs(f.roll) < 1e-6);
  });
test("releasing roll input holds inverted bank", () => {
  const f = { ...spawn(0, 0, 1000, 0, 120), roll: 170 };
  assert.equal(step(f, neutral, 0.05, 0).roll, 170);
});
test("pulling up while inverted points the nose down", () => {
  const f = { ...spawn(0, 0, 1000, 0, 120), roll: -180 };
  assert.ok(step(f, { ...neutral, pitch: 1 }, 0.05, 0).pitch < 0);
});
test("knife-edge turn rate stays finite and bounded on either side", () => {
  for (const roll of [89.999, 90, 90.001, -89.999, -90, -90.001, 179.99]) {
    const f = { ...spawn(0, 0, 1000, 90, 120), roll };
    const next = step(f, neutral, 0.05, 0);
    assert.ok(Math.abs(next.heading - 90) < 2);
  }
});
