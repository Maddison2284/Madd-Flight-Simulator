import test from "node:test";
import assert from "node:assert/strict";
import { flightScreenSpaceError, warpScreenSpaceError } from "../src/device.ts";

test("3D-tile detail: full detail when slow, relaxes only with speed", () => {
  for (const base of [8, 16]) {
    assert.equal(flightScreenSpaceError(base, 0, 0), base); // parked
    assert.equal(flightScreenSpaceError(base, 62, 0), base); // Cessna ~120 kt
    assert.equal(flightScreenSpaceError(base, 70, 0), base);
    const a320 = flightScreenSpaceError(base, 180, 0); // ~350 kt
    assert.ok(a320 > base && a320 < 2 * base);
    assert.equal(flightScreenSpaceError(base, 232, 0), 2 * base); // ~450 kt
    assert.equal(flightScreenSpaceError(base, 700, 0), 2 * base); // capped
    assert.equal(flightScreenSpaceError(base, 100, 2), warpScreenSpaceError(base, 2));
    // quantised to even steps so the tileset is not re-tuned every frame
    assert.equal(flightScreenSpaceError(base, 150, 0) % 2, 0);
  }
});
