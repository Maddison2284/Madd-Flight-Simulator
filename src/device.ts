/** Device class + memory budgets. iPhone/iPad Safari kills a tab that
 * grows past roughly 1–1.5 GB (CPU + GPU), so phones get a much smaller
 * Google 3D tile cache and coarser detail than desktops. */
export function isMobileDevice(
  nav: { userAgent?: string; platform?: string; maxTouchPoints?: number } = typeof navigator !== "undefined" ? navigator : {},
  coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
): boolean {
  const ua = nav.userAgent || "";
  if (/iPhone|iPad|iPod|Android|Mobile/i.test(ua)) return true;
  // iPadOS reports itself as a Mac.
  if (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1) return true;
  return coarse;
}

export type TileBudget = {
  maximumScreenSpaceError: number;
  cacheBytes: number;
  maximumCacheOverflowBytes: number;
  globeTileCacheSize: number;
};
const MB = 1024 * 1024;
export function tileBudget(mobile: boolean): TileBudget {
  return mobile
    ? { maximumScreenSpaceError: 16, cacheBytes: 256 * MB, maximumCacheOverflowBytes: 64 * MB, globeTileCacheSize: 50 }
    : { maximumScreenSpaceError: 8, cacheBytes: 512 * MB, maximumCacheOverflowBytes: 256 * MB, globeTileCacheSize: 100 };
}
/** Coarser 3D-tile detail while warping, so Mach 1.2–10 does not request
 * (and cache) a fresh full-detail city every fraction of a second. */
export function warpScreenSpaceError(base: number, warp: number): number {
  return warp > 0 ? Math.round(base * (1.5 + warp * 0.75)) : base;
}
/** Google 3D detail while flying: full detail (base SSE) up to ~135 kt so
 * slow flight and the ground look exactly as before; above that the error
 * budget relaxes linearly to 2× base at ~450 kt, because fast flight streams
 * a fresh full-detail city every few seconds (that's the in-flight loading
 * stutter). Quantised so the tileset is not re-tuned every frame. Warp keeps
 * its own, coarser curve. */
export function flightScreenSpaceError(base: number, speedMs: number, warp: number): number {
  if (warp > 0) return warpScreenSpaceError(base, warp);
  const t = Math.min(1, Math.max(0, (speedMs - 70) / 160));
  return Math.round(base * (1 + t) / 2) * 2 || base;
}
