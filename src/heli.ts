import { clamp, wrap, type Controls, type Flight } from "./physics";

/** Helicopter flight model, separate from the fixed-wing physics.
 *
 * - Collective (Flight.throttle, 0..1) sets main-rotor thrust. HOVER_COLLECTIVE
 *   balances the weight out of ground effect, so leaving the collective there
 *   holds altitude.
 * - Cyclic (pitch/roll input) tilts the rotor disc; the tilted thrust vector
 *   accelerates the helicopter in that direction. An attitude-hold assist
 *   returns the disc level when the cyclic is released, and at low speed a
 *   gentle auto-flare brings the helicopter to a stop so a beginner can hold
 *   a hover.
 * - Pedals (yaw input) drive the tail rotor: yaw rate, smoothed.
 * - Ground effect within about one rotor diameter, and effective
 *   translational lift (ETL) between ~15 and 40 kt.
 * - No stall. Safe touchdowns settle on the skids; lift off with collective.
 */
export const HOVER_COLLECTIVE = 0.5;
export type RotorcraftParams = typeof HELI & {
  /** Fictional craft that keeps lift in space (saucer). */
  spaceCapable?: boolean;
  /** Bidirectional hover thrust scale (1 = hover, 0 = strong down, 1.0 collective = this many g up). */
  thrustGain?: number;
  /** Horizontal / nose-pointing acceleration at full tilt (m/s²). */
  cruiseAccel?: number;
  /** Max warp acceleration (m/s²) while closing on the target speed. */
  warpAccel?: number;
};
export const HELI = {
  gear: 1.7, // model origin above the skids (m)
  collectiveRate: 0.35, // collective travel per second while a key is held
  maxTiltDeg: 22,
  attitudeResponse: 3, // 1/s, cyclic attitude follow rate
  verticalDamping: 0.9, // 1/s
  dragLinear: 0.02,
  dragQuadratic: 0.0006,
  yawRateMax: 50, // deg/s at full pedal
  yawResponse: 2.5,
  rotorDiameter: 10.2,
  groundEffect: 0.15, // extra thrust fraction at the skids
  etl: 0.1, // extra thrust fraction in translational lift
  landing: { maxSinkMs: 3.5, maxTiltDeg: 15, maxSpeedMs: 12 },
};

const G = 9.81;
const rad = Math.PI / 180;
const smooth = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

export function groundEffectFactor(agl: number, P: RotorcraftParams = HELI): number {
  const h = Math.max(0, agl - P.gear);
  return 1 + P.groundEffect * Math.max(0, 1 - h / P.rotorDiameter);
}

export function etlFactor(airspeed: number, P: RotorcraftParams = HELI): number {
  return 1 + P.etl * smooth((airspeed - 8) / 14);
}

/** Thrust as a multiple of weight for a collective setting. */
/** Rotor thrust fades in near-space (above 15 km) so a rotorcraft spawned at
 * extreme altitude falls back into the air instead of hovering in orbit.
 * Normal flight altitudes are untouched (arcade hover holds as before). */
export function thinAirFactor(altM: number): number {
  return altM <= 15000 ? 1 : Math.exp(-(altM - 15000) / 8500);
}

export function thrustRatio(collective: number): number {
  return Math.max(0, 1 + (collective - HOVER_COLLECTIVE) * 2);
}

/** Collective that cancels vertical acceleration at the current state. */
export function hoverTrimCollective(f: Flight, ground: number, P: RotorcraftParams = HELI): number {
  const speed = Math.hypot(f.vn ?? 0, f.ve ?? 0);
  const k =
    groundEffectFactor(f.alt - ground, P) *
    etlFactor(speed, P) *
    Math.cos(f.pitch * rad) *
    Math.cos(f.roll * rad);
  return clamp(HOVER_COLLECTIVE + (1 / Math.max(0.3, k) - 1) / 2, 0, 1);
}

export function spawnHeli(f: Flight, onGround = false): Flight {
  const v = onGround ? 0 : f.speed;
  return {
    ...f,
    pitch: 0,
    roll: 0,
    throttle: onGround ? 0.2 : HOVER_COLLECTIVE,
    speed: v,
    vn: v * Math.cos(f.heading * rad),
    ve: v * Math.sin(f.heading * rad),
    vs: 0,
    yawRate: 0,
    stall: false,
    onGround,
  };
}

