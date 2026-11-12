import { MAX_START_ALT_FT } from "./physics";
export { MAX_START_ALT_FT };
export const MIN_START_ALT_FT = 100;

/** Parse/validate a typed start altitude (ft): finite, 100 … 2,000,000. */
export function startAltFt(value: unknown): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/[,\s]/g, ""));
  if (!Number.isFinite(n)) return MIN_START_ALT_FT;
  return Math.round(Math.min(MAX_START_ALT_FT, Math.max(MIN_START_ALT_FT, n)));
}

const LMIN = Math.log10(MIN_START_ALT_FT),
  LMAX = Math.log10(MAX_START_ALT_FT);

/** Log-scale slider 0…1000 ↔ altitude, rounded to friendly steps. */
export function sliderToAlt(pos: number): number {
  const t = Math.min(1, Math.max(0, pos / 1000));
  const ft = 10 ** (LMIN + t * (LMAX - LMIN));
  const step = ft < 1000 ? 50 : ft < 10000 ? 500 : ft < 100000 ? 1000 : 10000;
  return startAltFt(Math.round(ft / step) * step);
}

export function altToSlider(ft: number): number {
  const a = startAltFt(ft);
  return Math.round(((Math.log10(a) - LMIN) / (LMAX - LMIN)) * 1000);
}
