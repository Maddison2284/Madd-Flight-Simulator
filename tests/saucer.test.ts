import { test } from "node:test";
import assert from "node:assert/strict";
import { aircraftById } from "../src/aircraft.ts";
import { spawnAircraft, stepAircraft } from "../src/flight-model.ts";
import { keyboardControls } from "../src/controls.ts";
import {
  saucerJumpPitch,
  cycleWarp,
  WARP_FLOOR_M,
  teleportJump,
  jumpDistance,
  JUMP_M,
  BIG_JUMP_M,
  JUMP_GROUND_MARGIN_M,
  machNumber,
  saucerVertScale,
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
  assert.ok(f.throttle < 0.02);
  f = run(f, [], 20);
  assert.ok(Math.abs(f.alt - 400) < 4, `alt ${f.alt}`);
  assert.ok(Math.abs(f.vs) < 0.4, `vs ${f.vs}`);
  assert.ok(f.speed < 2, `speed ${f.speed}`);
  assert.equal(f.stall, false);
});

test("W goes UP and S goes DOWN directly, with only a small nose tilt", () => {
  let f = spawnAircraft(saucer, 37, -122, 400, 90, 0, false, false);
  f = run(f, ["w"], 1.5);
  assert.ok(f.vs > 25, `W climb ${f.vs}`);
  assert.ok(f.alt > 420, `W alt ${f.alt}`);
  assert.ok(Math.abs(f.pitch) <= 13, `cosmetic tilt ${f.pitch}`);
  assert.ok(Math.hypot(f.vn ?? 0, f.ve ?? 0) < 2, "W does not fly it forward");
  let d = spawnAircraft(saucer, 37, -122, 800, 90, 0, false, false);
  d = run(d, ["s"], 1.5);
  assert.ok(d.vs < -25, `S descent ${d.vs}`);
  assert.ok(d.alt < 780);
  assert.equal(d.stall, false);
});

test("R / Space / F still work as extra up/down keys", () => {
  for (const [k, sign] of [["r", 1], [" ", 1], ["f", -1]] as const) {
    let f = spawnAircraft(saucer, 37, -122, 800, 90, 0, false, false);
    f = run(f, [k], 1.2);
    assert.ok(f.vs * sign > 20, `${JSON.stringify(k)} vs ${f.vs}`);
  }
});

test("touch stick up = up, stick down = down (main.tsx maps vertical = -stick.pitch)", () => {
  let f = spawnAircraft(saucer, 37, -122, 400, 90, 0, false, false);
  const stickUp = { pitch: 0, roll: 0, yaw: 0, throttle: 0, vertical: -(-1) };
  for (let i = 0; i < 120; i++) f = stepAircraft(saucer, f, stickUp, 1 / 120, 0);
  assert.ok(f.vs > 15);
  const stickDown = { pitch: 0, roll: 0, yaw: 0, throttle: 0, vertical: -1 };
  for (let i = 0; i < 240; i++) f = stepAircraft(saucer, f, stickDown, 1 / 120, 0);
  assert.ok(f.vs < -15);
});

test("hands-off after a climb holds altitude", () => {
  let f = spawnAircraft(saucer, 37, -122, 400, 90, 0, false, false);
  f = run(f, ["w"], 1);
  const peaked = f.alt;
  f = run(f, [], 8);
  assert.ok(Math.abs(f.vs) < 0.8, `settled vs ${f.vs}`);
  assert.ok(f.alt >= peaked - 2 && f.alt <= peaked + 60, `held (${f.alt} vs ${peaked})`);
});

test("forward comes from throttle / arrows; A/D bank and turn; Q/E yaw", () => {
  let f = spawnAircraft(saucer, 37, -122, 400, 90, 0, false, false);
  f = run(f, ["arrowup"], 3);
  assert.ok((f.ve ?? 0) > 60, `arrow forward east ${f.ve}`);
  f = run(f, ["="], 2);
  assert.ok(f.throttle > 0.9, `throttle ${f.throttle}`);
  const h0 = f.heading;
  f = run(f, ["d"], 1);
  assert.ok(f.roll > 20, `bank ${f.roll}`);
  assert.ok(((f.heading - h0 + 360) % 360) > 20, `turned right ${f.heading}`);
  const g0 = spawnAircraft(saucer, 37, -122, 400, 90, 0, false, false);
  const g = run(g0, ["q"], 0.5);
  assert.ok(((g0.heading - g.heading + 360) % 360) > 20, "Q yaws left");
  // planner speed sets the forward throttle
  const p = spawnAircraft(saucer, 37, -122, 400, 90, 75, false, false);
  assert.ok(Math.abs(p.throttle - 0.5) < 1e-9);
});

test("vertical control works in near-space", () => {
  let f = spawnAircraft(saucer, 37, -122, 120000, 90, 0, false, false);
  f = run(f, ["w"], 1.5);
  assert.ok(f.vs > 25);
  f = run(f, ["arrowup"], 4);
  assert.ok(machNumber(f) > 0.2);
});

