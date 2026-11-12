/** Display units. All flight state stays in SI (m, m/s); planner inputs stay in
 * knots / feet internally. Conversion happens only at display/entry time, so
 * switching units never changes (or drifts) a stored value. */
export type UnitSystem = "imperial" | "aviation" | "metric";

export const UNIT_SYSTEMS: { id: UnitSystem; label: string; detail: string }[] = [
  { id: "imperial", label: "Imperial", detail: "mph · ft · ft/min" },
  { id: "aviation", label: "Aviation", detail: "kt · ft · ft/min" },
  { id: "metric", label: "Metric", detail: "km/h · m · m/s" },
];

export const DEFAULT_UNITS: UnitSystem = "imperial";
export const UNITS_KEY = "maddflight-units";

/** Exact definitions. */
export const M_PER_FT = 0.3048;
export const MS_PER_KT = 1852 / 3600; // 0.514444…
export const MS_PER_MPH = 0.44704;
export const MS_PER_KMH = 1 / 3.6;

export function parseUnits(raw: string | null | undefined): UnitSystem {
  return raw === "imperial" || raw === "aviation" || raw === "metric" ? raw : DEFAULT_UNITS;
}
export function readUnits(): UnitSystem {
  try {
    return parseUnits(localStorage.getItem(UNITS_KEY));
  } catch {
    return DEFAULT_UNITS;
  }
}
export function saveUnits(u: UnitSystem) {
  try {
    localStorage.setItem(UNITS_KEY, u);
  } catch {}
}

const SPEED_MS: Record<UnitSystem, number> = {
  imperial: MS_PER_MPH,
  aviation: MS_PER_KT,
  metric: MS_PER_KMH,
};

/** m/s → display speed unit. */
export const speedFromMs = (ms: number, u: UnitSystem) => ms / SPEED_MS[u];
/** display speed unit → m/s. */
export const speedToMs = (v: number, u: UnitSystem) => v * SPEED_MS[u];
/** knots → display speed unit (planner state is in knots). */
export const speedFromKt = (kt: number, u: UnitSystem) => speedFromMs(kt * MS_PER_KT, u);
export const speedToKt = (v: number, u: UnitSystem) => speedToMs(v, u) / MS_PER_KT;

/** metres → display altitude unit. */
export const altFromM = (m: number, u: UnitSystem) => (u === "metric" ? m : m / M_PER_FT);
export const altToM = (v: number, u: UnitSystem) => (u === "metric" ? v : v * M_PER_FT);
/** feet → display altitude unit (planner state is in feet). */
export const altFromFt = (ft: number, u: UnitSystem) => altFromM(ft * M_PER_FT, u);
export const altToFt = (v: number, u: UnitSystem) => altToM(v, u) / M_PER_FT;

/** vertical speed m/s → display (ft/min, or m/s for metric). */
export const vsFromMs = (ms: number, u: UnitSystem) => (u === "metric" ? ms : (ms / M_PER_FT) * 60);

/** distance metres → display (mi / NM / km). */
export function distFromM(m: number, u: UnitSystem): number {
  return u === "imperial" ? m / 1609.344 : u === "aviation" ? m / 1852 : m / 1000;
}

export const speedUnit = (u: UnitSystem) => (u === "imperial" ? "mph" : u === "aviation" ? "kt" : "km/h");
export const altUnit = (u: UnitSystem) => (u === "metric" ? "m" : "ft");
export const vsUnit = (u: UnitSystem) => (u === "metric" ? "m/s" : "ft/min");
export const distUnit = (u: UnitSystem) => (u === "imperial" ? "mi" : u === "aviation" ? "NM" : "km");
/** Upper-case HUD labels. */
export const speedLabel = (u: UnitSystem) => speedUnit(u).toUpperCase();
export const altLabel = (u: UnitSystem) => (u === "metric" ? "M" : "FT");
export const vsLabel = (u: UnitSystem) => (u === "metric" ? "M / S" : "FT / MIN");

/** Round and group with commas: 12345.6 → "12,346". -0 prints as "0". */
export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const r = Math.round(n);
  return (r === 0 ? 0 : r).toLocaleString("en-US");
}
/** Fixed decimals with grouping (for m/s vertical speed etc.). */
export function fmtFixed(n: number, digits: number): string {
  if (!Number.isFinite(n)) return "—";
  const v = Number(n.toFixed(digits));
  return (v === 0 ? 0 : v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
/** Vertical speed formatted for the unit (ft/min whole numbers, m/s one decimal). */
export const fmtVs = (ms: number, u: UnitSystem) => (u === "metric" ? fmtFixed(vsFromMs(ms, u), 1) : fmtInt(vsFromMs(ms, u)));

export function formatDistanceUnits(meters: number, u: UnitSystem): string {
  const d = distFromM(meters, u);
  const unit = distUnit(u);
  return d >= 10 ? `${fmtInt(d)} ${unit}` : `${d.toFixed(1)} ${unit}`;
}
