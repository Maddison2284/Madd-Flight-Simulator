import * as C from "cesium";
import type { Aircraft } from "./aircraft";
import type { Flight } from "./physics";
import { rotorParams } from "./flight-model";

/** Spinning parts rigged into the GLBs by scripts/rig-rotors.mjs. Each part
 * has a blade node (pivot at the hub) and a `<node>_disc` motion-blur disc.
 * axis is the spin axis in native glTF node coordinates. */
type Part = {
  node: string;
  axis: C.Cartesian3;
  /** Revolutions per second at 100% RPM (visual). */
  rps: number;
  dir: 1 | -1;
};

const Y = C.Cartesian3.UNIT_Y,
  Z = C.Cartesian3.UNIT_Z,
  X = C.Cartesian3.UNIT_X;

export const ROTOR_PARTS: Record<string, Part[]> = {
  bell206: [
    { node: "mf_main_rotor", axis: Y, rps: 6.6, dir: -1 },
    { node: "mf_tail_rotor", axis: Z, rps: 30, dir: 1 },
  ],
  c172: [{ node: "mf_prop", axis: X, rps: 40, dir: 1 }],
};

/** Engine / rotor RPM as a fraction of maximum.
 * Props and jets follow the throttle from an idle floor. A helicopter's rotor
 * is governed: it runs near 100% whenever the engine is on, with collective
 * changing blade pitch (and a small RPM droop/rise), as in a real Bell 206. */
export function targetRpm(aircraft: Aircraft, f: Flight): number {
  if (f.crashed) return 0;
  if (rotorParams(aircraft)) return 0.92 + 0.08 * f.throttle;
  return 0.22 + 0.78 * f.throttle;
}

/** Blades fade into a translucent disc as RPM rises (scale fade), so
 * high-RPM spin reads as motion blur instead of strobing. */
export function bladeAndDiscScale(rpm: number) {
  const disc = C.Math.clamp((rpm - 0.35) / 0.25, 0, 1);
  const blades = 1 - C.Math.clamp((rpm - 0.62) / 0.2, 0, 1);
  return { disc, blades };
}

export class RotorAnimator {
  rpm = 0;
  private angles = new Map<string, number>();
  private trs = new Map<string, C.TranslationRotationScale>();
  private aircraftId = "";

  /** Frame-rate independent: RPM spools with a time constant, angle
   * advances by rpm * rps * dt. Call once per rendered frame. */
  update(aircraft: Aircraft, f: Flight, dt: number, flying: boolean) {
    if (aircraft.id !== this.aircraftId) {
      this.aircraftId = aircraft.id;
      this.angles.clear();
      this.rpm = 0;
    }
    const target = flying ? targetRpm(aircraft, f) : 0;
    const tau = target > this.rpm ? 1.6 : 2.5;
    this.rpm += (target - this.rpm) * (1 - Math.exp(-dt / tau));
    const { disc, blades } = bladeAndDiscScale(this.rpm);
    for (const part of ROTOR_PARTS[aircraft.id] ?? []) {
      const a =
        ((this.angles.get(part.node) ?? 0) +
          part.dir * this.rpm * part.rps * Math.PI * 2 * dt) %
        (Math.PI * 2);
      this.angles.set(part.node, a);
      const spin = C.Quaternion.fromAxisAngle(part.axis, a);
      this.set(part.node, spin, Math.max(blades, 0.001));
      // The disc node is authored at scale 0.001 (hidden in static viewers).
      this.set(part.node + "_disc", spin, Math.max(disc, 0.001) * 1000);
    }
  }

  angle(node: string) {
    return this.angles.get(node) ?? 0;
  }

  private set(node: string, rotation: C.Quaternion, s: number) {
    const t = this.trs.get(node) ?? new C.TranslationRotationScale();
    t.rotation = rotation;
    t.scale = new C.Cartesian3(s, s, s);
    this.trs.set(node, t);
  }

  /** PropertyBag for ModelGraphics.nodeTransformations. */
  nodeTransformations(getAircraft: () => Aircraft): C.PropertyBag {
    const nodes = Object.values(ROTOR_PARTS)
      .flat()
      .flatMap((p) => [p.node, p.node + "_disc"]);
    const bag: Record<string, C.CallbackProperty> = {};
    for (const node of nodes)
      bag[node] = new C.CallbackProperty(
        () => (this.aircraftId === getAircraft().id ? this.trs.get(node) : undefined),
        false,
      );
    return new C.PropertyBag(bag);
  }
}
