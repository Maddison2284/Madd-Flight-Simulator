import {
  Cartesian3,
  HeadingPitchRoll,
  Math as CesiumMath,
  Quaternion,
  Transforms,
} from "cesium";

/** Per-model correction (degrees) that turns a GLB's native axes into the
 * Cesium aircraft body frame: nose +X, left wing +Y, up +Z. It is applied in
 * the model's own frame *before* the flight attitude, so pitch always raises
 * the nose and roll always banks about the fuselage, whatever the model's
 * authoring axes were. (Adding the offset to heading instead made pitch and
 * roll act about the wrong axes for any model not authored nose-forward.)
 */
export type ModelFix = { heading: number; pitch: number; roll: number };
export const NO_FIX: ModelFix = { heading: 0, pitch: 0, roll: 0 };

/** Cesium model frame: +X forward, +Y left, +Z up.
 * Positive bank rotates the right wing (-Y) down and turns heading clockwise.
 */
export function modelAttitude(heading: number, pitch: number, roll: number) {
  return new HeadingPitchRoll(
    CesiumMath.toRadians(heading - 90),
    CesiumMath.toRadians(pitch),
    CesiumMath.toRadians(roll),
  );
}

export function fixQuaternion(fix: ModelFix = NO_FIX): Quaternion {
  return Quaternion.fromHeadingPitchRoll(
    new HeadingPitchRoll(
      CesiumMath.toRadians(fix.heading),
      CesiumMath.toRadians(fix.pitch),
      CesiumMath.toRadians(fix.roll),
    ),
  );
}

/** World orientation for an aircraft model at `position` flying the given
 * compass heading, pitch (nose up +) and bank (right wing down +). */
export function modelOrientation(
  position: Cartesian3,
  heading: number,
  pitch: number,
  roll: number,
  fix: ModelFix = NO_FIX,
  result = new Quaternion(),
): Quaternion {
  const body = Transforms.headingPitchRollQuaternion(
    position,
    modelAttitude(heading, pitch, roll),
  );
  return Quaternion.multiply(body, fixQuaternion(fix), result);
}
