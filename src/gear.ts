/** Retractable landing gear: state, timing and node poses.
 *
 * Only aircraft whose GLB has separate gear nodes can retract (today: the
 * stealth fighter). The airliner and Citation GLBs are single merged meshes,
 * the Cessna 172 has fixed gear, the helicopter has skids and the saucer has
 * none, so they report `retractable: false`.
 *
 * Pure math only (no Cesium import) so it is unit-testable in Node; rotors.ts
 * turns the poses into Cesium TranslationRotationScale values. */

export type Quat = [number, number, number, number];
export type Vec3 = [number, number, number];
/** Applied as node.originalMatrix × TRS (Cesium nodeTransformations). */
export type NodePose = { t: Vec3; q: Quat };

/** Full retract / extend time (s). */
export const GEAR_CYCLE_S = 1.6;
/** Gear starts UP when a flight spawns more than this far above the ground. */
export const GEAR_UP_SPAWN_AGL_M = 152.4; // 500 ft
/** Below this height, descending with the gear up, warn the pilot. */
export const GEAR_WARN_AGL_M = 152.4; // 500 ft
/** Below this height, slow and descending with the gear up: auto-extend. */
export const GEAR_AUTO_DOWN_AGL_M = 45.7; // 150 ft
/** Airborne drag factor with the gear fully up (gear down = 1). */
export const GEAR_UP_DRAG = 0.9;

type Part = {
  node: string;
  kind: "leg" | "door";
  /** Rotation axis (in the parent frame) and angle (deg) at full retract. */
  axis: Vec3;
  deg: number;
  /** Extra translation (parent frame, m) at full retract. */
  lift: Vec3;
  /** The node's own glTF rotation (doors are authored open and rotated). */
  orig?: Quat;
};

const X: Vec3 = [1, 0, 0],
  Z: Vec3 = [0, 0, 1];

/** Fighter rig (glTF frame: +Y up, +Z nose). Mains fold inward into the
 * belly, the nose leg folds forward, then the doors swing shut flush with the
 * underside. Tuned against renders of fighter.glb. */
export const GEAR_RIGS: Record<string, Part[]> = {
  fighter: [
    { node: "gear_main_L", kind: "leg", axis: Z, deg: -90, lift: [0, 0.4, 0] },
    { node: "gear_main_R", kind: "leg", axis: Z, deg: 90, lift: [0, 0.4, 0] },
    { node: "gear_nose", kind: "leg", axis: X, deg: -90, lift: [0, 0, 0] },
    {
      node: "gear_door_main_L", kind: "door", axis: Z, deg: -90, lift: [0, -0.5, 0],
      orig: [-0.5683016777038574, 0.449119508266449, 0.546160876750946, 0.4207531213760376],
    },
    {
      node: "gear_door_main_R", kind: "door", axis: Z, deg: 90, lift: [0, -0.5, 0],
      orig: [-0.4491194784641266, 0.5683017373085022, 0.4207531809806824, 0.546160876750946],
    },
    {
      node: "gear_door_nose_L", kind: "door", axis: Z, deg: -90, lift: [0, -0.15, 0],
      orig: [-0.5569726824760437, 0.48585546016693115, 0.5137552618980408, 0.43563908338546753],
    },
    {
      node: "gear_door_nose_R", kind: "door", axis: Z, deg: 90, lift: [0, -0.15, 0],
      orig: [-0.48585546016693115, 0.5569726824760437, 0.4356391131877899, 0.5137552618980408],
    },
  ],
};

export const GEAR_NODES: string[] = Object.values(GEAR_RIGS)
  .flat()
  .map((p) => p.node);

export const hasRetractableGear = (aircraftId: string) => Boolean(GEAR_RIGS[aircraftId]);

/** Start gear position for a new flight: down on the ground or near it,
 * up when spawning airborne above ~500 ft. */
export function initialGearUp(aircraftId: string, onGround: boolean, aglM: number) {
  return hasRetractableGear(aircraftId) && !onGround && aglM > GEAR_UP_SPAWN_AGL_M;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};

/** Retraction progress 0 (down & locked) … 1 (up & doors shut) → how far the
 * legs have folded and how far the doors have closed. Legs move first on
 * the way up, doors open first on the way down (same curve, reversed). */
