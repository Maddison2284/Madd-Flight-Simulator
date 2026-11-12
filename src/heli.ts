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
/** Speed warp levels: 1 = Mach 1.2, 2 = Mach 4, 3 = Mach 10. */
export const WARP_MACH = [0, 1.2, 4, 10] as const;
export type WarpLevel = 0 | 1 | 2 | 3;
export function warpTargetMs(warp = 0): number {
  return (WARP_MACH[warp as WarpLevel] ?? 0) * MACH_MS;
}
/** B: 0 → 1 → 2 → 3 → off. Shift+B: straight to Mach 10 (or off). */
export function cycleWarp(warp = 0, toMax = false): WarpLevel {
  if (toMax) return warp === 3 ? 0 : 3;
  return (warp >= 3 ? 0 : (warp || 0) + 1) as WarpLevel;
}

/** Minimum height above the last known ground while speed-warping (m). */
export const WARP_FLOOR_M = 60;

/** Saucer teleport jump distances: B = 1 mile, Shift+B = 10 miles. */
export const JUMP_M = 1609.344;
export const BIG_JUMP_M = JUMP_M * 10;
/** Minimum time between jumps (ms); holding B repeats at this rate. */
export const JUMP_COOLDOWN_MS = 300;
/** Clearance kept above the ground at the landing point (m). */
export const JUMP_GROUND_MARGIN_M = 30;
const EARTH_R = 6371008.8;

/** Instant jump of `distM` metres along the nose (heading AND pitch) in one
 * step. Velocity, attitude, throttle are unchanged. The result is clamped to
 * `groundAt(lat, lon) + margin` (pass the best known terrain height). */
