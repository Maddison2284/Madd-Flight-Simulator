import { test } from "node:test";
import assert from "node:assert/strict";
import { Cartesian3 } from "cesium";
import {
  MAX_ORBIT_ELEVATION,
  MIN_ORBIT_ELEVATION,
  computeExteriorCamera,
  orbitAfterDrag,
} from "../src/camera.ts";

const pose = { lat: 37, lon: -122, alt: 1000, heading: 90, mode: "chase" as const };
const dist = (p: ReturnType<typeof computeExteriorCamera>) => Cartesian3.distance(p.destination, p.target);

test("zero orbit is the default chase view", () => {
  const a = computeExteriorCamera(pose, 1.5, 12);
  const b = computeExteriorCamera(pose, 1.5, 12, { yaw: 0, pitch: 0 });
  assert.ok(Cartesian3.distance(a.destination, b.destination) < 1e-6);
});

test("orbit keeps distance, swings around the aircraft, and clamps pitch", () => {
  const base = computeExteriorCamera(pose, 1.5, 12);
  const side = computeExteriorCamera(pose, 1.5, 12, { yaw: Math.PI / 2, pitch: 0 });
  assert.ok(Math.abs(dist(base) - dist(side)) < 1e-3);
  assert.ok(Cartesian3.distance(base.destination, side.destination) > dist(base));
  let o = { yaw: 0, pitch: 0 };
  for (let i = 0; i < 100; i++) o = orbitAfterDrag(o, "chase", 0, -50);
  const top = computeExteriorCamera(pose, 1.5, 12, o);
  const up = Cartesian3.normalize(top.target, new Cartesian3());
  const off = Cartesian3.normalize(Cartesian3.subtract(top.destination, top.target, new Cartesian3()), new Cartesian3());
  const el = Math.asin(Cartesian3.dot(up, off));
  assert.ok(el <= MAX_ORBIT_ELEVATION + 0.02 && el > 1.2, `el ${el}`);
  for (let i = 0; i < 200; i++) o = orbitAfterDrag(o, "chase", 0, 50);
  const low = computeExteriorCamera(pose, 1.5, 12, o);
  const off2 = Cartesian3.normalize(Cartesian3.subtract(low.destination, low.target, new Cartesian3()), new Cartesian3());
  assert.ok(Math.asin(Cartesian3.dot(up, off2)) >= MIN_ORBIT_ELEVATION - 0.02);
  assert.ok(Number.isFinite(orbitAfterDrag(o, "chase", 1e6, 0).yaw));
});
