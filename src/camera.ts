import { Cartesian3, Matrix4, Transforms } from "cesium";

export type ExteriorCameraMode = "chase" | "wing" | "front";
export type ExteriorCameraPose = {
  destination: Cartesian3;
  direction: Cartesian3;
  up: Cartesian3;
  /** Current rendered aircraft center, not the next simulation state. */
  target: Cartesian3;
  mode: ExteriorCameraMode;
};
export type RenderedAircraftPose = {
  lat: number;
  lon: number;
  alt: number;
  heading: number;
  mode: ExteriorCameraMode;
};

const MODEL_RADIUS_METERS = 12;
const DEFAULT_HALF_FOV = Math.PI / 6;

/**
 * Cesium's default 60-degree FOV is measured across the larger viewport axis.
 * Fit the aircraft to the smaller axis too, including short landscape screens.
 */
export function cameraDistanceForAspect(
  aspectRatio: number,
  modelRadius = MODEL_RADIUS_METERS,
): number {
  const aspect =
    Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const smallerAxisRatio = Math.min(aspect, 1 / aspect);
  const smallerHalfFov = Math.atan(
    Math.tan(DEFAULT_HALF_FOV) * smallerAxisRatio,
  );
  const radius =
    Number.isFinite(modelRadius) && modelRadius > 0
      ? modelRadius
      : MODEL_RADIUS_METERS;
  return Math.max(44, radius / Math.tan(smallerHalfFov * 0.62));
}

function lookAtAircraft(
  target: Cartesian3,
  destination: Cartesian3,
  approximateUp: Cartesian3,
  mode: ExteriorCameraMode,
): ExteriorCameraPose {
  const direction = Cartesian3.normalize(
    Cartesian3.subtract(target, destination, new Cartesian3()),
    new Cartesian3(),
  );
  const right = Cartesian3.normalize(
    Cartesian3.cross(direction, approximateUp, new Cartesian3()),
    new Cartesian3(),
  );
  // setView requires a perpendicular direction/up frame. Radial up by itself
  // is not perpendicular when looking down from above the aircraft.
  const up = Cartesian3.normalize(
    Cartesian3.cross(right, direction, new Cartesian3()),
    new Cartesian3(),
  );
  return { destination, direction, up, target, mode };
}

/** Compute an exterior view using the aircraft pose already rendered this frame. */
export type CameraOrbit = { yaw: number; pitch: number };

/** Mouse/touch orbit limits: elevation stays between just below the
 * aircraft and nearly overhead, so the view never flips. */
export const MIN_ORBIT_ELEVATION = (3 * Math.PI) / 180;
export const MAX_ORBIT_ELEVATION = (80 * Math.PI) / 180;
export const ORBIT_YAW_PER_PX = 0.006;
export const ORBIT_PITCH_PER_PX = 0.004;

/** Pitch offset that keeps a mode's base elevation inside the limits. */
export function clampOrbitPitch(mode: ExteriorCameraMode, pitch: number): number {
  const base = baseElevation(mode);
  if (!Number.isFinite(pitch)) return 0;
  return Math.min(MAX_ORBIT_ELEVATION - base, Math.max(MIN_ORBIT_ELEVATION - base, pitch));
}

/** Drag in screen pixels → orbit. Right drag swings the camera right (view
 * rotates left); drag up raises the camera to look down on the aircraft.
 * The camera never goes below 3° so it can't dip under the ground. */
export function orbitAfterDrag(
  orbit: CameraOrbit,
  mode: ExteriorCameraMode,
  dx: number,
  dy: number,
): CameraOrbit {
  let yaw = orbit.yaw - dx * ORBIT_YAW_PER_PX;
  yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
  return { yaw, pitch: clampOrbitPitch(mode, orbit.pitch - dy * ORBIT_PITCH_PER_PX) };
}

function modeOffset(mode: ExteriorCameraMode) {
  const side = mode === "wing" ? -0.98 : 0;
  const forward = mode === "front" ? 0.97 : mode === "wing" ? -0.18 : -0.96;
  const height = mode === "wing" ? 0.23 : mode === "front" ? 0.24 : 0.28;
  return { side, forward, height };
}

function baseElevation(mode: ExteriorCameraMode) {
  const { side, forward, height } = modeOffset(mode);
  return Math.atan2(height, Math.hypot(side, forward));
}