export function gearPhases(pos: number) {
  return { legs: smooth(pos / 0.75), doors: smooth((pos - 0.7) / 0.3) };
}

/** Advance progress toward the commanded position at 1 / GEAR_CYCLE_S per s. */
export function stepGearPos(pos: number, up: boolean, dt: number) {
  const target = up ? 1 : 0;
  const rate = dt / GEAR_CYCLE_S;
  return pos < target ? Math.min(target, pos + rate) : Math.max(target, pos - rate);
}

export type GearStatus = "down" | "up" | "moving";
export function gearStatus(pos: number, up: boolean): GearStatus {
  if (up && pos >= 1) return "up";
  if (!up && pos <= 0) return "down";
  return "moving";
}

/** Toggle request. On the ground the gear is locked down (weight on wheels). */
export function toggleGear(
  f: { gearUp?: boolean; onGround?: boolean; crashed: boolean },
  aircraftId: string,
): { gearUp: boolean; refused?: "fixed" | "ground" } {
  const now = Boolean(f.gearUp);
  if (!hasRetractableGear(aircraftId)) return { gearUp: false, refused: "fixed" };
  if (f.crashed) return { gearUp: now };
  if (!now && f.onGround) return { gearUp: false, refused: "ground" };
  return { gearUp: !now };
}

/** Gear-up warning (descending low with the gear up). */
export function gearWarning(f: { gearUp?: boolean; onGround?: boolean; crashed: boolean; vs: number }, aglM: number) {
  return Boolean(f.gearUp) && !f.onGround && !f.crashed && f.vs < -1 && aglM < GEAR_WARN_AGL_M;
}

/** Auto-extend: slow, descending and very low with the gear up (a landing
 * attempt). Fast low passes keep the gear up. */
export function shouldAutoExtend(
  f: { gearUp?: boolean; onGround?: boolean; crashed: boolean; vs: number; speed: number },
  aglM: number,
  stallSpeed: number,
) {
  return gearWarning(f, aglM) && aglM < GEAR_AUTO_DOWN_AGL_M && f.speed < stallSpeed * 2.2;
}

// --- quaternion helpers -----------------------------------------------------
const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qinv = (a: Quat): Quat => [-a[0], -a[1], -a[2], a[3]];
export const axisAngle = (axis: Vec3, deg: number): Quat => {
  const h = (deg * Math.PI) / 360,
    s = Math.sin(h);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
};
export const rotateVec = (q: Quat, v: Vec3): Vec3 => {
  const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q));
  return [p[0], p[1], p[2]];
};

/** Node poses for retraction progress `pos` (0 = down). A parent-frame
 * rotation R about the node origin plus a parent-frame shift d becomes, in
 * the node's own frame (orig rotation Q): q = Q⁻¹·R·Q, t = Q⁻¹·d. */
export function gearPoses(aircraftId: string, pos: number): Record<string, NodePose> {
  const { legs, doors } = gearPhases(pos);
  const out: Record<string, NodePose> = {};
  for (const p of GEAR_RIGS[aircraftId] ?? []) {
    const k = p.kind === "leg" ? legs : doors;
    const r = axisAngle(p.axis, p.deg * k);
    const d: Vec3 = [p.lift[0] * k, p.lift[1] * k, p.lift[2] * k];
    if (!p.orig) out[p.node] = { t: d, q: r };
    else {
      const qi = qinv(p.orig);
      out[p.node] = { t: rotateVec(qi, d), q: qmul(qmul(qi, r), p.orig) };
    }
  }
  return out;
}

/** Per-frame animator owned by the flight loop. */
export class GearAnimator {
  pos = 0;
  private aircraftId = "";
  /** Snap to a state (new flight / aircraft change / touchdown). */
  reset(aircraftId: string, up: boolean) {
    this.aircraftId = aircraftId;
    this.pos = up ? 1 : 0;
  }
  update(aircraftId: string, up: boolean, dt: number) {
    if (aircraftId !== this.aircraftId) this.reset(aircraftId, up);
    this.pos = stepGearPos(this.pos, up, dt);
  }
  status(up: boolean) {
    return gearStatus(this.pos, up);
  }
  poses() {
    return gearPoses(this.aircraftId, this.pos);
  }
  get id() {
    return this.aircraftId;
  }
}
