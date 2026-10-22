export type Flight = {
  lat: number;
  lon: number;
  alt: number;
  heading: number;
  pitch: number;
  roll: number;
  speed: number;
  throttle: number;
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
): Flight {
  return {
    lat: clamp(lat, -89.9, 89.9),
    lon: ((lon + 540) % 360) - 180,
    alt: clamp(alt, 20, 15000),
    heading: wrap(heading),
    pitch: 0,
    roll: 0,
    speed: clamp(speed, 55, 250),
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
  const pitch = clamp(f.pitch + (c.pitch * 18 - f.pitch * 0.045) * dt, -65, 65);
  const roll = clamp(f.roll + (c.roll * 45 - f.roll * 0.12) * dt, -80, 80);
  const rad = Math.PI / 180;
  const stall = f.speed < 55;
  const speed = clamp(
    f.speed +
      (throttle * 8 -
        1.5 -
        0.00018 * f.speed * f.speed -
        9.81 * Math.sin(pitch * rad)) *
        dt,
    15,
    290,
  );
  const vs = speed * Math.sin(pitch * rad) - (stall ? (55 - speed) * 0.65 : 0);
  const heading = wrap(
    f.heading +
      ((9.81 * Math.tan(roll * rad)) / Math.max(speed, 30) / rad + c.yaw * 10) *
        dt,
  );
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