export function computeExteriorCamera(
  aircraft: RenderedAircraftPose,
  aspectRatio: number,
  modelRadius = MODEL_RADIUS_METERS,
  orbit: CameraOrbit = { yaw: 0, pitch: 0 },
): ExteriorCameraPose {
  const target = Cartesian3.fromDegrees(
    aircraft.lon,
    aircraft.lat,
    aircraft.alt,
  );
  const frame = Transforms.eastNorthUpToFixedFrame(target);
  const distance = cameraDistanceForAspect(aspectRatio, modelRadius);
  const heading = (aircraft.heading * Math.PI) / 180;
  let { side, forward, height } = modeOffset(aircraft.mode);
  if (orbit.yaw || orbit.pitch) {
    // Same radius, rotated by the user's orbit around the aircraft.
    const h = Math.hypot(side, forward);
    const r = Math.hypot(h, height);
    const az = Math.atan2(side, forward) + orbit.yaw;
    const el = baseElevation(aircraft.mode) + clampOrbitPitch(aircraft.mode, orbit.pitch);
    side = r * Math.cos(el) * Math.sin(az);
    forward = r * Math.cos(el) * Math.cos(az);
    height = r * Math.sin(el);
  }
  // Body-horizontal right/forward to local east/north. North heading is zero.
  const offset = new Cartesian3(
    (side * Math.cos(heading) + forward * Math.sin(heading)) * distance,
    (-side * Math.sin(heading) + forward * Math.cos(heading)) * distance,
    height * distance,
  );
  const destination = Matrix4.multiplyByPoint(frame, offset, new Cartesian3());
  const worldUp = Matrix4.multiplyByPointAsVector(
    frame,
    Cartesian3.UNIT_Z,
    new Cartesian3(),
  );
  return lookAtAircraft(target, destination, worldUp, aircraft.mode);
}

/**
 * Smooth the orbit offset, always anchoring it to the current rendered target.
 * Interpolating world-space camera position would trail a boosted aircraft and
 * eventually put it behind the camera. Translation therefore follows exactly.
 */
export function smoothExteriorCamera(
  previous: ExteriorCameraPose | undefined,
  desired: ExteriorCameraPose,
  dt: number,
): ExteriorCameraPose {
  if (
    !previous ||
    previous.mode !== desired.mode ||
    Cartesian3.distance(previous.target, desired.target) > 10000
  ) {
    return desired;
  }
  const seconds = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
  const alpha = 1 - Math.exp(-seconds / 0.18);
  const previousOffset = Cartesian3.subtract(
    previous.destination,
    previous.target,
    new Cartesian3(),
  );
  const desiredOffset = Cartesian3.subtract(
    desired.destination,
    desired.target,
    new Cartesian3(),
  );
  const offset = Cartesian3.lerp(
    previousOffset,
    desiredOffset,
    alpha,
    new Cartesian3(),
  );
  // A sudden resize must not leave the new narrow view at the old close distance.
  const requiredDistance = Cartesian3.magnitude(desiredOffset);
  const actualDistance = Cartesian3.magnitude(offset);
  if (actualDistance < 1e-6) return desired;
  if (actualDistance < requiredDistance) {
    Cartesian3.multiplyByScalar(
      offset,
      requiredDistance / actualDistance,
      offset,
    );
  }
  const destination = Cartesian3.add(desired.target, offset, new Cartesian3());
  return lookAtAircraft(desired.target, destination, desired.up, desired.mode);
}

export const MIN_CAMERA_ZOOM = 0.3;
export const MAX_CAMERA_ZOOM = 5;

export function clampCameraZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_CAMERA_ZOOM, Math.max(MIN_CAMERA_ZOOM, zoom));
}

/** Positive deltaY zooms out (farther from the aircraft). */
export function zoomAfterWheel(
  zoom: number,
  deltaY: number,
  deltaMode = 0,
): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return clampCameraZoom(zoom);
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? 80 : 1;
  return clampCameraZoom(zoom * Math.exp(deltaY * unit * 0.0016));
}

/** direction < 0 zooms in, > 0 zooms out. Used for PageUp / PageDown. */
export function zoomAfterStep(zoom: number, direction: number): number {
  if (!direction) return clampCameraZoom(zoom);
  return clampCameraZoom(zoom * (direction < 0 ? 0.82 : 1.22));
}

/** Scale an already-framed exterior pose without changing its look direction. */
export function applyCameraZoom(
  pose: ExteriorCameraPose,
  zoom: number,
): ExteriorCameraPose {
  const factor = clampCameraZoom(zoom);
  if (Math.abs(factor - 1) < 1e-9) return pose;
  const offset = Cartesian3.subtract(
    pose.destination,
    pose.target,
    new Cartesian3(),
  );
  Cartesian3.multiplyByScalar(offset, factor, offset);
  const destination = Cartesian3.add(pose.target, offset, new Cartesian3());
  return lookAtAircraft(pose.target, destination, pose.up, pose.mode);
}