test("teleport jump moves ~1 mile along heading and pitch in one step", () => {
  const f0: Flight = { ...spawnAircraft(saucer, 37.8, -122.4, 1000, 90, 20), pitch: 0, roll: 5, vn: 3, ve: 20, vs: 1 };
  const f1 = teleportJump(f0, JUMP_M, () => 0);
  const d = jumpDistance(f0, f1);
  assert.ok(Math.abs(d - 1609.344) < 2, `distance ${d}`);
  assert.ok(f1.lon > f0.lon, "moved east (heading 090)");
  assert.ok(Math.abs(f1.lat - f0.lat) < 1e-4);
  assert.equal(f1.alt, f0.alt);
  // velocity + attitude unchanged
  for (const k of ["heading", "pitch", "roll", "vn", "ve", "vs", "speed", "throttle"] as const) assert.equal(f1[k], f0[k], k);
  // nose up 30°: half the distance becomes climb
  const up = teleportJump({ ...f0, pitch: 30 }, JUMP_M, () => 0);
  assert.ok(Math.abs(up.alt - f0.alt - JUMP_M / 2) < 0.01);
  assert.ok(Math.abs(jumpDistance(f0, up) - JUMP_M) < 2);
  // Shift+B: 10 miles
  const big = teleportJump(f0, BIG_JUMP_M, () => 0);
  assert.ok(Math.abs(jumpDistance(f0, big) - 16093.44) < 20, `big ${jumpDistance(f0, big)}`);
});

test("teleport never lands underground", () => {
  const f0: Flight = { ...spawnAircraft(saucer, 37.8, -122.4, 200, 0, 0), pitch: -60 };
  const f1 = teleportJump(f0, JUMP_M, () => 150);
  assert.equal(f1.alt, 150 + JUMP_GROUND_MARGIN_M);
  assert.equal(f1.crashed, false);
  const f2 = teleportJump({ ...f0, alt: 5000, pitch: 0 }, JUMP_M, () => 4990);
  assert.equal(f2.alt, 4990 + JUMP_GROUND_MARGIN_M);
});

test("warp jump follows the saucer's 3-D travel: level, climbing, descending", () => {
  const base: Flight = { ...spawnAircraft(saucer, 37.8, -122.4, 3000, 90, 0, false, false) };
  // level cruise
  const level = { ...base, vn: 0, ve: 100, vs: 0 };
  const L = teleportJump(level, JUMP_M, () => 0, JUMP_GROUND_MARGIN_M, saucerJumpPitch(level));
  assert.ok(Math.abs(L.alt - 3000) < 0.5, `level alt ${L.alt}`);
  assert.ok(Math.abs(jumpDistance(level, L) - JUMP_M) < 2);
  // climbing (W held while cruising): forward AND up
  let climb = run({ ...base, throttle: 0.6 }, ["w"], 3);
  const up = teleportJump(climb, JUMP_M, () => 0, JUMP_GROUND_MARGIN_M, saucerJumpPitch(climb));
  assert.ok(up.alt - climb.alt > 300, `climb jump gained ${up.alt - climb.alt}`);
  assert.ok(up.lon > climb.lon, "and moved forward");
  assert.ok(Math.abs(jumpDistance(climb, up) - JUMP_M) < 3);
  // pure vertical climb from a hover still jumps forward-and-up
  const hoverUp = run(base, ["w"], 2);
  const hu = teleportJump(hoverUp, JUMP_M, () => 0, JUMP_GROUND_MARGIN_M, saucerJumpPitch(hoverUp));
  assert.ok(hu.alt > hoverUp.alt + 800 && hu.lon > hoverUp.lon);
  // descending: forward AND down
  const desc = run({ ...base, throttle: 0.6 }, ["s"], 3);
  const dn = teleportJump(desc, JUMP_M, () => 0, JUMP_GROUND_MARGIN_M, saucerJumpPitch(desc));
  assert.ok(desc.alt - dn.alt > 300, `descent jump lost ${desc.alt - dn.alt}`);
  assert.ok(dn.lon > desc.lon);
  // steep descent near terrain clamps above the ground
  const low = { ...desc, alt: 200 };
  const lo = teleportJump(low, JUMP_M, () => 180, JUMP_GROUND_MARGIN_M, -80);
  assert.equal(lo.alt, 180 + JUMP_GROUND_MARGIN_M);
});

test("speed warp: B cycles Mach 1.2 → 4 → 10 → off; Shift+B → Mach 10", () => {
  assert.equal(cycleWarp(0), 1);
  assert.equal(cycleWarp(1), 2);
  assert.equal(cycleWarp(2), 3);
  assert.equal(cycleWarp(3), 0);
  assert.equal(cycleWarp(0, true), 3);
  assert.equal(cycleWarp(3, true), 0);
});

