import { clamp, wrap, type Controls, type Flight, type Performance } from "./physics";
import type { Destination } from "./destinations";

export const ARRIVAL_METERS = 8000;
export const HOLD_RADIUS_METERS = 6000;
const MANUAL_DEADBAND = 0.12;

export type AutopilotMode = "off" | "nav" | "hold";

export type AutopilotState = {
  engaged: boolean;
  holding: boolean;
  targetAlt: number;
  targetSpeed: number;
};

export type NavInfo = {
  bearing: number;
  distanceMeters: number;
  etaSec: number;
  holding: boolean;
  bugOffsetDeg: number;
};

const EARTH_M = 6371000;

export function greatCircleDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const r = Math.PI / 180;
  const p1 = lat1 * r,
    p2 = lat2 * r;
  const dLat = (lat2 - lat1) * r,
    dLon = (lon2 - lon1) * r;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function greatCircleBearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const r = Math.PI / 180;
  const p1 = lat1 * r,
    p2 = lat2 * r;
  const dLon = (lon2 - lon1) * r;
  const y = Math.sin(dLon) * Math.cos(p2);
  const x =
    Math.cos(p1) * Math.sin(p2) -
    Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
  return wrap((Math.atan2(y, x) / r + 360) % 360);
}

export function headingErrorDeg(current: number, target: number): number {
  return wrap(target - current + 180) - 180;
}

export function isManualInput(controls: Controls): boolean {
  return (
    Math.abs(controls.pitch) > MANUAL_DEADBAND ||
    Math.abs(controls.roll) > MANUAL_DEADBAND ||
    Math.abs(controls.yaw) > MANUAL_DEADBAND ||
    Math.abs(controls.throttle) > MANUAL_DEADBAND
  );
}

export function engageAutopilot(flight: Flight): AutopilotState {
  return {
    engaged: true,
    holding: false,
    targetAlt: flight.alt,
    targetSpeed: flight.speed,
  };
}

export function disengageAutopilot(state: AutopilotState): AutopilotState {
  return { ...state, engaged: false, holding: false };
}

function maxBankFor(perf: Performance): number {
  return clamp(perf.rollRate * 0.55, 18, 32);
}

export function greatCirclePositions(
  fromLat: number,
  fromLon: number,
  fromAlt: number,
  dest: Destination,
  segments = 24,
): { lat: number; lon: number; alt: number }[] {
  const points: { lat: number; lon: number; alt: number }[] = [];
  const r = Math.PI / 180;
  const lat1 = fromLat * r,
    lon1 = fromLon * r;
  const lat2 = dest.lat * r,
    lon2 = dest.lon * r;
  const d = greatCircleDistanceMeters(fromLat, fromLon, dest.lat, dest.lon) / EARTH_M;
  if (d < 1e-9) {
    return [
      { lat: fromLat, lon: fromLon, alt: fromAlt },
      { lat: dest.lat, lon: dest.lon, alt: Math.min(fromAlt, 300) },
    ];
  }
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const a = Math.sin((1 - f) * d) / Math.sin(d);
    const b = Math.sin(f * d) / Math.sin(d);
    const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
    const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) / r;
    const lon = Math.atan2(y, x) / r;
    const alt = fromAlt * (1 - f) + Math.min(fromAlt, 400) * f;
    points.push({ lat, lon, alt });
  }
  return points;
}

export function navTo(
  flight: Pick<Flight, "lat" | "lon" | "heading" | "speed">,
  dest: Destination,
  holding: boolean,
): NavInfo {
  const distanceMeters = greatCircleDistanceMeters(
    flight.lat,
    flight.lon,
    dest.lat,
    dest.lon,
  );
  let bearing = greatCircleBearingDeg(flight.lat, flight.lon, dest.lat, dest.lon);
  let activeHolding = holding || distanceMeters < ARRIVAL_METERS;
  if (activeHolding) {
    const radial = (HOLD_RADIUS_METERS - distanceMeters) / HOLD_RADIUS_METERS;
    bearing = wrap(bearing - 90 + clamp(radial * 35, -35, 35));
  }
  const bugOffsetDeg = headingErrorDeg(flight.heading, bearing);
  const etaSec =
    flight.speed > 5 ? Math.round(distanceMeters / flight.speed) : Infinity;
  return { bearing, distanceMeters, etaSec, holding: activeHolding, bugOffsetDeg };
}

export function autopilotControls(
  flight: Flight,
  dest: Destination,
  state: AutopilotState,
  perf: Performance,
): { controls: Controls; state: AutopilotState; nav: NavInfo } {
  const nav = navTo(flight, dest, state.holding);
  const next: AutopilotState = {
    ...state,
    holding: state.engaged ? nav.holding : false,
  };
  if (!state.engaged) {
    return {
      controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0 },
      state: next,
      nav,
    };
  }
  const maxBank = maxBankFor(perf);
  const desiredBank = clamp(nav.bugOffsetDeg * 0.7, -maxBank, maxBank);
  const altError = next.targetAlt - flight.alt;
  const desiredPitch = clamp(altError * 0.015 - flight.vs * 0.08, -12, 12);
  const speedError = next.targetSpeed - flight.speed;
  return {
    controls: {
      roll: clamp((desiredBank - flight.roll) / 16, -1, 1),
      pitch: clamp((desiredPitch - flight.pitch) / 8, -1, 1),
      yaw: 0,
      throttle: clamp(speedError * 0.04, -1, 1),
    },
    state: next,
    nav,
  };
}

export function formatDistance(meters: number): string {
  const nm = meters / 1852;
  if (nm >= 100) return `${Math.round(nm)} NM`;
  if (nm >= 10) return `${nm.toFixed(0)} NM`;
  return `${nm.toFixed(1)} NM`;
}

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const sec = Math.round(seconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
