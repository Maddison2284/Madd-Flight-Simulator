import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyRatesToEuler, spawn, step } from "../src/physics.ts";
const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);
test("wings-level elevator changes elevation without yaw", () => {
  const rate = bodyRatesToEuler(0, 0, 0, 18, 0);
  close(rate.pitch, 18);
  close(rate.heading, 0);
});
for (const bank of [-60, 60])
  test(`elevator in a ${bank} degree bank tightens or opens the banked turn`, () => {
    const rate = bodyRatesToEuler(0, bank, 0, 18, 0);
    close(rate.pitch, 9);
    assert.ok(rate.heading * Math.sign(bank) > 15);
    const f = { ...spawn(0, 0, 1000, 90, 120), roll: bank };
    const neutral = step(
      f,
      { pitch: 0, roll: 0, yaw: 0, throttle: 0 },
      0.05,
      0,
    );
    const pull = step(f, { pitch: 1, roll: 0, yaw: 0, throttle: 0 }, 0.05, 0);
    const push = step(f, { pitch: -1, roll: 0, yaw: 0, throttle: 0 }, 0.05, 0);
    assert.ok((pull.heading - neutral.heading) * Math.sign(bank) > 0);
    assert.ok((push.heading - neutral.heading) * Math.sign(bank) < 0);
    assert.ok(pull.pitch < 0.5, "bank reduces vertical part of elevator");
  });
test("at knife-edge elevator steers sideways and rudder changes elevation", () => {
  const elevator = bodyRatesToEuler(0, 90, 0, 18, 0);
  close(elevator.pitch, 0);
  close(elevator.heading, 18);
  const rudder = bodyRatesToEuler(0, 90, 0, 0, 10);
  close(rudder.pitch, -10);
  close(rudder.heading, 0);
});
test("body rates stay finite through sustained banked pitch input", () => {
  let f = { ...spawn(0, 0, 10000, 90, 120), roll: 65 };
  for (let i = 0; i < 10000; i++)
    f = step(f, { pitch: 1, roll: 0.3, yaw: 0.1, throttle: 0 }, 1 / 60, 0);
  assert.ok(
    Object.values(f).every((x) => typeof x !== "number" || Number.isFinite(x)),
  );
});
