import { test } from "node:test";
import assert from "node:assert/strict";
import { Cartesian3, Matrix3, Matrix4, Transforms } from "cesium";
import { modelOrientation } from "../src/attitude.ts";
import { AIRCRAFT } from "../src/aircraft.ts";

const pos = Cartesian3.fromDegrees(-122.4, 37.7, 1000);
const toEnu = Matrix4.inverse(Transforms.eastNorthUpToFixedFrame(pos), new Matrix4());
const enu = (q: ReturnType<typeof modelOrientation>, v: Cartesian3) => {
  const w = Matrix3.multiplyByVector(Matrix3.fromQuaternion(q), v, new Cartesian3());
  return Matrix4.multiplyByPointAsVector(toEnu, w, new Cartesian3());
};

test("body nose follows heading, pitch raises it, right bank lowers right wing", () => {
  const east = enu(modelOrientation(pos, 90, 0, 0), Cartesian3.UNIT_X);
  assert.ok(east.x > 0.99, "heading 090 points east");
  const north = enu(modelOrientation(pos, 0, 0, 0), Cartesian3.UNIT_X);
  assert.ok(north.y > 0.99, "heading 000 points north");
  const climb = enu(modelOrientation(pos, 90, 15, 0), Cartesian3.UNIT_X);
  assert.ok(climb.z > 0.25, "positive pitch raises the nose");
  const rightWing = enu(modelOrientation(pos, 90, 0, 30), new Cartesian3(0, -1, 0));
  assert.ok(rightWing.z < -0.4, "positive bank lowers the right wing");
});

test("model fixes are applied in the model frame, so pitch is still pitch", () => {
  for (const a of AIRCRAFT) {
    // The GLB's native nose axis is whatever the fix rotates onto body +X.
    const nativeNose = enu(modelOrientation(pos, 90, 0, 0, a.modelFix), Cartesian3.UNIT_X);
    const fixedOnly = enu(modelOrientation(pos, 90, 0, 0), Cartesian3.UNIT_X);
    assert.ok(Math.abs(Cartesian3.dot(nativeNose, fixedOnly)) <= 1.0001, a.id);
    // Climbing must lift the model's top surface toward the tail for every model.
    const level = modelOrientation(pos, 90, 0, 0, a.modelFix);
    const up = modelOrientation(pos, 90, 20, 0, a.modelFix);
    const inv = (q: typeof level) => Matrix3.transpose(Matrix3.fromQuaternion(q), new Matrix3());
    // Native-model vector that ends up as the flight direction:
    const noseNative = Matrix3.multiplyByVector(inv(level), Matrix3.multiplyByVector(Matrix3.fromQuaternion(modelOrientation(pos, 90, 0, 0)), Cartesian3.UNIT_X, new Cartesian3()), new Cartesian3());
    const climbedNose = enu(up, noseNative);
    assert.ok(climbedNose.z > 0.3, `${a.id}: pitch-up raises the model's nose`);
    assert.ok(climbedNose.x > 0.9, `${a.id}: nose stays on heading while climbing`);
  }
});