test("speed warp levels reach Mach 1.2, 4 and 10, and turning it off slows down", () => {
  const base = spawnAircraft(saucer, 37, -122, 5000, 90, 0, false, false);
  const reach = (warp: 1 | 2 | 3, secs: number) => run({ ...base, warp }, [], secs);
  const w1 = reach(1, 8);
  assert.ok(machNumber(w1) > 1.1 && machNumber(w1) < 1.3, `w1 ${machNumber(w1)}`);
  const w2 = reach(2, 12);
  assert.ok(machNumber(w2) > 3.6, `w2 ${machNumber(w2)}`);
  const w3 = reach(3, 20);
  assert.ok(machNumber(w3) > 9.5, `w3 ${machNumber(w3)}`);
  assert.equal(w3.warp, 3);
  assert.ok(Number.isFinite(w3.lat) && Number.isFinite(w3.lon));
  const off = run({ ...w3, warp: 0 }, [], 10);
  assert.ok(machNumber(off) < 1, `off ${machNumber(off)}`);
  // W/S still move vertically during warp
  const up = run(w2, ["w"], 1.5);
  assert.ok(up.vs > 20);
});

test("warp never crashes into the ground (skims the warp floor)", () => {
  let f = { ...spawnAircraft(saucer, 37, -122, 300, 90, 0, false, false), warp: 3 as const };
  f = run(f, ["s"], 6, 250);
  assert.equal(f.crashed, false);
  assert.ok(f.alt >= 250 + WARP_FLOOR_M, `alt ${f.alt}`);
});

test("holding UP / DOWN for 2 s moves > 1,000 ft (strong, immediate vertical)", () => {
  const ft = 3.28084;
  for (const warp of [0, 1, 2, 3] as const) {
    const base = { ...spawnAircraft(saucer, 37, -122, 1500, 90, 0, false, false), warp };
    // ~0.5 s after pressing: at least ~6,000 ft/min
    const half = run(base, ["w"], 0.5);
    assert.ok(half.vs * ft * 60 >= 6000 * saucerVertScale(warp) * 0.99, `w${warp} 0.5 s vs ${half.vs}`);
    const up = run(base, ["w"], 2);
    assert.ok((up.alt - base.alt) * ft > 1000, `w${warp} UP 2 s gained ${(up.alt - base.alt) * ft} ft`);
    const down = run(base, ["s"], 2, 0);
    assert.ok((base.alt - down.alt) * ft > 1000, `w${warp} DOWN 2 s lost ${(base.alt - down.alt) * ft} ft`);
    assert.equal(down.crashed, false);
  }
  // half stick still climbs well
  let f = spawnAircraft(saucer, 37, -122, 1500, 90, 0, false, false);
  for (let i = 0; i < 240; i++) f = stepAircraft(saucer, f, { pitch: 0, roll: 0, yaw: 0, throttle: 0, vertical: 0.5 }, 1 / 120, 0);
  assert.ok((f.alt - 1500) * ft > 500, `half stick ${(f.alt - 1500) * ft}`);
});

test("climbing works at every warp level even right on the warp floor", () => {
  for (const warp of [1, 2, 3] as const) {
    // skimming 60 m above 250 m terrain at Mach 10
    let f = { ...spawnAircraft(saucer, 37, -122, 250 + WARP_FLOOR_M, 90, 0, false, false), warp };
    f = run(f, [], 3, 250);
    const a0 = f.alt;
    f = run(f, ["w"], 2, 250);
    assert.ok(f.alt - a0 > 300, `warp ${warp} climbed ${f.alt - a0} m`);
  }
});

test("held DOWN brakes near the ground and lands softly (no crash)", () => {
  let f = spawnAircraft(saucer, 37, -122, 2000, 90, 0, false, false);
  f = run(f, ["s"], 30, 0);
  assert.equal(f.crashed, false);
  assert.equal(f.onGround, true);
});

test("mobile devices get a small 3D-tile memory budget; warp coarsens tiles", async () => {
  const { isMobileDevice, tileBudget, warpScreenSpaceError } = await import("../src/device.ts");
  const iphone = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1" };
  const ipad = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15", maxTouchPoints: 5 };
  const mac = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15", maxTouchPoints: 0 };
  assert.equal(isMobileDevice(iphone, false), true);
  assert.equal(isMobileDevice(ipad, false), true);
  assert.equal(isMobileDevice(mac, false), false);
  const m = tileBudget(true);
  assert.ok(m.cacheBytes + m.maximumCacheOverflowBytes <= 384 * 1024 * 1024);
  assert.ok(m.maximumScreenSpaceError >= 16);
  assert.equal(warpScreenSpaceError(16, 0), 16);
  assert.ok(warpScreenSpaceError(16, 3) > warpScreenSpaceError(16, 1));
});
