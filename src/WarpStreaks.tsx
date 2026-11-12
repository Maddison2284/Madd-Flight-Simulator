import { useEffect, useMemo, useRef } from "react";
import { makeStreaks, streakSegments } from "./warp-fx";

/** Canvas speed-line overlay for saucer warp. Sits under the HUD
 * (z-index 0, pointer-events none), animates smoothly from a fixed seed. */
export function WarpStreaks({ level }: { level: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(level);
  levelRef.current = level;
  const streaks = useMemo(() => makeStreaks(64), []);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0;
    const t0 = performance.now();
    let fade = 0, last = t0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      fade += (1 - fade) * (1 - Math.exp(-dt / 0.35));
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = "round";
      for (const s of streakSegments(streaks, (now - t0) / 1000, w, h, levelRef.current, fade)) {
        const g = ctx.createLinearGradient(s.x1, s.y1, s.x2, s.y2);
        g.addColorStop(0, "rgba(225,250,255,0)");
        g.addColorStop(1, `rgba(235,252,255,${s.alpha.toFixed(3)})`);
        ctx.strokeStyle = g;
        ctx.lineWidth = s.width;
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [streaks]);
  return <canvas ref={ref} className="warp-streaks" data-warp={level} aria-hidden="true" />;
}