export function isSafeHeliTouchdown(f: Flight, P: RotorcraftParams = HELI): boolean {
  const L = P.landing;
  return (
    f.vs >= -L.maxSinkMs &&
    Math.abs(f.pitch) <= L.maxTiltDeg &&
    Math.abs(f.roll) <= L.maxTiltDeg &&
    Math.hypot(f.vn ?? 0, f.ve ?? 0) <= L.maxSpeedMs
  );
}

export function stepHeli(
  f: Flight,
  c: Controls,
  dt: number,
  ground: number,
  P: RotorcraftParams = HELI,
): Flight {
  if (f.crashed) return f;
  dt = clamp(dt, 0, 0.05);
  const collective = clamp(f.throttle + c.throttle * dt * P.collectiveRate, 0, 1);
  let vn = f.vn ?? f.speed * Math.cos(f.heading * rad);
  let ve = f.ve ?? f.speed * Math.sin(f.heading * rad);
  const h = f.heading * rad;
  // Body-frame horizontal velocity (forward, right).
  const vFwd = vn * Math.cos(h) + ve * Math.sin(h);
  const vRight = -vn * Math.sin(h) + ve * Math.cos(h);
  const speed0 = Math.hypot(vn, ve);

  // Cyclic: attitude command. Positive pitch input raises the nose (same sign
  // as the fixed-wing keys: ↓ / S nose up, ↑ / W nose down = fly forward).
  const cp = clamp(c.pitch, -1, 1),
    cr = clamp(c.roll, -1, 1);
  const handsOff = Math.abs(cp) < 0.08 && Math.abs(cr) < 0.08;
  // Low-speed auto-flare assist: fades out above ~25 kt.
  const assist = handsOff ? 1 - smooth((speed0 - 8) / 6) : 0;
  const targetPitch =
    cp * P.maxTiltDeg + assist * clamp(vFwd * 1.4, -10, 10);
  const targetRoll =
    cr * P.maxTiltDeg - assist * clamp(vRight * 1.4, -10, 10);
  const k = 1 - Math.exp(-dt * P.attitudeResponse);
  let pitch = f.pitch + (targetPitch - f.pitch) * k;
  let roll = f.roll + (targetRoll - f.roll) * k;

  // Pedals / tail rotor.
  const yk = 1 - Math.exp(-dt * P.yawResponse);
  const onGround = Boolean(f.onGround);
  const pedalAuthority = onGround ? clamp(collective / HOVER_COLLECTIVE, 0, 1) : 1;
  let yawRate =
    (f.yawRate ?? 0) +
    (clamp(c.yaw, -1, 1) * P.yawRateMax * pedalAuthority - (f.yawRate ?? 0)) * yk;
  // Weathervane: in forward flight the tail aligns the nose with the track.
  if (!onGround && speed0 > 10) {
    const track = (Math.atan2(ve, vn) / rad + 360) % 360;
    const err = wrap(track - f.heading + 180) - 180;
    if (Math.abs(err) < 100)
      yawRate += clamp(err, -30, 30) * 0.6 * smooth((speed0 - 10) / 15) * yk;
  }
  const heading = wrap(f.heading + yawRate * dt);

  // Rotor thrust (as acceleration) along the tilted disc.
  const agl = f.alt - ground;
  const T =
    G * thrustRatio(collective) * groundEffectFactor(agl, P) * etlFactor(speed0, P) *
    (P.spaceCapable ? 1 : thinAirFactor(f.alt));
  const p = pitch * rad,
    r = roll * rad;
  const aFwd = -T * Math.sin(p) * Math.cos(r);
  const aRight = T * Math.sin(r);
  const aUp = T * Math.cos(p) * Math.cos(r) - G;
  const hh = heading * rad;
  const drag = P.dragLinear + P.dragQuadratic * speed0;
  vn += (aFwd * Math.cos(hh) - aRight * Math.sin(hh) - drag * vn) * dt;
  ve += (aFwd * Math.sin(hh) + aRight * Math.cos(hh) - drag * ve) * dt;
  let vs = f.vs + (aUp - P.verticalDamping * (P.spaceCapable ? 1 : thinAirFactor(f.alt)) * f.vs) * dt;

  if (onGround) {
    if (aUp > 0.05) {
      // Lift-off: thrust exceeds weight.
      vs = Math.max(vs, 0);
    } else {
      // Sitting on the skids: friction stops sliding, attitude settles level.
      const fr = Math.exp(-dt / 0.3);
      vn *= fr;
      ve *= fr;
      const lk = 1 - Math.exp(-dt * 4);
      pitch -= pitch * lk;
      roll -= roll * lk;
      return {
        ...f,
        alt: ground + P.gear,
        heading,
        pitch,
        roll,
        throttle: collective,
        vn,
        ve,
        vs: 0,
        speed: Math.hypot(vn, ve),
        yawRate,
        stall: false,
        crashed: false,
        onGround: true,
        ...move(f, vn, ve, dt),
      };
    }
  }

  const alt = f.alt + vs * dt;
  const next: Flight = {
    ...f,
    ...move(f, vn, ve, dt),
    alt: Math.max(ground + P.gear, alt),
    heading,
    pitch,
    roll,
    throttle: collective,
    vn,
    ve,
    vs,
    speed: Math.hypot(vn, ve),
    yawRate,
    stall: false,
    crashed: false,
    onGround: false,
  };
  if (alt > ground + P.gear) return next;
  if (!isSafeHeliTouchdown(next, P)) return { ...next, crashed: true };
  return { ...next, alt: ground + P.gear, vs: 0, onGround: true };
}

