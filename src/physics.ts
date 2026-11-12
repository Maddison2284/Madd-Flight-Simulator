export type Flight = {
  lat: number;
  lon: number;
  alt: number;
  heading: number;
  pitch: number;
  roll: number;
  speed: number;
  throttle: number;
  boost: boolean;
  vs: number;
  crashed: boolean;
  stall: boolean;
  /** Settled on the ground after a safe touchdown (or a ground start). */
  onGround?: boolean;
  /** Helicopter only: horizontal velocity north / east (m/s). */
  vn?: number;
  ve?: number;
  /** Helicopter only: smoothed yaw rate (deg/s). */
  yawRate?: number;
  /** Saucer only: 0 off, 1 = Mach 1.2, 2 = Mach 4 warp. */
  warp?: 0 | 1 | 2;
  /** Planes: ballistic sink (m/s) built up in thin air at extreme altitude. */
  sink?: number;
};
export type Controls = {
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
  /** Wheel brakes on the ground, 0..1. */
  brake?: number;
};
/** Highest selectable start altitude: 2,000,000 ft (609.6 km, low orbit). */
export const MAX_START_ALT_FT = 2_000_000;
export const MAX_START_ALT_M = MAX_START_ALT_FT * 0.3048;
/** Relative air density (exponential atmosphere, 8.5 km scale height). */
export const airDensity = (altM: number) => Math.exp(-Math.max(0, altM) / 8500);
/** Wings only fly where there is air: 1 = full lift, 0 = ballistic. */
export function liftFactor(altM: number, speed: number, stallSpeed: number) {
  const q = airDensity(altM) * (speed / Math.max(1, stallSpeed)) ** 2;
  return Math.max(0, Math.min(1, q));
}
export const clamp = (v: number, a: number, b: number) =>
  Math.max(a, Math.min(b, v));
export const wrap = (n: number) => ((n % 360) + 360) % 360;
export type Performance = {
  stallSpeed: number;
  minSpeed: number;
  spawnMax: number;
  cruiseMax: number;
  boostMax: number;
  thrust: number;
  boostThrust: number;
  drag: number;
  boostDrag: number;
  rollRate: number;
  pitchRate: number;
  yawRate: number;
  stallSink: number;
  /** Height of the model origin above the wheels / skids (m). Default 3. */
  gear?: number;
};

/** Matches the original single-aircraft constants so existing tests stay exact. */
export const DEFAULT_PERFORMANCE: Performance = {
  stallSpeed: 55,
  minSpeed: 15,
  spawnMax: 250,
  cruiseMax: 290,
  boostMax: 1100,
  thrust: 8,
  boostThrust: 120,
  drag: 0.00018,
  boostDrag: 0.00004,
  rollRate: 45,
  pitchRate: 18,
  yawRate: 10,
  stallSink: 0.65,
};

export function spawn(
  lat: number,
  lon: number,
  alt: number,
  heading: number,
  speed: number,
  boost = false,
  perf: Performance = DEFAULT_PERFORMANCE,
): Flight {
  return {
    lat: clamp(lat, -89.9, 89.9),
    lon: ((lon + 540) % 360) - 180,
    alt: clamp(Number.isFinite(alt) ? alt : 1000, 20, MAX_START_ALT_M),
    heading: wrap(heading),
    pitch: 0,
    roll: 0,
    speed: clamp(speed, perf.stallSpeed, boost ? perf.boostMax : perf.spawnMax),
    boost,
    throttle: 0.65,
    vs: 0,
    crashed: false,
    stall: false,
  };
}
/** Fixed-wing touchdown limits: anything gentler settles on the gear. */
export const PLANE_LANDING = {
  maxSinkMs: 5, // ~1000 ft/min
  maxBankDeg: 20,
  minPitchDeg: -10,
  maxPitchDeg: 25,
  maxSpeedStallRatio: 2.2,
};

export function isSafePlaneTouchdown(
  f: Pick<Flight, "vs" | "roll" | "pitch" | "speed">,
  perf: Performance,
): boolean {
  return (
    f.vs >= -PLANE_LANDING.maxSinkMs &&
    Math.abs(f.roll) <= PLANE_LANDING.maxBankDeg &&
    f.pitch >= PLANE_LANDING.minPitchDeg &&
    f.pitch <= PLANE_LANDING.maxPitchDeg &&
    f.speed <= perf.stallSpeed * PLANE_LANDING.maxSpeedStallRatio
  );
}

