import { test } from "node:test";
import assert from "node:assert/strict";
import { aircraftById } from "../src/aircraft.ts";
import { spawnAircraft, stepAircraft } from "../src/flight-model.ts";
import { HELI, HOVER_COLLECTIVE, hoverTrimCollective } from "../src/heli.ts";
import { keyboardControls } from "../src/controls.ts";
import { spawn, step, type Flight } from "../src/physics.ts";

const heli = aircraftById("bell206");
const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
const run = (f: Flight, keys: string[], secs: number, ground = 0, a = heli) => {
  const c = keyboardControls(new Set(keys));
  for (let i = 0; i < secs * 120; i++) f = stepAircraft(a, f, c, 1 / 120, ground);
  return f;
};

test("helicopter holds altitude hands-off at hover collective", () => {
  let f = spawnAircraft(heli, 37, -122, 300, 0, 0, false, false);
  assert.equal(f.throttle, HOVER_COLLECTIVE);
  f = run(f, [], 30);
  assert.ok(Math.abs(f.alt - 300) < 1, `alt ${f.alt}`);
  assert.ok(Math.abs(f.vs) < 0.05);
  assert.equal(f.stall, false);
  assert.ok(f.speed < 0.5);
});

test("hands-off from forward flight the assist brings it back to a hover", () => {
  let f = spawnAircraft(heli, 37, -122, 300, 90, 8, false, false);
  f = run(f, [], 25);
  assert.ok(f.speed < 1, `speed ${f.speed}`);
  assert.ok(Math.abs(f.pitch) < 2 && Math.abs(f.roll) < 2);
});

test("collective R climbs, F descends, H re-trims a hover", () => {
  let f = spawnAircraft(heli, 37, -122, 300, 0, 0, false, false);
  f = run(f, ["r"], 0.6);
  f = run(f, [], 8);
  assert.ok(f.vs > 1.5, `climb ${f.vs}`);
  assert.ok(f.alt > 310);
  f = { ...f, throttle: hoverTrimCollective(f, 0) };
  f = run(f, [], 10);
  assert.ok(Math.abs(f.vs) < 0.1, `trimmed ${f.vs}`);
  f = run(f, ["f"], 0.6);
  f = run(f, [], 6);
  assert.ok(f.vs < -1, `descent ${f.vs}`);
  assert.equal(f.stall, false);
});

test("cyclic forward translates along the nose, pedals yaw, no stall at 0 kt", () => {
  let f = spawnAircraft(heli, 37, -122, 300, 90, 0, false, false);
  const lon0 = f.lon;
  f = run(f, ["w"], 6);
  assert.ok(f.lon > lon0 && f.speed > 8 && f.pitch < -5, `spd ${f.speed}`);
  let g = spawnAircraft(heli, 37, -122, 300, 90, 0, false, false);
  g = run(g, ["e"], 2);
  assert.ok(g.heading > 120, `hdg ${g.heading}`);
  assert.ok(!g.stall && !f.stall);
});

test("vertical takeoff from the ground, landing, sitting, and taking off again", () => {
  const ground = 50;
  let f = spawnAircraft(heli, 37, -122, ground + HELI.gear, 0, 0, false, true);
  f = run(f, [], 5, ground);
  assert.ok(f.onGround && !f.crashed && f.alt === ground + HELI.gear, "sits at low collective");
  f = run(f, ["r"], 1.5, ground);
  f = run(f, [], 10, ground);
  assert.ok(!f.onGround && f.alt > ground + 20, `takeoff alt ${f.alt - ground}`);
  // Gentle vertical descent: collective a little below hover.
  f = { ...f, throttle: 0.42 };
  for (let i = 0; i < 120 * 120 && !f.onGround; i++)
    f = stepAircraft(heli, f, neutral, 1 / 120, ground);
  assert.ok(f.onGround && !f.crashed, "landed without crashing");
  f = run(f, ["f"], 2, ground);
  f = run(f, [], 10, ground);
  assert.ok(f.onGround && !f.crashed && f.speed < 0.1, "stays put after landing");
  f = run(f, ["r"], 2.5, ground);
  f = run(f, [], 5, ground);
  assert.ok(!f.onGround && f.alt > ground + 10, "takes off again");
});

test("a fast vertical impact still crashes the helicopter", () => {
  let f = spawnAircraft(heli, 37, -122, 60, 0, 0, false, false);
  f = { ...f, throttle: 0 };
  f = run(f, [], 10);
  assert.ok(f.crashed);
});

test("plane: gentle touchdown settles, rolls out with brakes, and can take off", () => {
  const c172 = aircraftById("c172");
  const perf = c172.performance;
  let f: Flight = { ...spawn(0, 0, 30, 0, 30, false, perf), pitch: -3, throttle: 0.2 };
  for (let i = 0; i < 120 * 60 && !f.onGround; i++)
    f = step(f, neutral, 1 / 120, 0, perf);
  assert.ok(f.onGround && !f.crashed, "gentle landing does not crash");
  assert.equal(f.alt, perf.gear);
  const brake = { ...neutral, throttle: -1, brake: 1 };
  for (let i = 0; i < 120 * 30; i++) f = step(f, brake, 1 / 120, 0, perf);
  assert.ok(f.onGround && !f.crashed && f.speed === 0, `stopped ${f.speed}`);
  assert.equal(f.stall, false);
  const go = { ...neutral, throttle: 1 };
  for (let i = 0; i < 120 * 40 && f.onGround; i++)
    f = step(f, { ...go, pitch: f.speed > perf.stallSpeed ? 1 : 0 }, 1 / 120, 0, perf);
  assert.ok(!f.onGround && !f.crashed, "lifts off again");
});

test("plane: hard or steep impact still crashes", () => {
  let f: Flight = { ...spawn(0, 0, 40, 0, 60), pitch: -20 };
  for (let i = 0; i < 120 * 20 && !f.crashed && !f.onGround; i++)
    f = step(f, neutral, 1 / 120, 0);
  assert.ok(f.crashed && !f.onGround);
});