function move(f: Flight, vn: number, ve: number, dt: number) {
  const lat = clamp(f.lat + (vn * dt) / 111320, -89.9, 89.9);
  const lon =
    ((f.lon + (ve * dt) / (111320 * Math.max(0.002, Math.cos(lat * rad))) + 540) %
      360) -
    180;
  return { lat, lon };
}

/** Speed of sound at sea level (m/s). Used for saucer Mach / warp. */
export const MACH_MS = 340.29;
/** Warp 1 cruises at Mach 1.2 (~921 mph); warp 2 at Mach 4 (~3,068 mph). */
export const WARP_MACH = [0, 1.2, 4] as const;
export function warpTargetMs(warp = 0): number {
  const m = WARP_MACH[warp as 0 | 1 | 2] ?? 0;
  return m * MACH_MS;
}
export function cycleWarp(warp = 0, toMax = false): 0 | 1 | 2 {
  if (toMax) return warp === 2 ? 0 : 2;
  return (warp >= 2 ? 0 : ((warp || 0) + 1)) as 0 | 1 | 2;
}
export function flightSpeed3d(f: Flight): number {
  return Math.hypot(f.vn ?? f.speed ?? 0, f.ve ?? 0, f.vs ?? 0);
}
export function machNumber(f: Flight): number {
  return flightSpeed3d(f) / MACH_MS;
}

/** MADD Saucer: UFO hover + point-the-nose flight, not a helicopter disc.
 * Strong bidirectional vertical thrust, steep visible tilt, and warp. */
export const SAUCER: RotorcraftParams = {
  spaceCapable: true,
  ...HELI,
  gear: 1.4,
  collectiveRate: 1.8,
  maxTiltDeg: 65,
  attitudeResponse: 9,
  verticalDamping: 2.2,
  dragLinear: 0.04,
  dragQuadratic: 0.00004,
  yawRateMax: 140,
  yawResponse: 6,
  rotorDiameter: 10,
  groundEffect: 0.04,
  etl: 0,
  thrustGain: 6,
  cruiseAccel: 32,
  warpAccel: 110,
  landing: { maxSinkMs: 6, maxTiltDeg: 30, maxSpeedMs: 25 },
};

/** Arcade flying-saucer step: hover jets are world-up and bidirectional, the
 * craft accelerates along its nose (so a pitched-up saucer climbs steeply),
 * and warp ramps 3-D speed to Mach 1.2 / Mach 4 at any altitude. Hands-off
 * holds a hover. No stall. */
