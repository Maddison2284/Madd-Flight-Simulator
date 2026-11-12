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
};
export type Controls = {
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
  /** Wheel brakes on the ground, 0..1. */
  brake?: number;
};
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
    alt: clamp(alt, 20, 15000),
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
  // Pilot inputs are rotations about the aircraft's own axes. Convert body
  // rates into heading/elevation/bank rates before moving in world space.
  const rates = bodyRatesToEuler(
    f.pitch,
    f.roll,
    clamp(c.roll, -1, 1) * perf.rollRate,
    clamp(c.pitch, -1, 1) * perf.pitchRate,
    clamp(c.yaw, -1, 1) * perf.yawRate,
  );
  const pitch = clamp(f.pitch + (rates.pitch - f.pitch * 0.045) * dt, -65, 65);
  // Gentle stabilization acts only after all attitude controls are released.
  // Holding roll still allows unrestricted 360-degree maneuvers.
  const handsOff =
    Math.abs(c.roll) < 0.08 &&
    Math.abs(c.pitch) < 0.08 &&
    Math.abs(c.yaw) < 0.08;
  const leveling = handsOff ? -clamp(f.roll * 0.14, -8, 8) : 0;
  const roll = wrap(f.roll + (rates.roll + leveling) * dt + 180) - 180;
  const bank = roll * rad;
  // A simplified coordinated turn, bounded through knife-edge and inverted
  // attitudes. tan(bank) is singular at 90 degrees and flips sign beyond it.
  const bankTurnRate =
    (9.81 * Math.sin(bank)) /
    (Math.max(Math.abs(Math.cos(bank)), 0.25) * Math.max(f.speed, 30)) /
    rad;
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
  const vs =
    speed * Math.sin(pitch * rad) -
    (stall ? (perf.stallSpeed - speed) * perf.stallSink : 0);
  const heading = wrap(f.heading + (bankTurnRate + rates.heading) * dt);
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
