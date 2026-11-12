import type { Aircraft } from "./aircraft";
import {
  autopilotControls,
  navTo,
  type AutopilotState,
  type NavInfo,
} from "./autopilot";
import type { Destination } from "./destinations";
import { HELI, hoverTrimCollective, spawnHeli, stepHeli, type RotorcraftParams } from "./heli";
import { clamp, spawn, step, type Controls, type Flight } from "./physics";

/** Rotorcraft params for hover-capable aircraft, or null for fixed-wing. */
export function rotorParams(aircraft: Aircraft): RotorcraftParams | null {
  if (aircraft.engine === "rotor") return HELI;
  if (aircraft.engine === "saucer") return aircraft.hover ?? HELI;
  return null;
}

export const isHoverCapable = (aircraft: Aircraft) => rotorParams(aircraft) !== null;

export function spawnAircraft(
  aircraft: Aircraft,
  lat: number,
  lon: number,
  alt: number,
  heading: number,
  speedMs: number,
  boost: boolean,
  onGround: boolean,
): Flight {
  const rotor = rotorParams(aircraft);
  const f = spawn(lat, lon, alt, heading, speedMs, boost, aircraft.performance);
  if (rotor) return spawnHeli(f, onGround);
  if (!onGround) return f;
  return { ...f, speed: 0, throttle: 0, pitch: 0, roll: 0, vs: 0, onGround: true };
}

export function stepAircraft(
  aircraft: Aircraft,
  f: Flight,
  c: Controls,
  dt: number,
  ground: number,
): Flight {
  const rotor = rotorParams(aircraft);
  return rotor
    ? stepHeli(f, c, dt, ground, rotor)
    : step(f, c, dt, ground, aircraft.performance);
}

/** Height of the model origin above the ground when sitting on it. */
export function gearHeight(aircraft: Aircraft): number {
  return rotorParams(aircraft)?.gear ?? aircraft.performance.gear ?? 3;
}

/** Autopilot: fixed-wing uses the existing great-circle autopilot. Rotorcraft
 * yaw toward the destination with the pedals, push the cyclic forward to a
 * cruise speed, and hold the engaged altitude with the collective; at the
 * destination they slow down and hover (the hold). */
export function aircraftAutopilot(
  aircraft: Aircraft,
  f: Flight,
  dest: Destination,
  state: AutopilotState,
  ground: number,
): { controls: Controls; state: AutopilotState; nav: NavInfo } {
  const rotor = rotorParams(aircraft);
  if (!rotor) return autopilotControls(f, dest, state, aircraft.performance);
  const nav = navTo(f, dest, false);
  const arrived = nav.distanceMeters < 400;
  const next = { ...state, holding: arrived };
  const rad = Math.PI / 180;
  const vFwd =
    (f.vn ?? 0) * Math.cos(f.heading * rad) + (f.ve ?? 0) * Math.sin(f.heading * rad);
  const err = ((nav.bearing - f.heading + 540) % 360) - 180;
  const cruise = Math.min(state.targetSpeed > 20 ? state.targetSpeed : 50, 55);
  const targetSpeed = arrived ? 0 : Math.min(cruise, Math.max(8, nav.distanceMeters / 30));
  const aligned = Math.abs(err) < 25 ? 1 : 0.3;
  const pitch = arrived ? 0 : clamp(-(targetSpeed * aligned - vFwd) / 12, -0.8, 0.6);
  const trim = hoverTrimCollective(f, ground, rotor);
  const wanted = clamp(trim + clamp((state.targetAlt - f.alt) * 0.01 - f.vs * 0.06, -0.2, 0.2), 0, 1);
  return {
    controls: {
      pitch,
      roll: 0,
      yaw: arrived ? 0 : clamp(err / 25, -1, 1),
      throttle: clamp((wanted - f.throttle) * 8, -1, 1),
    },
    state: next,
    nav: { ...nav, holding: arrived },
  };
}
