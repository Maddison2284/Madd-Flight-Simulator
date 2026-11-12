import * as C from "cesium";
import type { Aircraft } from "./aircraft";
import type { Flight } from "./physics";
import { rotorParams } from "./flight-model";
import { GEAR_NODES, type GearAnimator } from "./gear";

/** Spinning parts rigged into the GLBs by scripts/rig-rotors.mjs. Each part
 * has a blade node (pivot at the hub) and a `<node>_disc` motion-blur disc.
 * axis is the spin axis in native glTF node coordinates. */
type Part = {
  node: string;
  axis: C.Cartesian3;
  /** Apparent revolutions per second at 100% RPM. Deliberately below the
   * real rate: a 2-blade prop at its true ~40 rps advances 240°/frame at
   * 60 fps, which aliases into a frozen or backwards-stepping prop. These
   * rates stay under ~60°/frame so the eye reads continuous spin. */
  rps: number;
  dir: 1 | -1;
  /** Keep the part visible at any RPM (no blur-disc swap). */
  solid?: boolean;
  /** Jet engine fan (scripts/rig-fans.mjs): instead of a `_disc` node it has
   * two stacked translucent blur discs, `_blur1` / `_blur2`, that switch on
   * one after the other as N1 rises (Cesium can't fade a node's alpha, so
   * two steps make the fade). */
  fan?: boolean;
};

const Y = C.Cartesian3.UNIT_Y,
  Z = C.Cartesian3.UNIT_Z,
  X = C.Cartesian3.UNIT_X;

/** Both engines' fans (`mf_fan_1`, `mf_fan_2`), turning the same way. */
const FANS = (axis: C.Cartesian3, rps: number, dir: 1 | -1): Part[] =>
  [1, 2].map((n) => ({ node: `mf_fan_${n}`, axis, rps, dir, fan: true }));

/** Extra (non-spinning-blade) node names a part drives. */
export function partNodes(p: Part): string[] {
  return p.fan ? [p.node, p.node + "_blur1", p.node + "_blur2"] : [p.node, p.node + "_disc"];
}

/** Fan blur discs: the first fades in from ~55% N1, the second from ~80%,
 * so idle shows crisp blades and take-off power a blurred disc. */
export function fanBlur(rpm: number) {
  return { blur1: rpm > 0.55, blur2: rpm > 0.8 };
}

