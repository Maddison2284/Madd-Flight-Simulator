import { test } from "node:test";
import assert from "node:assert/strict";
import { aircraftById } from "../src/aircraft.ts";
import { spawnAircraft } from "../src/flight-model.ts";
import { ROTOR_PARTS, RotorAnimator, fanBlur, partNodes, targetRpm } from "../src/rotors.ts";

const spawn = (id: string) => {
  const a = aircraftById(id);
  return { a, f: spawnAircraft(a, 37, -122, 3000, 90, 150, false, false) };
};

test("both jets with visible fans have two fan parts with blur discs", () => {
  for (const id of ["a320", "citation"]) {
    const parts = ROTOR_PARTS[id];
    assert.equal(parts.length, 2, id);
    assert.deepEqual(parts.flatMap(partNodes), [
      "mf_fan_1", "mf_fan_1_blur1", "mf_fan_1_blur2",
      "mf_fan_2", "mf_fan_2_blur1", "mf_fan_2_blur2",
    ]);
  }
  // Cessna prop keeps its blade + disc pair; the fighter has no fan faces.
  assert.deepEqual(ROTOR_PARTS.c172.flatMap(partNodes), ["mf_prop", "mf_prop_disc"]);
  assert.equal(ROTOR_PARTS.fighter, undefined);
});

test("fan N1 follows throttle: idle floor, full at 100%, zero when crashed", () => {
  const { a, f } = spawn("a320");
  f.throttle = 0;
  assert.ok(Math.abs(targetRpm(a, f) - 0.22) < 1e-9);
  f.throttle = 1;
  assert.equal(targetRpm(a, f), 1);
  f.crashed = true;
  assert.equal(targetRpm(a, f), 0);
});

test("fan blur discs: none at idle, one mid-power, both at take-off power", () => {
  assert.deepEqual(fanBlur(0.22), { blur1: false, blur2: false });
  assert.deepEqual(fanBlur(0.7), { blur1: true, blur2: false });
  assert.deepEqual(fanBlur(1), { blur1: true, blur2: true });
});

test("fan spins faster at full throttle, spools slowly, stops when not flying", () => {
  const spin = (throttle: number, seconds: number) => {
    const { a, f } = spawn("a320");
    f.throttle = throttle;
    const r = new RotorAnimator();
    let total = 0, prev = 0;
    for (let i = 0; i < seconds * 60; i++) {
      r.update(a, f, 1 / 60, true);
      const ang = r.angle("mf_fan_1");
      total += (ang - prev + Math.PI * 2) % (Math.PI * 2);
      prev = ang;
    }
    return { r, a, f, total, rpm: r.rpm };
  };
  const idle = spin(0, 20), full = spin(1, 20);
  assert.ok(idle.rpm > 0.2 && idle.rpm < 0.25, `idle rpm ${idle.rpm}`);
  assert.ok(full.rpm > 0.98, `full rpm ${full.rpm}`);
  assert.ok(full.total > idle.total * 3, `full ${full.total} vs idle ${idle.total}`);
  // Never more than half a blade pitch (24 blades → 7.5°) per 60 fps frame.
  assert.ok(0.9 * 2 * Math.PI / 60 < (7.5 * Math.PI) / 180);
  // Jet spool-up is slower than the prop's.
  const { a, f } = spawn("a320");
  const c = spawn("c172");
  f.throttle = c.f.throttle = 1;
  const rj = new RotorAnimator(), rp = new RotorAnimator();
  for (let i = 0; i < 60; i++) { rj.update(a, f, 1 / 60, true); rp.update(c.a, c.f, 1 / 60, true); }
  assert.ok(rj.rpm < rp.rpm, `jet ${rj.rpm} prop ${rp.rpm}`);
  // Paused / out of flight: N1 winds down to zero.
  for (let i = 0; i < 60 * 30; i++) full.r.update(full.a, full.f, 1 / 60, false);
  assert.ok(full.r.rpm < 0.01, `rpm after stop ${full.r.rpm}`);
});
