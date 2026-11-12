import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, step, type Flight, type Performance } from "../src/physics.ts";
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
test("hands-off: moderate bank levels gently, inverted flight is held", () => {
  const banked = step({ ...spawn(0, 0, 1000, 0, 120), roll: 40 }, neutral, 0.05, 0);
  assert.ok(banked.roll < 40 && banked.roll > 39, "levels gradually, not instantly");
  const inv = step({ ...spawn(0, 0, 1000, 0, 120), roll: 175 }, neutral, 0.05, 0);
  assert.ok(Math.abs(Math.abs(inv.roll) - 175) < 0.2, `inverted held ${inv.roll}`);
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

import { aircraftById } from "../src/aircraft.ts";

const fly = (f: Flight, c: typeof neutral, secs: number, perf: Performance) => {
  const trace: Flight[] = [];
  for (let i = 0; i < secs * 120; i++) { f = step(f, c, 1 / 120, 0, perf); trace.push(f); }
  return { f, trace };
};

test("fighter barrel-rolls a full 360° quickly and ends upright", () => {
  const perf = aircraftById("fighter").performance;
  let f = spawn(37, -122, 3000, 90, 200, false, perf);
  const t = 360 / perf.rollRate;
  const { f: end, trace } = fly(f, { ...neutral, roll: 1 }, t, perf);
  assert.ok(t < 2, "very agile");
  assert.ok(trace.some((x) => Math.abs(x.roll) > 170), "passes inverted");
  assert.ok(Math.abs(end.roll) < 3, `ends level ${end.roll}`);
  assert.ok(!end.crashed && end.alt > 2900);
});

test("full loop: nose goes past vertical, over the top inverted, and back level", () => {
  const perf = aircraftById("fighter").performance;
  let f = spawn(37, -122, 3000, 90, 300, false, perf);
  let maxPitch = 0, inverted = false, crossedTop = false;
  for (let i = 0; i < 120 * 30; i++) {
    f = step(f, { ...neutral, pitch: 1, throttle: 1 }, 1 / 120, 0, perf);
    maxPitch = Math.max(maxPitch, f.pitch);
    if (Math.abs(f.roll) > 150) inverted = true;
    if (inverted && Math.abs(f.heading - 270) < 5) crossedTop = true;
    if (crossedTop && Math.abs(f.roll) < 30 && Math.abs(f.pitch) < 5 && Math.abs(f.heading - 90) < 10) break;
  }
  assert.ok(maxPitch > 85, `max pitch ${maxPitch}`);
  assert.ok(inverted && crossedTop, "over the top inverted");
  assert.ok(Math.abs(f.pitch) < 5 && Math.abs(f.roll) < 30, `back level p${f.pitch} r${f.roll}`);
  assert.ok(Number.isFinite(f.lat) && !f.crashed);
});

test("airliner is gentler than the fighter", () => {
  const a = aircraftById("a320").performance, ft = aircraftById("fighter").performance;
  assert.ok(a.rollRate * 4 < ft.rollRate && a.pitchRate * 3 < ft.pitchRate);
});
