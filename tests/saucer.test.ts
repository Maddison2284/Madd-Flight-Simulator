import { test } from "node:test";
import assert from "node:assert/strict";
import { aircraftById } from "../src/aircraft.ts";
import { spawnAircraft, stepAircraft } from "../src/flight-model.ts";
import { keyboardControls } from "../src/controls.ts";
import {
  HOVER_COLLECTIVE,
  MACH_MS,
  cycleWarp,
  flightSpeed3d,
  machNumber,
} from "../src/heli.ts";
import { type Flight } from "../src/physics.ts";

const saucer = aircraftById("saucer");
const run = (f: Flight, keys: string[], secs: number, ground = 0) => {
  const c = keyboardControls(new Set(keys), "saucer");
  for (let i = 0; i < secs * 120; i++) f = stepAircraft(saucer, f, c, 1 / 120, ground);
  return f;
};

test("saucer holds a hover hands-off and does not stall", () => {
  let f = spawnAircraft(saucer, 37, -122, 400, 90, 0, false, false);
  assert.equal(f.throttle, HOVER_COLLECTIVE);
  f = run(f, [], 20);
  assert.ok(Math.abs(f.alt - 400) < 4, `alt ${f.alt}`);
  assert.ok(Math.abs(f.vs) < 0.4, `vs ${f.vs}`);
  assert.ok(f.speed < 2, `speed ${f.speed}`);
  assert.equal(f.stall, false);
});

test("R or Space climbs hard, F descends hard", () => {
  let f = spawnAircraft(saucer, 37, -122, 400, 90, 0, false, false);
  f = run(f, ["r"], 1.2);
  assert.ok(f.vs > 12, `R climb ${f.vs}`);
  assert.ok(f.alt > 410, `R alt ${f.alt}`);
  let g = spawnAircraft(saucer, 37, -122, 400, 90, 0, false, false);
  g = run(g, [" "], 1.2);
  assert.ok(g.vs > 12, `Space climb ${g.vs}`);
  let d = spawnAircraft(saucer, 37, -122, 800, 90, 0, false, false);
  d = run(d, ["f"], 1.2);
  assert.ok(d.vs < -12, `F descent ${d.vs}`);
  assert.equal(d.stall, false);
});

test("hands-off after a climb returns to a hover", () => {
  let f = spawnAircraft(saucer, 37, -122, 400, 90, 0, false, false);
  f = run(f, ["r"], 1);
  const peaked = f.alt;
  f = run(f, [], 8);
  assert.ok(Math.abs(f.vs) < 0.8, `settled vs ${f.vs}`);
  assert.ok(f.alt >= peaked - 8, `held most of the climb (${f.alt} vs ${peaked})`);
});

test("S pitches the nose up and climbs steeply; W pitches down; Q/E yaw", () => {
  let f = spawnAircraft(saucer, 37, -122, 400, 90, 0, false, false);
  f = run(f, ["s"], 2);
  assert.ok(f.pitch > 25, `nose-up pitch ${f.pitch}`);
  assert.ok(f.vs > 8, `nose-up climb ${f.vs}`);
  let w = spawnAircraft(saucer, 37, -122, 400, 90, 0, false, false);
  w = run(w, ["w"], 2);
  assert.ok(w.pitch < -25, `nose-down pitch ${w.pitch}`);
  const lon0 = 0;
  let y = spawnAircraft(saucer, 37, -122, 400, 90, 0, false, false);
  y = run(y, ["e"], 1);
  assert.ok(y.heading > 130, `yaw ${y.heading}`);
  assert.equal(f.stall, false);
  void lon0;
});

test("A/D banks the saucer visibly", () => {
  let f = spawnAircraft(saucer, 37, -122, 400, 90, 0, false, false);
  f = run(f, ["d"], 1);
  assert.ok(f.roll > 25, `roll ${f.roll}`);
});

test("warp 1 ramps through Mach 1, warp 2 reaches Mach 3+", () => {
  let f = spawnAircraft(saucer, 37, -122, 2000, 90, 0, false, false);
  f = { ...f, warp: 1 };
  f = run(f, [], 6);
  assert.ok(machNumber(f) > 1, `warp1 mach ${machNumber(f)}`);
  assert.ok(flightSpeed3d(f) > MACH_MS, `warp1 speed ${flightSpeed3d(f)}`);
  f = { ...f, warp: 2 };
  f = run(f, [], 10);
  assert.ok(machNumber(f) > 3, `warp2 mach ${machNumber(f)}`);
});

test("warp and vertical thrust still work in near-space", () => {
  const space = 100_000; // 100 km
  let f = spawnAircraft(saucer, 37, -122, space, 90, 0, false, false);
  f = run(f, ["r"], 1.5);
  assert.ok(f.vs > 10 && f.alt > space + 10, `space climb ${f.vs} alt ${f.alt}`);
  f = { ...f, warp: 1, vn: 0, ve: 0, vs: 0, speed: 0 };
  f = run(f, [], 6);
  assert.ok(machNumber(f) > 1, `space warp mach ${machNumber(f)}`);
  assert.equal(f.stall, false);
});

test("cycleWarp goes 0 → 1 → 2 → 0, and Shift jumps to 2", () => {
  assert.equal(cycleWarp(0), 1);
  assert.equal(cycleWarp(1), 2);
  assert.equal(cycleWarp(2), 0);
  assert.equal(cycleWarp(0, true), 2);
  assert.equal(cycleWarp(2, true), 0);
});