const moveAlong = (lat0: number, lon0: number, heading: number, distance: number) => {
  const rad = Math.PI / 180;
  const lat = clamp(lat0 + (distance * Math.cos(heading * rad)) / 111320, -89.9, 89.9);
  const lon =
    ((lon0 +
      (distance * Math.sin(heading * rad)) /
        (111320 * Math.max(0.002, Math.cos(lat * rad))) +
      540) %
      360) -
    180;
  return { lat, lon };
};

/** Rolling on the wheels: throttle, rolling friction, brakes, nose-wheel
 * steering, and rotation/lift-off once above flying speed. */
function groundRoll(
  f: Flight,
  c: Controls,
  dt: number,
  ground: number,
  perf: Performance,
): Flight {
  const gear = perf.gear ?? 3;
  const throttle = clamp(f.throttle + c.throttle * dt * 0.25, 0, 1);
  const brake = clamp(c.brake ?? 0, 0, 1);
  const thrust = throttle * (f.boost ? perf.boostThrust : perf.thrust);
  const friction = f.speed > 0.05 ? 0.35 + brake * 4.5 : 0;
  const accel = thrust - friction - (f.boost ? perf.boostDrag : perf.drag) * f.speed * f.speed;
  let speed = Math.max(0, f.speed + accel * dt);
  if (thrust < friction && speed < 0.3 && brake > 0) speed = 0;
  const steer =
    clamp(c.yaw + c.roll * 0.6, -1, 1) * 25 * clamp(speed / 5, 0, 1) * (1 - clamp(speed / 80, 0, 0.7));
  const heading = wrap(f.heading + steer * dt);
  const canRotate = speed > perf.stallSpeed * 0.85;
  const pull = clamp(c.pitch, -1, 1);
  let pitch = f.pitch;
  if (canRotate && pull > 0.05) pitch = Math.min(15, pitch + pull * perf.pitchRate * 0.6 * dt);
  else pitch = Math.max(0, pitch - 8 * dt);
  pitch = Math.max(0, pitch);
  const roll = f.roll - clamp(f.roll, -30 * dt, 30 * dt);
  const pos = moveAlong(f.lat, f.lon, heading, speed * dt);
  const liftOff = speed >= perf.stallSpeed * 1.05 && pitch > 3;
  return {
    ...f,
    ...pos,
    alt: ground + gear + (liftOff ? 0.05 : 0),
    heading,
    pitch,
    roll,
    speed,
    throttle,
    vs: liftOff ? speed * Math.sin((pitch * Math.PI) / 180) : 0,
    stall: false,
    crashed: false,
    onGround: !liftOff,
  };
}

