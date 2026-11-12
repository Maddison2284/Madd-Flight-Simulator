import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AIRCRAFT, aircraftById, stallKnots } from "../src/aircraft.ts";
import { DEFAULT_PERFORMANCE, spawn, step } from "../src/physics.ts";

test("catalog has 4–6 commercial-ok aircraft with model files", () => {
  assert.ok(AIRCRAFT.length >= 4 && AIRCRAFT.length <= 6);
  for (const item of AIRCRAFT) {
    assert.ok(item.uri.startsWith("/models/"));
    const path = new URL(`../public${item.uri}`, import.meta.url);
    const bytes = readFileSync(path);
    assert.equal(bytes.readUInt32LE(0), 0x46546c67);
    assert.equal(bytes.readUInt32LE(4), 2);
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    assert.ok(bytes.length > 1000);
    assert.match(item.credit.license, /CC0|CC BY/);
    assert.ok(item.performance.stallSpeed > 0);
    assert.ok(item.radiusMeters > 0);
  }
});

test("BJ-35 keeps the original default performance", () => {
  const jet = aircraftById("bj35");
  assert.deepEqual(jet.performance, DEFAULT_PERFORMANCE);
});

test("per-aircraft stall and spawn clamps differ from the default jet", () => {
  const cessna = aircraftById("c172");
  const stalled = spawn(0, 0, 1000, 0, 10, false, cessna.performance);
  assert.equal(stalled.speed, cessna.performance.stallSpeed);
  const fast = spawn(0, 0, 1000, 0, 400, false, cessna.performance);
  assert.equal(fast.speed, cessna.performance.spawnMax);
  const f = spawn(0, 0, 1000, 0, 120, false, cessna.performance);
  f.speed = 20;
  const n = step(f, { pitch: 0, roll: 0, yaw: 0, throttle: 0 }, 0.05, 0, cessna.performance);
  assert.equal(n.stall, 20 < cessna.performance.stallSpeed);
  assert.ok(stallKnots(cessna) < 55);
});
