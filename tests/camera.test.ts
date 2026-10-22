import { test } from "node:test";
import assert from "node:assert/strict";
import { Cartesian3 } from "cesium";
import {
  computeExteriorCamera,
  smoothExteriorCamera,
  type ExteriorCameraMode,
} from "../src/camera.ts";

const close = (actual: number, expected: number, tolerance = 1e-8) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} differs from ${expected}`,
  );
for (const mode of ["chase", "wing", "front"] as ExteriorCameraMode[]) {
  test(`${mode} centers the aircraft and fits portrait and landscape views`, () => {
    for (const aspect of [390 / 844, 1, 844 / 390, 3.5]) {
      for (const heading of [0, 90, 180, 270]) {
        const view = computeExteriorCamera(
          { lat: 37.8, lon: -122.4, alt: 1000, heading, mode },
          aspect,
        );
        const delta = Cartesian3.subtract(
          view.target,
          view.destination,
          new Cartesian3(),
        );
        const distance = Cartesian3.magnitude(delta);
        close(
          Cartesian3.dot(view.direction, Cartesian3.normalize(delta, delta)),
          1,
        );
        close(Cartesian3.dot(view.direction, view.up), 0);
        close(Cartesian3.magnitude(view.up), 1);
        const halfFov = Math.atan(
          Math.tan(Math.PI / 6) * Math.min(aspect, 1 / aspect),
        );
        assert.ok(
          Math.asin(12 / distance) < halfFov * 0.7,
          "aircraft bounding sphere must fit in the smaller viewport axis",
        );
      }
    }
  });
}
test("camera smoothing follows boosted translation without losing the target", () => {
  const previous = computeExteriorCamera(
    { lat: 0, lon: 0, alt: 1000, heading: 90, mode: "chase" },
    2.2,
  );
  const desired = computeExteriorCamera(
    { lat: 0, lon: 0.001, alt: 1000, heading: 110, mode: "chase" },
    2.2,
  );
  const view = smoothExteriorCamera(previous, desired, 1 / 60);
  close(Cartesian3.distance(view.target, desired.target), 0);
  const toTarget = Cartesian3.normalize(
    Cartesian3.subtract(view.target, view.destination, new Cartesian3()),
    new Cartesian3(),
  );
  close(Cartesian3.dot(toTarget, view.direction), 1);
  assert.ok(
    Cartesian3.distance(view.destination, view.target) >=
      Cartesian3.distance(desired.destination, desired.target) - 1e-7,
  );
});
test("heading wrap takes the short smooth orbit path", () => {
  const old = computeExteriorCamera(
    { lat: 0, lon: 0, alt: 1000, heading: 359, mode: "chase" },
    2.2,
  );
  const desired = computeExteriorCamera(
    { lat: 0, lon: 0, alt: 1000, heading: 1, mode: "chase" },
    2.2,
  );
  const view = smoothExteriorCamera(old, desired, 1 / 60);
  assert.ok(Cartesian3.distance(view.destination, old.destination) < 1);
});
test("rotation into short landscape immediately gains enough framing distance", () => {
  const old = computeExteriorCamera(
    { lat: 0, lon: 0, alt: 1000, heading: 90, mode: "chase" },
    1,
  );
  const desired = computeExteriorCamera(
    { lat: 0, lon: 0, alt: 1000, heading: 90, mode: "chase" },
    3.5,
  );
  const view = smoothExteriorCamera(old, desired, 1 / 60);
  assert.ok(
    Cartesian3.distance(view.destination, view.target) >=
      Cartesian3.distance(desired.destination, desired.target) - 1e-7,
  );
});