export function step(
  f: Flight,
  c: Controls,
  dt: number,
  ground: number,
  perf: Performance = DEFAULT_PERFORMANCE,
): Flight {
  if (f.crashed) return f;
  dt = clamp(dt, 0, 0.05);
  if (f.onGround) return groundRoll(f, c, dt, ground, perf);
  const throttle = clamp(f.throttle + c.throttle * dt * 0.25, 0, 1);
  const rad = Math.PI / 180;
  // Attitude is integrated as a quaternion (no Euler clamps, no gimbal lock),
  // so rolls, loops and inverted flight are unrestricted. heading/pitch/roll
  // are re-derived from it every step for the rest of the sim and the UI.
  const handsOff =
    Math.abs(c.roll) < 0.08 &&
    Math.abs(c.pitch) < 0.08 &&
    Math.abs(c.yaw) < 0.08;
  const upright = Math.abs(f.roll) < 60 && Math.abs(f.pitch) < 60;
  // Gentle stabilization only hands-off and only near upright; held inputs
  // (and hands-off inverted flight) are never fought.
  const levelRoll = handsOff && upright ? -clamp(f.roll * 0.14, -8, 8) : 0;
  const levelPitch = handsOff && upright ? -f.pitch * 0.045 : 0;
  const p = clamp(c.roll, -1, 1) * perf.rollRate + levelRoll;
  const q = clamp(c.pitch, -1, 1) * perf.pitchRate + levelPitch;
  const r = clamp(c.yaw, -1, 1) * perf.yawRate;
  let att = eulerToQuat(f.heading, f.pitch, f.roll);
  att = quatMul(att, quatFromBodyRates(p * rad * dt, q * rad * dt, r * rad * dt));
  // A simplified coordinated turn about world vertical, bounded through
  // knife-edge and inverted attitudes.
  const bank0 = f.roll * rad;
  const bankTurnRate =
    ((9.81 * Math.sin(bank0)) /
      (Math.max(Math.abs(Math.cos(bank0)), 0.25) * Math.max(f.speed, 30)) /
      rad) *
    Math.max(0, Math.cos(f.pitch * rad));
  att = quatMul(quatAboutDown(bankTurnRate * rad * dt), att);
  const e = quatToEuler(quatNormalize(att));
  const pitch = e.pitch;
  const roll = e.roll;
  const stall = f.speed < perf.stallSpeed;
  const speed = clamp(
    f.speed +
      (throttle * (f.boost ? perf.boostThrust : perf.thrust) -
        1.5 -
        (f.boost ? perf.boostDrag : perf.drag) * f.speed * f.speed -
        9.81 * Math.sin(pitch * rad)) *
        dt,
    perf.minSpeed,
    f.boost ? perf.boostMax : Math.max(perf.cruiseMax, f.speed),
  );
  // Thin air: above ~30 km the wings stop working and the aircraft falls
  // ballistically (sink builds at g), recovering as the air thickens again.
  const lift = liftFactor(f.alt, speed, perf.stallSpeed);
  const prevSink = f.sink ?? 0;
  const sink = clamp(prevSink + (9.81 * (1 - lift) - prevSink * lift * 1.2) * dt, 0, 2500);
  const vs =
    speed * Math.sin(pitch * rad) -
    (stall ? (perf.stallSpeed - speed) * perf.stallSink : 0) -
    sink;
  const heading = e.heading;
  const distance = speed * Math.cos(pitch * rad) * dt;
  const lat = clamp(
    f.lat + (distance * Math.cos(heading * rad)) / 111320,
    -89.9,
    89.9,
  );
  const lon =
    ((f.lon +
      (distance * Math.sin(heading * rad)) /
        (111320 * Math.max(0.002, Math.cos(lat * rad))) +
      540) %
      360) -
    180;
  const alt = f.alt + vs * dt;
  const gear = perf.gear ?? 3;
  const next: Flight = {
    ...f,
    lat,
    lon,
    alt: Math.max(ground + gear, alt),
    heading,
    pitch,
    roll,
    speed,
    throttle,
    vs,
    stall,
    crashed: false,
    onGround: false,
    sink: sink > 0.01 ? sink : undefined,
  };
  if (alt > ground + gear) return next;
  // Ground contact: a gentle touchdown settles on the gear and keeps rolling;
  // only a hard or badly aligned impact ends the flight.
  if (!isSafePlaneTouchdown(next, perf)) return { ...next, crashed: true };
  return {
    ...next,
    alt: ground + gear,
    vs: 0,
    pitch: clamp(pitch, 0, 15),
    stall: false,
    onGround: true,
  };
}

/** Right-handed aircraft body rates: roll right, pitch up, yaw right (deg/s).
 * Heading is clockwise from north; elevation is positive above the horizon.
 * Limits in step keep the Euler representation away from vertical singularity.
 */
export function bodyRatesToEuler(
  pitch: number,
  roll: number,
  p: number,
  q: number,
  r: number,
) {
  const rad = Math.PI / 180,
    phi = roll * rad,
    theta = pitch * rad;
  const sin = Math.sin(phi),
    cos = Math.cos(phi);
  const transverse = q * sin + r * cos;
  return {
    roll: p + transverse * Math.tan(theta),
    pitch: q * cos - r * sin,
    heading: transverse / Math.max(0.1, Math.cos(theta)),
  };
}

// ---- Attitude quaternions (aerospace ZYX: heading about down, pitch about
// right wing, roll about the nose; NED-style local frame). [w, x, y, z]
export type Quat = [number, number, number, number];

export function eulerToQuat(headingDeg: number, pitchDeg: number, rollDeg: number): Quat {
  const r = Math.PI / 360;
  const cy = Math.cos(headingDeg * r), sy = Math.sin(headingDeg * r);
  const cp = Math.cos(pitchDeg * r), sp = Math.sin(pitchDeg * r);
  const cr = Math.cos(rollDeg * r), sr = Math.sin(rollDeg * r);
  return [
    cr * cp * cy + sr * sp * sy,
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
  ];
}

export function quatToEuler([w, x, y, z]: Quat) {
  const d = 180 / Math.PI;
  const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) * d;
  const pitch = Math.asin(clamp(2 * (w * y - z * x), -1, 1)) * d;
  const heading = wrap(Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * d);
  return { heading, pitch, roll };
}

export function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

export function quatNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Rotation by body-axis angles (radians) roll p, pitch q, yaw r. */
export function quatFromBodyRates(p: number, q: number, r: number): Quat {
  const a = Math.hypot(p, q, r);
  if (a < 1e-12) return [1, 0, 0, 0];
  const s = Math.sin(a / 2) / a;
  return [Math.cos(a / 2), p * s, q * s, r * s];
}

/** Rotation about the local down axis (positive = heading clockwise). */
export function quatAboutDown(angle: number): Quat {
  return [Math.cos(angle / 2), 0, 0, Math.sin(angle / 2)];
}