export function stepSaucer(
  f: Flight,
  c: Controls,
  dt: number,
  ground: number,
  P: RotorcraftParams = SAUCER,
): Flight {
  if (f.crashed) return f;
  dt = clamp(dt, 0, 0.05);
  const warp = (f.warp ?? 0) as 0 | 1 | 2;
  let collective = clamp(f.throttle + c.throttle * dt * P.collectiveRate, 0, 1);
  let vn = f.vn ?? f.speed * Math.cos(f.heading * rad);
  let ve = f.ve ?? f.speed * Math.sin(f.heading * rad);
  let vs = f.vs;
  const cp = clamp(c.pitch, -1, 1),
    cr = clamp(c.roll, -1, 1);
  const collectiveInput = Math.abs(c.throttle) >= 0.08;
  const handsOff =
    Math.abs(cp) < 0.08 && Math.abs(cr) < 0.08 && !collectiveInput && warp === 0;

  const targetPitch = cp * P.maxTiltDeg;
  const targetRoll = cr * P.maxTiltDeg;
  const k = 1 - Math.exp(-dt * P.attitudeResponse);
  let pitch = f.pitch + (targetPitch - f.pitch) * k;
  let roll = f.roll + (targetRoll - f.roll) * k;

  const yk = 1 - Math.exp(-dt * P.yawResponse);
  const onGround = Boolean(f.onGround);
  let yawRate =
    (f.yawRate ?? 0) +
    (clamp(c.yaw, -1, 1) * P.yawRateMax - (f.yawRate ?? 0)) * yk;
  const heading = wrap(f.heading + yawRate * dt);
  const p = pitch * rad,
    r = roll * rad,
    h = heading * rad;

  // Bidirectional hover jets along world-up. 0.5 collective = hover (0 g net).
  const gain = P.thrustGain ?? 6;
  let hoverA = G * (collective - HOVER_COLLECTIVE) * gain;
  if (!collectiveInput) {
    // Hands-off collective: ease back to hover and kill vertical speed.
    collective += (HOVER_COLLECTIVE - collective) * (1 - Math.exp(-dt * 4));
    hoverA = -vs * (P.verticalDamping * (handsOff ? 3 : 1.6));
  }

  const tilt = Math.min(1, Math.hypot(pitch, roll) / Math.max(1, P.maxTiltDeg));
  const cruise = (P.cruiseAccel ?? 32) * tilt;
  const fwdN = Math.cos(p) * Math.cos(h);
  const fwdE = Math.cos(p) * Math.sin(h);
  const fwdU = Math.sin(p);
  const rightN = -Math.sin(h);
  const rightE = Math.cos(h);
  const strafe = (P.cruiseAccel ?? 32) * clamp(roll / P.maxTiltDeg, -1, 1);

  const spd3 = Math.hypot(vn, ve, vs);
  const target = warpTargetMs(warp);
  let warpA = 0;
  if (target > 0) {
    const slack = target - spd3;
    const cap = (P.warpAccel ?? 110) * (warp >= 2 ? 2 : 1);
    warpA = slack >= 0 ? Math.min(cap, Math.max(12, slack * 1.4)) : slack * 0.8;
  }

  const aN = (cruise + warpA) * fwdN + strafe * rightN;
  const aE = (cruise + warpA) * fwdE + strafe * rightE;
  const aU = hoverA + (cruise + warpA) * fwdU;

  const drag = warp > 0 ? 0.015 : handsOff ? 2.8 : P.dragLinear + P.dragQuadratic * spd3;
  vn += (aN - drag * vn) * dt;
  ve += (aE - drag * ve) * dt;
  vs += (aU - (handsOff || warp ? 0 : P.dragLinear * vs)) * dt;

  // Gentle flare so a controlled descent settles instead of cratering.
  const agl = f.alt - ground - P.gear;
  if (warp === 0 && vs < 0 && agl < 25) {
    const safe = -P.landing.maxSinkMs * 0.4;
    const flare = 1 - Math.min(1, Math.max(0, agl) / 25);
    vs += (safe - vs) * flare * (1 - Math.exp(-dt * 14));
    if (agl < 4) vs = Math.max(vs, -P.landing.maxSinkMs * 0.7);
  }

  if (onGround) {
    if (aU > 0.2) {
      vs = Math.max(vs, 0);
    } else {
      const fr = Math.exp(-dt / 0.25);
      vn *= fr;
      ve *= fr;
      const lk = 1 - Math.exp(-dt * 5);
      pitch -= pitch * lk;
      roll -= roll * lk;
      return {
        ...f,
        alt: ground + P.gear,
        heading,
        pitch,
        roll,
        throttle: collective,
        vn,
        ve,
        vs: 0,
        speed: Math.hypot(vn, ve),
        yawRate,
        stall: false,
        crashed: false,
        onGround: true,
        warp,
        ...move(f, vn, ve, dt),
      };
    }
  }

  const alt = f.alt + vs * dt;
  const next: Flight = {
    ...f,
    ...move(f, vn, ve, dt),
    alt: Math.max(ground + P.gear, alt),
    heading,
    pitch,
    roll,
    throttle: collective,
    vn,
    ve,
    vs,
    speed: Math.hypot(vn, ve, vs),
    yawRate,
    stall: false,
    crashed: false,
    onGround: false,
    warp,
    boost: warp > 0,
  };
  if (alt > ground + P.gear) return next;
  const touch = { ...next, speed: Math.hypot(vn, ve) };
  if (!isSafeHeliTouchdown(touch, P)) return { ...next, crashed: true };
  return { ...touch, alt: ground + P.gear, vs: 0, onGround: true };
}
