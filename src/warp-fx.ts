/** Warp speed lines: thin radial dashes that stream outward from the
 * vanishing point, drawn only toward the screen edges. Fully deterministic
 * (fixed seeds, time-based motion), so there is no per-frame re-randomizing
 * and therefore no strobing. */
export type Streak = { angle: number; phase: number; speed: number; len: number; width: number };
export type Segment = { x1: number; y1: number; x2: number; y2: number; alpha: number; width: number };

/** Lines per warp level (index = level). */
export const STREAK_COUNT = [0, 28, 44, 64] as const;
/** Peak line opacity per warp level: subtle, scaled with warp. */
export const STREAK_ALPHA = [0, 0.28, 0.34, 0.42] as const;
/** Dash travel speed (screen spans per second) per warp level. */
export const STREAK_SPEED = [0, 0.55, 0.8, 1.1] as const;

export function makeStreaks(n = 64, seed = 7): Streak[] {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const out: Streak[] = [];
  for (let i = 0; i < n; i++) {
    // Evenly spread angles with jitter, so lines never bunch into stripes.
    const angle = ((i + 0.15 + rnd() * 0.7) / n) * Math.PI * 2;
    out.push({ angle, phase: rnd(), speed: 0.75 + rnd() * 0.5, len: 0.12 + rnd() * 0.16, width: 0.8 + rnd() * 0.7 });
  }
  return out;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Segments to draw at time `t` (s) on a `w`×`h` CSS-pixel overlay.
 * `intensity` 0…1 fades the whole effect in/out. Lines start at ~45% of the
 * half-diagonal (clear centre) and fade in toward the edges. */
export function streakSegments(
  streaks: readonly Streak[],
  t: number,
  w: number,
  h: number,
  level: number,
  intensity = 1,
): Segment[] {
  const lv = Math.max(0, Math.min(3, Math.round(level))) as 0 | 1 | 2 | 3;
  if (!lv || intensity <= 0 || w <= 0 || h <= 0) return [];
  const cx = w / 2, cy = h / 2;
  const R = Math.hypot(cx, cy);
  const rIn = R * 0.45, rOut = R * 1.08, span = rOut - rIn;
  const n = Math.min(streaks.length, STREAK_COUNT[lv]);
  const segs: Segment[] = [];
  for (let i = 0; i < n; i++) {
    const s = streaks[Math.floor((i * streaks.length) / n)];
    const p = (((s.phase + t * STREAK_SPEED[lv] * s.speed) % 1) + 1) % 1;
    const head = rIn + p * span;
    const tail = Math.max(rIn * 0.95, head - s.len * R * (0.6 + 0.6 * p) * (0.8 + lv * 0.15));
    const alpha = STREAK_ALPHA[lv] * intensity * smooth(rIn, rIn + span * 0.35, head);
    if (alpha < 0.004) continue;
    const c = Math.cos(s.angle), si = Math.sin(s.angle);
    segs.push({ x1: cx + c * tail, y1: cy + si * tail, x2: cx + c * head, y2: cy + si * head, alpha, width: s.width });
  }
  return segs;
}
