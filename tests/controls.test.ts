import { test } from "node:test";
import assert from "node:assert/strict";
import { keyboardControls } from "../src/controls.ts";
import { spawn, step } from "../src/physics.ts";
for (const roll of [0, 180, -180])
  test(`W/S pitch is aircraft-relative at ${roll} degrees bank`, () => {
    const f = { ...spawn(0, 0, 1000, 90, 120), roll };
    const w = step(f, keyboardControls(new Set(["w"])), 0.05, 0);
    const s = step(f, keyboardControls(new Set(["s"])), 0.05, 0);
    assert.ok(
      roll === 0 ? w.pitch < 0 : w.pitch > 0,
      "W pushes toward aircraft down",
    );
    assert.ok(
      roll === 0 ? s.pitch > 0 : s.pitch < 0,
      "S pulls toward aircraft up",
    );
  });
