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
};
export type Controls = {
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
};
export const clamp = (v: number, a: number, b: number) =>
  Math.max(a, Math.min(b, v));
export const wrap = (n: number) => ((n % 360) + 360) % 360;
export function spawn(
  lat: number,
  lon: number,
  alt: number,
  heading: number,
  speed: number,
  boost = false,
): Flight {
  return {
    lat: clamp(lat, -89.9, 89.9),
    lon: ((lon + 540) % 360) - 180,
    alt: clamp(alt, 20, 15000),
    heading: wrap(heading),
    pitch: 0,
    roll: 0,
    speed: clamp(speed, 55, boost ? 1100 : 250),
    boost,
    throttle: 0.65,
    vs: 0,
    crashed: false,
    stall: false,
  };
}
export function step(
  f: Flight,
  c: Controls,
  dt: number,
  ground: number,
): Flight {
  if (f.crashed) return f;
  dt = clamp(dt, 0, 0.05);
  const throttle = clamp(f.throttle + c.throttle * dt * 0.25, 0, 1);
  const rad = Math.PI / 180;
  // Pilot inputs are rotations about the aircraft's own axes. Convert body
  // rates into heading/elevation/bank rates before moving in world space.
  const rates = bodyRatesToEuler(
    f.pitch,
    f.roll,
    clamp(c.roll, -1, 1) * 45,
    clamp(c.pitch, -1, 1) * 18,
    clamp(c.yaw, -1, 1) * 10,
  );
  const pitch = clamp(f.pitch + (rates.pitch - f.pitch * 0.045) * dt, -65, 65);
  // Bank is unrestricted. Wrap only its representation; releasing the stick
  // holds bank instead of automatically pulling an inverted aircraft upright.
  const roll = wrap(f.roll + rates.roll * dt + 180) - 180;
  const bank = roll * rad;
  // A simplified coordinated turn, bounded through knife-edge and inverted
  // attitudes. tan(bank) is singular at 90 degrees and flips sign beyond it.
  const bankTurnRate =
    (9.81 * Math.sin(bank)) /
    (Math.max(Math.abs(Math.cos(bank)), 0.25) * Math.max(f.speed, 30)) /
    rad;
  const stall = f.speed < 55;
  const speed = clamp(
    f.speed +
      (throttle * (f.boost ? 120 : 8) -
        1.5 -
        (f.boost ? 0.00004 : 0.00018) * f.speed * f.speed -
        9.81 * Math.sin(pitch * rad)) *
        dt,
    15,
    f.boost ? 1100 : Math.max(290, f.speed),
  );
  const vs = speed * Math.sin(pitch * rad) - (stall ? (55 - speed) * 0.65 : 0);
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
  return {
    ...f,
    lat,
    lon,
    alt: Math.max(ground + 3, alt),
    heading,
    pitch,
    roll,
    speed,
    throttle,
    vs,
    stall,
    crashed: alt <= ground + 3,
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
