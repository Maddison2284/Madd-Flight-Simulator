import { HeadingPitchRoll, Math as CesiumMath } from "cesium";
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