export function teleportJump(
  f: Flight,
  distM: number,
  groundAt: (lat: number, lon: number) => number | undefined = () => undefined,
  margin = JUMP_GROUND_MARGIN_M,
  pitchDeg: number = f.pitch,
): Flight {
  const h = (f.heading * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const horiz = distM * Math.cos(p);
  const up = distM * Math.sin(p);
  // Great-circle destination at the craft's own radius.
  const R = EARTH_R + Math.max(0, f.alt);
  const d = horiz / R;
  const la1 = (f.lat * Math.PI) / 180;
  const lo1 = (f.lon * Math.PI) / 180;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(h));
  const lo2 =
    lo1 + Math.atan2(Math.sin(h) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  const lat = (la2 * 180) / Math.PI;
  const lon = ((((lo2 * 180) / Math.PI + 540) % 360) + 360) % 360 - 180;
  let alt = f.alt + up;
  const g = groundAt(lat, lon);
  const floor = (Number.isFinite(g) ? (g as number) : -Infinity) + margin;
  let onGround = f.onGround;
  if (alt < floor) alt = floor;
  if (alt > floor + 1) onGround = false;
  return { ...f, lat, lon, alt, onGround, crashed: false };
}

/** Great-circle surface distance plus altitude change (m), for tests. */
export function jumpDistance(a: Pick<Flight, "lat" | "lon" | "alt">, b: Pick<Flight, "lat" | "lon" | "alt">): number {
  const r = Math.PI / 180;
  const la1 = a.lat * r, la2 = b.lat * r;
  const dla = la2 - la1, dlo = (b.lon - a.lon) * r;
  const s = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2;
  const surf = 2 * (EARTH_R + Math.max(0, a.alt)) * Math.asin(Math.min(1, Math.sqrt(s)));
  return Math.hypot(surf, b.alt - a.alt);
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
  landing: { maxSinkMs: 6, maxTiltDeg: 30, maxSpeedMs: 25 },
};

/** Saucer top forward speed at full throttle (m/s, ~335 mph). */
export const SAUCER_FWD_MS = 150;
/** Saucer vertical speed reached almost instantly (~0.25 s) on W/S, R/F,
 * UP/DOWN buttons or the stick (m/s, ~7,900 ft/min). */
export const SAUCER_VERT_MS = 40;
/** Holding up/down keeps building vertical speed to this cap (m/s,
 * ~59,000 ft/min) without warp; scaled by saucerVertScale(warp). */
export const SAUCER_VERT_MAX_MS = 300;
/** Build-up rate while up/down is held (m/s²). */
export const SAUCER_VERT_ACCEL = 260;
/** Vertical authority multiplier per warp level (off, 1, 2, 3). */
export function saucerVertScale(warp = 0): number {
  return [1, 2, 4, 8][warp as WarpLevel] ?? 1;
}
/** Cosmetic nose tilt at full up/down command (deg). */
export const SAUCER_TILT_DEG = 12;

/** Arcade flying-saucer step. Direct controls:
 * - vertical (W / R / Space / stick up = UP, S / F / stick down = DOWN)
 *   drives vertical speed straight up/down; hands-off holds altitude;
 * - forward speed comes from the throttle setting (+/−, touch slider) plus
 *   a momentary ↑/↓ push; the craft flies where it is heading;
 * - A/D (stick left/right) bank and turn, Q/E yaw.
 * Pitch is only a small cosmetic tilt. No stall, works in space. */
export function stepSaucer(
  f: Flight,
  c: Controls,
  dt: number,
  ground: number,
  P: RotorcraftParams = SAUCER,
): Flight {
  if (f.crashed) return f;
  dt = clamp(dt, 0, 0.05);
  const throttle = clamp(f.throttle + c.throttle * dt * 0.6, 0, 1);
  let vn = f.vn ?? f.speed * Math.cos(f.heading * rad);
  let ve = f.ve ?? f.speed * Math.sin(f.heading * rad);
  let vs = f.vs;
  const vc = clamp(c.vertical ?? 0, -1, 1);
  const cr = clamp(c.roll, -1, 1);
  const fwdCmd = clamp(throttle + clamp(c.forward ?? 0, -1, 1), -0.4, 1);
  const warp = (f.warp ?? 0) as WarpLevel;

  // Bank + coordinated turn from roll; Q/E add flat yaw.
  const yk = 1 - Math.exp(-dt * P.yawResponse);
  const turnRate = cr * 55 + clamp(c.yaw, -1, 1) * P.yawRateMax;
  const yawRate = (f.yawRate ?? 0) + (turnRate - (f.yawRate ?? 0)) * yk;
  const heading = wrap(f.heading + yawRate * dt);
  const ak = 1 - Math.exp(-dt * P.attitudeResponse);
  const targetPitch = Math.abs(vc) >= 0.08 ? vc * SAUCER_TILT_DEG : clamp(vs / SAUCER_VERT_MS, -1, 1) * SAUCER_TILT_DEG * 0.5;
  let pitch = f.pitch + (targetPitch - f.pitch) * ak;
  let roll = f.roll + (cr * 35 - f.roll) * ak;
  const h = heading * rad;

  // Horizontal: velocity eases toward heading × commanded forward speed.
  // Speed warp: cruise along the heading at Mach 1.2 / 4 / 10, with an
  // acceleration cap so the jump to Mach 10 takes a few seconds.
  const want = warp > 0 ? warpTargetMs(warp) : fwdCmd * SAUCER_FWD_MS;
  const hk = 1 - Math.exp(-dt * (warp > 0 ? 1.1 : 1.4));
  let dn = (want * Math.cos(h) - vn) * hk;
  let de = (want * Math.sin(h) - ve) * hk;
  if (warp > 0) {
    const maxDv = (120 + 260 * warp) * dt;
    const m = Math.hypot(dn, de);
    if (m > maxDv) {
      dn *= maxDv / m;
      de *= maxDv / m;
    }
  }
  vn += dn;
  ve += de;
  // Vertical: strong and immediate. Snap to SAUCER_VERT_MS in ~0.25 s, then
  // keep accelerating while held (faster at higher warp). Hands-off stops
  // quickly and holds altitude.
  const vmul = saucerVertScale(warp);
  if (Math.abs(vc) >= 0.08) {
    const dir = Math.sign(vc);
    const mag = Math.abs(vc);
    const snap = SAUCER_VERT_MS * mag * vmul;
    const cap = SAUCER_VERT_MAX_MS * mag * vmul;
    let v = vs * dir;
    if (v < snap) v += (snap - v) * (1 - Math.exp(-dt * 10));
    if (v > cap) v += (cap - v) * (1 - Math.exp(-dt * 3));
    else v = Math.min(cap, v + SAUCER_VERT_ACCEL * vmul * mag * dt);
    vs = v * dir;
  } else {
    vs -= vs * (1 - Math.exp(-dt * 6));
  }
  // Descending fast near the ground: limit the sink rate by height so a
  // held DOWN brakes into a gentle arrival instead of a crash.
  {
    const aglNow = f.alt - ground - P.gear - (warp > 0 ? WARP_FLOOR_M : 0);
    const maxSink = 8 + Math.max(0, aglNow) * 1.5;
    if (vs < -maxSink) vs = -maxSink;
  }

  // Gentle flare so a controlled descent settles instead of cratering.
  const agl = f.alt - ground - P.gear;
  if (vs < 0 && agl < 25) {
    const safe = -P.landing.maxSinkMs * 0.4;
    const flare = 1 - Math.min(1, Math.max(0, agl) / 25);
    vs += (safe - vs) * flare * (1 - Math.exp(-dt * 14));
    if (agl < 4) vs = Math.max(vs, -P.landing.maxSinkMs * 0.7);
    // Auto-slow for touchdown so a descending saucer settles, not skids/crashes.
    const hs = Math.hypot(vn, ve);
    const cap = 12 + Math.max(0, agl) * 2;
    if (hs > cap) {
      const k2 = cap / hs + (1 - cap / hs) * Math.exp(-dt * 6);
      vn *= k2;
      ve *= k2;
    }
  }

  if (f.onGround && vc <= 0.08) {
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
      throttle,
      vn,
      ve,
      vs: 0,
      speed: Math.hypot(vn, ve),
      yawRate,
      stall: false,
      crashed: false,
      onGround: true,
      warp: 0,
      boost: false,
      ...move(f, vn, ve, dt),
    };
  }
  if (f.onGround) vs = Math.max(vs, 0.5);

  const alt = f.alt + vs * dt;
  const next: Flight = {
    ...f,
    ...move(f, vn, ve, dt),
    alt: Math.max(ground + P.gear, alt),
    heading,
    pitch,
    roll,
    throttle,
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
  if (warp > 0) {
    // Warp shield: at Mach speeds terrain data lags, so skim instead of crash.
    const floor = ground + P.gear + WARP_FLOOR_M;
    return alt >= floor ? next : { ...next, alt: floor, vs: Math.max(0, vs) };
  }
  if (alt > ground + P.gear) return next;
  const touch = { ...next, speed: Math.hypot(vn, ve) };
  if (!isSafeHeliTouchdown(touch, P)) return { ...next, crashed: true };
  return { ...touch, alt: ground + P.gear, vs: 0, onGround: true };
}

/** Saucer start: hover, with the forward throttle set from the planner speed. */
export function spawnSaucer(f: Flight, onGround = false): Flight {
  const base = spawnHeli(f, onGround);
  return { ...base, throttle: onGround ? 0 : clamp(f.speed / SAUCER_FWD_MS, 0, 1) };
}

/** Warp-jump elevation (deg): the saucer's actual 3-D direction of travel
 * (velocity incl. vertical speed), so climbing jumps forward-and-up and
 * descending jumps forward-and-down; when nearly still, its visual tilt. */
export function saucerJumpPitch(f: Flight): number {
  const hs = Math.hypot(f.vn ?? 0, f.ve ?? 0);
  const vs = f.vs ?? 0;
  if (Math.abs(vs) < 1 && hs < 3) return clamp(f.pitch, -80, 80);
  // Keep some forward component even in a pure vertical climb.
  const deg = (Math.atan2(vs, Math.max(hs, 15)) * 180) / Math.PI;
  return clamp(deg, -80, 80);
}
