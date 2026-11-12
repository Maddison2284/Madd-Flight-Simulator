import { test } from "node:test";
import assert from "node:assert/strict";
import { aircraftById } from "../src/aircraft.ts";
import { spawnAircraft, stepAircraft } from "../src/flight-model.ts";
import {
  GEAR_CYCLE_S,
  GEAR_NODES,
  GearAnimator,
  gearPhases,
  gearPoses,
  gearStatus,
  gearWarning,
  hasRetractableGear,
  initialGearUp,
  rotateVec,
  shouldAutoExtend,
  stepGearPos,
  toggleGear,
} from "../src/gear.ts";
import { type Flight } from "../src/physics.ts";

const fighter = aircraftById("fighter");

test("only the fighter has retractable gear", () => {
  assert.equal(hasRetractableGear("fighter"), true);
  for (const id of ["c172", "citation", "a320", "bell206", "saucer"]) assert.equal(hasRetractableGear(id), false, id);
  assert.deepEqual(
    [...GEAR_NODES].sort(),
    ["gear_door_main_L", "gear_door_main_R", "gear_door_nose_L", "gear_door_nose_R", "gear_main_L", "gear_main_R", "gear_nose"],
  );
});

test("G toggles up and down in the air; locked down on the ground", () => {
  const air = { gearUp: false, onGround: false, crashed: false };
  const up = toggleGear(air, "fighter");
  assert.deepEqual(up, { gearUp: true });
  assert.deepEqual(toggleGear({ ...air, gearUp: true }, "fighter"), { gearUp: false });
  assert.deepEqual(toggleGear({ ...air, onGround: true }, "fighter"), { gearUp: false, refused: "ground" });
  assert.deepEqual(toggleGear(air, "c172"), { gearUp: false, refused: "fixed" });
  assert.deepEqual(toggleGear({ ...air, crashed: true }, "fighter"), { gearUp: false });
});

test("gear starts down on the ground and up above 500 ft", () => {
  assert.equal(initialGearUp("fighter", true, 0), false);
  assert.equal(initialGearUp("fighter", false, 100), false);
  assert.equal(initialGearUp("fighter", false, 1219), true);
  assert.equal(initialGearUp("c172", false, 1219), false);
});

test("retraction animates over ~1.6 s: legs first, doors last", () => {
  let pos = 0;
  const seen: string[] = [];
  for (let t = 0; t < GEAR_CYCLE_S + 0.2; t += 1 / 60) {
    pos = stepGearPos(pos, true, 1 / 60);
    seen.push(gearStatus(pos, true));
  }
  assert.equal(pos, 1);
  assert.equal(seen[0], "moving");
  assert.equal(seen.at(-1), "up");
  const steps = seen.filter((s) => s === "moving").length;
  assert.ok(steps >= 90 && steps <= 100, `moving frames ${steps}`);
  assert.deepEqual(gearPhases(0), { legs: 0, doors: 0 });
  assert.deepEqual(gearPhases(1), { legs: 1, doors: 1 });
  const mid = gearPhases(0.5);
  assert.ok(mid.legs > 0.5 && mid.doors === 0, JSON.stringify(mid));
  // Extend reverses at the same rate.
  for (let i = 0; i < 48; i++) pos = stepGearPos(pos, false, 1 / 60);
  assert.ok(Math.abs(pos - 0.5) < 1e-9);
});

test("gear poses: identity when down, legs folded into the belly when up", () => {
  const down = gearPoses("fighter", 0);
  for (const [node, p] of Object.entries(down)) {
    assert.ok(Math.abs(p.q[3] - 1) < 1e-6, node);
    assert.ok(p.t.every((v) => Math.abs(v) < 1e-9), node);
  }
  const up = gearPoses("fighter", 1);
  // Main legs: strut (pointing down, -Y) ends up pointing inboard.
  const l = rotateVec(up.gear_main_L.q, [0, -1, 0]);
  const r = rotateVec(up.gear_main_R.q, [0, -1, 0]);
  assert.ok(l[0] < -0.99 && Math.abs(l[1]) < 1e-6, `L ${l}`);
  assert.ok(r[0] > 0.99 && Math.abs(r[1]) < 1e-6, `R ${r}`);
  assert.ok(up.gear_main_L.t[1] > 0.3);
  // Nose leg folds forward (+Z).
  const n = rotateVec(up.gear_nose.q, [0, -1, 0]);
  assert.ok(n[2] > 0.99, `nose ${n}`);
  // Doors move (rotate) when closed.
  assert.ok(Math.abs(up.gear_door_main_L.q[3]) < 0.99);
  assert.deepEqual(gearPoses("c172", 1), {});
});

test("animator snaps on reset and follows the command", () => {
  const g = new GearAnimator();
  g.reset("fighter", true);
  assert.equal(g.status(true), "up");
  g.update("fighter", false, 0.5);
  assert.equal(g.status(false), "moving");
  g.update("fighter", false, 2);
  assert.equal(g.status(false), "down");
  g.update("saucer", false, 0.1);
  assert.deepEqual(g.poses(), {});
});

test("gear-up warning, auto-extend and touchdown handling", () => {
  const low = { gearUp: true, onGround: false, crashed: false, vs: -4, speed: 80 };
  assert.equal(gearWarning(low, 120), true);
  assert.equal(gearWarning({ ...low, vs: 2 }, 120), false);
  assert.equal(gearWarning({ ...low, gearUp: false }, 120), false);
  assert.equal(gearWarning(low, 400), false);
  assert.equal(shouldAutoExtend(low, 30, fighter.performance.stallSpeed), true);
  // Fast low pass keeps the gear up.
  assert.equal(shouldAutoExtend({ ...low, speed: 300 }, 30, fighter.performance.stallSpeed), false);

  // A gentle touchdown with the gear up still lands (gear forced down).
  let f: Flight = { ...spawnAircraft(fighter, 37, -122, 30, 0, 70, false, false), gearUp: true, pitch: -3, throttle: 0.2 };
  for (let i = 0; i < 120 * 60 && !f.onGround && !f.crashed; i++)
    f = stepAircraft(fighter, f, { pitch: 0, roll: 0, yaw: 0, throttle: 0 }, 1 / 120, 0);
  assert.equal(f.crashed, false);
  assert.equal(f.onGround, true);
  assert.equal(f.gearUp, false);

  // Crash detection unchanged: a steep dive still crashes, gear up or down.
  for (const gearUp of [true, false]) {
    let d: Flight = { ...spawnAircraft(fighter, 37, -122, 200, 90, 200, false, false), gearUp, pitch: -40 };
    for (let i = 0; i < 120 * 20 && !d.crashed; i++)
      d = stepAircraft(fighter, d, { pitch: 0, roll: 0, yaw: 0, throttle: 0 }, 1 / 120, 0);
    assert.equal(d.crashed, true, `gearUp ${gearUp}`);
  }
});

test("retracted gear trims drag a little", () => {
  const fly = (gearUp: boolean) => {
    let f: Flight = { ...spawnAircraft(fighter, 37, -122, 3000, 90, 150, false, false), gearUp, throttle: 0 };
    for (let i = 0; i < 120 * 5; i++) f = stepAircraft(fighter, f, { pitch: 0, roll: 0, yaw: 0, throttle: 0 }, 1 / 120, 0);
    return f.speed;
  };
  const up = fly(true),
    down = fly(false);
  assert.ok(up > down, `up ${up} down ${down}`);
  assert.ok(up - down < 5, `small effect ${up - down}`);
});
