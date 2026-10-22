import { test } from "node:test";
import assert from "node:assert/strict";
import { Cartesian3, Matrix3 } from "cesium";
import { modelAttitude } from "../src/attitude.ts";
import { spawn, step } from "../src/physics.ts";
for (const bank of [-25, 25])
  test(`${bank > 0 ? "right" : "left"} bank lowers the correct wing and turns the same way`, () => {
    for (const heading of [0, 90, 180, 270]) {
      const rotation = Matrix3.fromHeadingPitchRoll(
        modelAttitude(heading, 0, bank),
      );
      const right = Matrix3.multiplyByVector(
        rotation,
        new Cartesian3(0, -8, 0),
        new Cartesian3(),
      );
      const left = Matrix3.multiplyByVector(
        rotation,
        new Cartesian3(0, 8, 0),
        new Cartesian3(),
      );
      assert.ok(
        bank > 0 ? right.z < left.z : left.z < right.z,
        "inside wing must be lower",
      );
    }
    let f = spawn(0, 0, 1000, 0, 120);
    for (let i = 0; i < 120; i++)
      f = step(
        f,
        { pitch: 0, roll: Math.sign(bank), yaw: 0, throttle: 0 },
        1 / 60,
        0,
      );
    assert.ok(
      bank > 0 ? f.lon > 0 : f.lon < 0,
      "northbound right turn moves east; left turn moves west",
    );
    assert.ok(
      bank > 0 ? f.heading > 0 && f.heading < 90 : f.heading > 270,
      "heading turns toward the bank",
    );
  });