export const ROTOR_PARTS: Record<string, Part[]> = {
  bell206: [
    { node: "mf_main_rotor", axis: Y, rps: 6.6, dir: -1 },
    { node: "mf_tail_rotor", axis: Z, rps: 9, dir: 1 },
  ],
  c172: [{ node: "mf_prop", axis: X, rps: 8, dir: 1 }],
  // Turbofans: the fan art has ~22-24 blades (15-16 deg apart), so the
  // apparent rate stays under ~half a blade per frame at 60 fps (< 1 rps)
  // or the blades alias into a stopped / backwards fan. The blur discs
  // carry the "fast" look at high N1.
  a320: FANS(Y, 0.9, 1),
  citation: FANS(X, 0.9, 1),
  saucer: [{ node: "mf_saucer_ring", axis: Y, rps: 0.6, dir: 1, solid: true }],
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

/** A translucent blur disc fades in as RPM rises. Blades stay visible and
 * keep turning so the spin is always readable (earlier builds hid the blades
 * above ~80% RPM, which on the live site looked like "the prop isn't
 * spinning"). */
export function bladeAndDiscScale(rpm: number) {
  const disc = C.Math.clamp((rpm - 0.35) / 0.25, 0, 1);
  return { disc, blades: 1 };
}

type ModelLike = { ready?: boolean; getNode?: (n: string) => unknown; length?: number; get?: (i: number) => unknown; _resource?: { url?: string }; resource?: { url?: string }; show?: boolean };

/** Find the loaded Cesium Model for `uri` and report which spin nodes it has. */
export function matchRotorNodes(scene: C.Scene, aircraft: Aircraft): { found: string[]; missing: string[] } | null {
  const want = [
    ...(ROTOR_PARTS[aircraft.id] ?? []).flatMap(partNodes),
    ...(AFTERBURNER_NODES[aircraft.id] ?? []),
  ];
  const visit = (prim: ModelLike, depth: number): { found: string[]; missing: string[] } | null => {
    if (!prim || depth > 6) return null;
    if (typeof prim.getNode === "function") {
      const url = prim.resource?.url ?? prim._resource?.url ?? "";
      if (!prim.ready || !url.includes(aircraft.uri)) return null;
      const found = want.filter((n) => prim.getNode!(n));
      return { found, missing: want.filter((n) => !found.includes(n)) };
    }
    if (typeof prim.get === "function" && typeof prim.length === "number")
      for (let i = 0; i < prim.length; i++) {
        const r = visit(prim.get(i) as ModelLike, depth + 1);
        if (r) return r;
      }
    return null;
  };
  return visit(scene.primitives as unknown as ModelLike, 0);
}

/** Afterburner plume nodes merged into fighter.glb (scripts/merge-glb.mjs). */
export const AFTERBURNER_NODES: Record<string, string[]> = {
  fighter: ["mf_ab_L", "mf_ab_R"],
};

/** Plume size from throttle: a short blue glow at idle, growing orange
 * plume, and a big flare (with shock diamonds) at full throttle / boost.
 * `flicker` is 0..1 noise; returns metres (plume is authored 1 m long). */
export function afterburnerScale(throttle: number, boost: boolean, flicker: number) {
  const t = C.Math.clamp(throttle, 0, 1);
  const flare = C.Math.clamp((t - 0.85) / 0.15, 0, 1) + (boost ? 0.6 : 0);
  const length = 0.5 + 3.5 * t * t + 4 * flare;
  const radius = 0.65 + 0.3 * t + 0.25 * flare;
  const jitter = 1 + (flicker - 0.5) * (0.12 + 0.18 * t);
  return { length: length * jitter, radius: radius * (1 + (flicker - 0.5) * 0.06) };
}

export class RotorAnimator {
  rpm = 0;
  private angles = new Map<string, number>();
  private trs = new Map<string, C.TranslationRotationScale>();
  private aircraftId = "";
  /** Node-match report for the loaded model (logged once per aircraft). */
  matched: { aircraft: string; found: string[]; missing: string[] } | null = null;

  /** Call each frame; logs once which spin nodes the loaded model exposes. */
  check(scene: C.Scene, aircraft: Aircraft) {
    if (this.matched?.aircraft === aircraft.id) return;
    const r = matchRotorNodes(scene, aircraft);
    if (!r) return;
    this.matched = { aircraft: aircraft.id, ...r };
    console.info(
      `[rotors] ${aircraft.id}: spin nodes found [${r.found.join(", ") || "none"}]` +
        (r.missing.length ? ` missing [${r.missing.join(", ")}]` : ""),
    );
  }

  /** Frame-rate independent: RPM spools with a time constant, angle
   * advances by rpm * rps * dt. Call once per rendered frame. */
  update(aircraft: Aircraft, f: Flight, dt: number, flying: boolean) {
    if (aircraft.id !== this.aircraftId) {
      this.aircraftId = aircraft.id;
      this.angles.clear();
      this.rpm = 0;
    }
    const target = flying ? targetRpm(aircraft, f) : 0;
    // Turbofans spool slower than a piston prop or a governed rotor.
    const jet = aircraft.engine === "jet";
    const tau = target > this.rpm ? (jet ? 2.4 : 1.6) : jet ? 3.5 : 2.5;
    this.rpm += (target - this.rpm) * (1 - Math.exp(-dt / tau));
    this.updateAfterburner(aircraft, f, flying);
    const { disc, blades } = bladeAndDiscScale(this.rpm);
    for (const part of ROTOR_PARTS[aircraft.id] ?? []) {
      const a =
        ((this.angles.get(part.node) ?? 0) +
          part.dir * this.rpm * part.rps * Math.PI * 2 * dt) %
        (Math.PI * 2);
      this.angles.set(part.node, a);
      const spin = C.Quaternion.fromAxisAngle(part.axis, a);
      if (part.fan) {
        // Blur nodes are authored at scale 0.001 (hidden in static viewers).
        const b = fanBlur(this.rpm);
        this.set(part.node, spin, 1);
        this.set(part.node + "_blur1", spin, b.blur1 ? 1000 : 1);
        this.set(part.node + "_blur2", C.Quaternion.fromAxisAngle(part.axis, -a * 0.5), b.blur2 ? 1000 : 1);
        continue;
      }
      this.set(part.node, spin, part.solid ? 1 : Math.max(blades, 0.001));
      // The disc node is authored at scale 0.001 (hidden in static viewers).
      this.set(part.node + "_disc", spin, Math.max(disc, 0.001) * 1000);
    }
  }

  /** Called from update(): afterburner plumes (per-frame flicker). */
  private updateAfterburner(aircraft: Aircraft, f: Flight, flying: boolean) {
    for (const node of AFTERBURNER_NODES[aircraft.id] ?? []) {
      const t = this.trs.get(node) ?? new C.TranslationRotationScale();
      if (!flying || f.crashed) t.scale = new C.Cartesian3(0.001, 0.001, 0.001);
      else {
        const { length, radius } = afterburnerScale(f.throttle, f.boost, Math.random());
        t.scale = new C.Cartesian3(radius, radius, length);
      }
      this.trs.set(node, t);
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
  nodeTransformations(getAircraft: () => Aircraft, gear?: GearAnimator): C.PropertyBag {
    const bag: Record<string, C.CallbackProperty> = {};
    if (gear) {
      // Landing gear legs + doors (src/gear.ts), posed from the animator.
      const trs = new Map<string, C.TranslationRotationScale>();
      let cacheKey = "";
      let cached: ReturnType<GearAnimator["poses"]> = {};
      for (const node of GEAR_NODES)
        bag[node] = new C.CallbackProperty(() => {
          if (gear.id !== getAircraft().id) return undefined;
          const key = `${gear.id}:${gear.pos.toFixed(4)}`;
          if (key !== cacheKey) {
            cacheKey = key;
            cached = gear.poses();
          }
          const p = cached[node];
          if (!p) return undefined;
          const t = trs.get(node) ?? new C.TranslationRotationScale();
          t.translation = new C.Cartesian3(p.t[0], p.t[1], p.t[2]);
          t.rotation = new C.Quaternion(p.q[0], p.q[1], p.q[2], p.q[3]);
          trs.set(node, t);
          return t;
        }, false);
    }
    const nodes = [
      ...new Set(Object.values(ROTOR_PARTS).flat().flatMap(partNodes)),
      ...Object.values(AFTERBURNER_NODES).flat(),
    ];
    for (const node of nodes)
      bag[node] = new C.CallbackProperty(
        () => (this.aircraftId === getAircraft().id ? this.trs.get(node) : undefined),
        false,
      );
    return new C.PropertyBag(bag);
  }
}
