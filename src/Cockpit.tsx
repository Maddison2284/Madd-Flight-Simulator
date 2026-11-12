import type { ReactNode } from "react";
import type { Aircraft } from "./aircraft";
import type { Flight } from "./physics";

/** Original vector flight-deck artwork per aircraft type (no third-party
 * assets). Every instrument is driven live from the flight state. */
export type CockpitKind = "sixpack" | "glass" | "airbus" | "heli" | "hud";

export function cockpitKind(aircraft: Pick<Aircraft, "id" | "engine">): CockpitKind {
  if (aircraft.id === "c172") return "sixpack";
  if (aircraft.id === "a320") return "airbus";
  if (aircraft.id === "fighter" || aircraft.engine === "saucer") return "hud";
  if (aircraft.engine === "rotor") return "heli";
  return "glass";
}

const KT = 1.943844;
const FT = 3.28084;
const norm = (d: number) => ((d % 360) + 360) % 360;
const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const pad3 = (n: number) => String(Math.round(norm(n)) % 360).padStart(3, "0");

type Live = { kt: number; ft: number; fpm: number; hdg: number; pitch: number; roll: number; thr: number };
function live(f: Flight): Live {
  return {
    kt: f.speed * KT,
    ft: f.alt * FT,
    fpm: f.vs * FT * 60,
    hdg: norm(f.heading),
    pitch: f.pitch,
    roll: f.roll,
    thr: f.throttle,
  };
}

/* ---------- shared instrument pieces ---------- */

function Bezel({ cx, cy, r, children, label }: { cx: number; cy: number; r: number; children: ReactNode; label?: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 9} fill="#15191d" stroke="#3a4148" strokeWidth="3" />
      <circle cx={cx} cy={cy} r={r} fill="#07090b" />
      {children}
      {label && (
        <text x={cx} y={cy + r + 26} textAnchor="middle" className="ck-cap">
          {label}
        </text>
      )}
      {[45, 135, 225, 315].map((a) => (
        <circle key={a} cx={cx + Math.cos((a * Math.PI) / 180) * (r + 5)} cy={cy + Math.sin((a * Math.PI) / 180) * (r + 5)} r="2.5" fill="#59626b" />
      ))}
    </g>
  );
}

/** Needle dial: value mapped linearly from [min,max] onto [a0,a1] degrees (0 = 12 o'clock, clockwise). */
function Dial({ cx, cy, r, value, min, max, a0, a1, major, minor, labels, unit, arcs, digital }: {
  cx: number; cy: number; r: number; value: number; min: number; max: number; a0: number; a1: number;
  major: number; minor?: number; labels?: (v: number) => string; unit?: string;
  arcs?: { from: number; to: number; color: string }[]; digital?: string;
}) {
  const ang = (v: number) => a0 + ((clampN(v, min, max) - min) / (max - min)) * (a1 - a0);
  const pt = (a: number, rr: number) => [cx + Math.sin((a * Math.PI) / 180) * rr, cy - Math.cos((a * Math.PI) / 180) * rr];
  const ticks: ReactNode[] = [];
  const step = minor || major;
  for (let v = min; v <= max + 1e-6; v += step) {
    const isMajor = Math.abs((v - min) / major - Math.round((v - min) / major)) < 1e-6;
    const [x1, y1] = pt(ang(v), r - (isMajor ? 13 : 7));
    const [x2, y2] = pt(ang(v), r - 1);
    ticks.push(<line key={`t${v}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#f2f2f2" strokeWidth={isMajor ? 2.4 : 1.2} />);
    if (isMajor && labels) {
      const [lx, ly] = pt(ang(v), r - 27);
      ticks.push(<text key={`l${v}`} x={lx} y={ly + 5} textAnchor="middle" className="ck-num">{labels(v)}</text>);
    }
  }
  const arcPath = (from: number, to: number, rr: number) => {
    const [x1, y1] = pt(ang(from), rr);
    const [x2, y2] = pt(ang(to), rr);
    const large = Math.abs(ang(to) - ang(from)) > 180 ? 1 : 0;
    return `M${x1} ${y1}A${rr} ${rr} 0 ${large} 1 ${x2} ${y2}`;
  };
  const a = ang(value);
  return (
    <g>
      {arcs?.map((c, i) => <path key={i} d={arcPath(c.from, c.to, r - 4)} stroke={c.color} strokeWidth="6" fill="none" />)}
      {ticks}
      {unit && <text x={cx} y={cy - r * 0.32} textAnchor="middle" className="ck-unit">{unit}</text>}
      {digital && <text x={cx} y={cy + r * 0.5} textAnchor="middle" className="ck-dig">{digital}</text>}
      <g transform={`rotate(${a} ${cx} ${cy})`}>
        <path d={`M${cx - 3} ${cy + 12}L${cx} ${cy - r + 14}L${cx + 3} ${cy + 12}Z`} fill="#ffffff" />
      </g>
      <circle cx={cx} cy={cy} r="6" fill="#2b3036" stroke="#888" />
    </g>
  );
}

/** Mechanical attitude indicator (round). */
function AttitudeBall({ cx, cy, r, pitch, roll, id }: { cx: number; cy: number; r: number; pitch: number; roll: number; id: string }) {
  const k = r / 30; // px per degree
  const p = clampN(pitch, -40, 40) * k;
  return (
    <g>
      <clipPath id={id}><circle cx={cx} cy={cy} r={r} /></clipPath>
      <g clipPath={`url(#${id})`}>
        <g transform={`rotate(${-roll} ${cx} ${cy}) translate(0 ${p})`}>
          <rect x={cx - r * 3} y={cy - r * 4} width={r * 6} height={r * 4} fill="#2f7fd0" />
          <rect x={cx - r * 3} y={cy} width={r * 6} height={r * 4} fill="#7a4a22" />
          <line x1={cx - r * 3} y1={cy} x2={cx + r * 3} y2={cy} stroke="#fff" strokeWidth="2" />
          {[-20, -10, 10, 20].map((d) => (
            <line key={d} x1={cx - (Math.abs(d) === 10 ? r * 0.25 : r * 0.4)} x2={cx + (Math.abs(d) === 10 ? r * 0.25 : r * 0.4)} y1={cy - d * k} y2={cy - d * k} stroke="#fff" strokeWidth="1.6" />
          ))}
        </g>
        <g transform={`rotate(${-roll} ${cx} ${cy})`}>
          <path d={`M${cx} ${cy - r + 2}l-6 12h12z`} fill="#f3c33a" />
        </g>
        {[-60, -30, -20, -10, 10, 20, 30, 60].map((d) => (
          <line key={d} transform={`rotate(${d} ${cx} ${cy})`} x1={cx} y1={cy - r} x2={cx} y2={cy - r + (Math.abs(d) % 30 === 0 ? 12 : 7)} stroke="#fff" strokeWidth="2" />
        ))}
      </g>
      <path d={`M${cx - r * 0.55} ${cy}h${r * 0.33}l${r * 0.1} ${r * 0.1}l${r * 0.1} ${-r * 0.1}h${r * 0.02}M${cx + r * 0.55} ${cy}h${-r * 0.33}l${-r * 0.1} ${r * 0.1}`} stroke="#f3c33a" strokeWidth="4" fill="none" />
      <circle cx={cx} cy={cy} r="3" fill="#f3c33a" />
    </g>
  );
}

function HeadingCard({ cx, cy, r, hdg }: { cx: number; cy: number; r: number; hdg: number }) {
  const marks: ReactNode[] = [];
  for (let d = 0; d < 360; d += 5) {
    const major = d % 30 === 0;
    marks.push(<line key={d} transform={`rotate(${d} ${cx} ${cy})`} x1={cx} y1={cy - r} x2={cx} y2={cy - r + (major ? 12 : d % 10 === 0 ? 8 : 5)} stroke="#fff" strokeWidth={major ? 2 : 1} />);
    if (major) {
      const t = d === 0 ? "N" : d === 90 ? "E" : d === 180 ? "S" : d === 270 ? "W" : String(d / 10);
      marks.push(<text key={`t${d}`} transform={`rotate(${d} ${cx} ${cy})`} x={cx} y={cy - r + 30} textAnchor="middle" className="ck-num">{t}</text>);
    }
  }
  return (
    <g>
      <g transform={`rotate(${-hdg} ${cx} ${cy})`}>{marks}</g>
      <path d={`M${cx} ${cy - 30}l-14 40l14 -8l14 8z`} fill="none" stroke="#f3c33a" strokeWidth="2.5" />
      <path d={`M${cx} ${cy - r - 2}l-6 -9h12z`} fill="#f3c33a" />
    </g>
  );
}

function TurnCoordinator({ cx, cy, r, roll }: { cx: number; cy: number; r: number; roll: number }) {
  return (
    <g>
      <line transform={`rotate(-70 ${cx} ${cy})`} x1={cx - r + 6} y1={cy} x2={cx - r + 20} y2={cy} stroke="#fff" strokeWidth="3" />
      <line transform={`rotate(70 ${cx} ${cy})`} x1={cx + r - 6} y1={cy} x2={cx + r - 20} y2={cy} stroke="#fff" strokeWidth="3" />
      <line x1={cx - r + 6} y1={cy} x2={cx - r + 20} y2={cy} stroke="#fff" strokeWidth="3" />
      <line x1={cx + r - 6} y1={cy} x2={cx + r - 20} y2={cy} stroke="#fff" strokeWidth="3" />
      <g transform={`rotate(${clampN(roll, -45, 45) * 0.9} ${cx} ${cy})`}>
        <path d={`M${cx - r * 0.7} ${cy}h${r * 1.4}M${cx} ${cy - 10}v18`} stroke="#fff" strokeWidth="5" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="8" fill="#fff" />
      </g>
      <rect x={cx - r * 0.5} y={cy + r * 0.45} width={r} height="14" rx="7" fill="#d7d2a2" />
      <circle cx={cx} cy={cy + r * 0.45 + 7} r="6" fill="#111" />
      <text x={cx} y={cy - r * 0.45} textAnchor="middle" className="ck-unit">TURN COORD</text>
      <text x={cx - r + 18} y={cy + 32} className="ck-unit">L</text>
      <text x={cx + r - 26} y={cy + 32} className="ck-unit">R</text>
    </g>
  );
}

/* ---------- Glass PFD (bizjet / airliner) ---------- */

function Tape({ x, y, w, h, value, step, label, fmt, right }: { x: number; y: number; w: number; h: number; value: number; step: number; label: number; fmt: (v: number) => string; right?: boolean }) {
  const pxPer = h / (step * 8);
  const ticks: ReactNode[] = [];
  const base = Math.floor(value / step) * step;
  for (let v = base - step * 6; v <= base + step * 6; v += step) {
    const ty = y + h / 2 - (v - value) * pxPer;
    if (ty < y || ty > y + h) continue;
    const major = Math.round(v / step) % Math.round(label / step) === 0;
    const tx = right ? x : x + w;
    ticks.push(<line key={v} x1={tx} x2={right ? tx + (major ? 14 : 8) : tx - (major ? 14 : 8)} y1={ty} y2={ty} stroke="#fff" strokeWidth="1.6" />);
    if (major && v >= 0) ticks.push(<text key={`t${v}`} x={right ? x + 18 : x + w - 18} y={ty + 6} textAnchor={right ? "start" : "end"} className="ck-tape">{fmt(v)}</text>);
  }
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="#4a525a" opacity="0.85" />
      {ticks}
      <rect x={x - 2} y={y + h / 2 - 17} width={w + 4} height="34" fill="#000" stroke="#fff" strokeWidth="1.5" />
      <text x={x + w / 2} y={y + h / 2 + 8} textAnchor="middle" className="ck-box">{fmt(value)}</text>
    </g>
  );
}

function Pfd({ x, y, w, h, s, id }: { x: number; y: number; w: number; h: number; s: Live; id: string }) {
  const ax = x + w * 0.2, aw = w * 0.6, ay = y + h * 0.08, ah = h * 0.68;
  const cx = ax + aw / 2, cy = ay + ah / 2;
  const k = ah / 50;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="8" fill="#000" stroke="#2c3238" strokeWidth="6" />
      <clipPath id={id}><rect x={ax} y={ay} width={aw} height={ah} rx="10" /></clipPath>
      <g clipPath={`url(#${id})`}>
        <g transform={`rotate(${-s.roll} ${cx} ${cy}) translate(0 ${clampN(s.pitch, -60, 60) * k})`}>
          <rect x={cx - aw * 2} y={cy - ah * 4} width={aw * 4} height={ah * 4} fill="#1f72c7" />
          <rect x={cx - aw * 2} y={cy} width={aw * 4} height={ah * 4} fill="#7b4b1f" />
          <line x1={cx - aw * 2} x2={cx + aw * 2} y1={cy} y2={cy} stroke="#fff" strokeWidth="2" />
          {[-30, -20, -10, -5, 5, 10, 20, 30].map((d) => (
            <g key={d}>
              <line x1={cx - (d % 10 ? 18 : 40)} x2={cx + (d % 10 ? 18 : 40)} y1={cy - d * k} y2={cy - d * k} stroke="#fff" strokeWidth="1.6" />
              {d % 10 === 0 && <text x={cx + 46} y={cy - d * k + 5} className="ck-ladder">{Math.abs(d)}</text>}
            </g>
          ))}
        </g>
      </g>
      <path d={`M${cx - 90} ${cy}h55v12M${cx + 90} ${cy}h-55v12`} stroke="#f3c33a" strokeWidth="6" fill="none" />
      <rect x={cx - 5} y={cy - 5} width="10" height="10" fill="#f3c33a" />
      <g transform={`rotate(${-s.roll} ${cx} ${cy})`}><path d={`M${cx} ${ay + 6}l-9 15h18z`} fill="#fff" /></g>
      <Tape x={x + 8} y={ay} w={w * 0.15} h={ah} value={s.kt} step={10} label={20} fmt={(v) => String(Math.round(v))} />
      <Tape x={x + w - w * 0.15 - 8} y={ay} w={w * 0.15} h={ah} value={s.ft} step={100} label={500} fmt={(v) => String(Math.round(v / 10) * 10)} right />
      <text x={x + w - 10} y={ay + ah + 24} textAnchor="end" className="ck-mag">VS {Math.round(s.fpm / 50) * 50}</text>
      <text x={x + 12} y={ay + ah + 24} className="ck-mag">GS {Math.round(s.kt)}</text>
      <g>
        <rect x={cx - 50} y={y + h - 44} width="100" height="34" fill="#000" stroke="#fff" />
        <text x={cx} y={y + h - 19} textAnchor="middle" className="ck-box">{pad3(s.hdg)}°</text>
      </g>
    </g>
  );
}

function Nd({ x, y, w, h, s, title }: { x: number; y: number; w: number; h: number; s: Live; title: string }) {
  const cx = x + w / 2, cy = y + h * 0.78, r = h * 0.62;
  const ticks: ReactNode[] = [];
  for (let d = 0; d < 360; d += 10) {
    const rel = norm(d - s.hdg + 180) - 180;
    if (Math.abs(rel) > 60) continue;
    ticks.push(<line key={d} transform={`rotate(${rel} ${cx} ${cy})`} x1={cx} x2={cx} y1={cy - r} y2={cy - r + (d % 30 ? 8 : 15)} stroke="#fff" strokeWidth="2" />);
    if (d % 30 === 0) ticks.push(<text key={`t${d}`} transform={`rotate(${rel} ${cx} ${cy})`} x={cx} y={cy - r + 34} textAnchor="middle" className="ck-num">{d / 10}</text>);
  }
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="8" fill="#000" stroke="#2c3238" strokeWidth="6" />
      <clipPath id="nd-clip"><rect x={x} y={y} width={w} height={h} /></clipPath>
      <g clipPath="url(#nd-clip)">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#fff" strokeWidth="1.5" />
        <circle cx={cx} cy={cy} r={r / 2} fill="none" stroke="#fff" strokeDasharray="6 8" opacity="0.6" />
        {ticks}
      </g>
      <path d={`M${cx} ${cy - 22}v40M${cx - 18} ${cy - 4}h36M${cx - 8} ${cy + 16}h16`} stroke="#f3c33a" strokeWidth="4" />
      <text x={x + 14} y={y + 28} className="ck-mag">{title}</text>
      <text x={x + w - 14} y={y + 28} textAnchor="end" className="ck-grn">HDG {pad3(s.hdg)}</text>
      <text x={x + 14} y={y + h - 14} className="ck-grn">TAS {Math.round(s.kt)}</text>
    </g>
  );
}

function Engine({ x, y, w, h, s, title }: { x: number; y: number; w: number; h: number; s: Live; title: string }) {
  const n1 = 20 + s.thr * 78;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="8" fill="#000" stroke="#2c3238" strokeWidth="6" />
      <text x={x + w / 2} y={y + 30} textAnchor="middle" className="ck-mag">{title}</text>
      {[0, 1].map((i) => (
        <g key={i}>
          <Dial cx={x + w * (0.28 + i * 0.44)} cy={y + h * 0.48} r={Math.min(w * 0.2, h * 0.3)} value={n1} min={0} max={110} a0={-130} a1={110} major={20} arcs={[{ from: 100, to: 110, color: "#d33" }]} digital={n1.toFixed(1)} />
          <text x={x + w * (0.28 + i * 0.44)} y={y + h * 0.9} textAnchor="middle" className="ck-cap">N1 {i + 1}</text>
        </g>
      ))}
    </g>
  );
}

/* ---------- frames ---------- */

function FrameSvg({ kind }: { kind: CockpitKind }) {
  return (
    <svg className="windshield" viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="ck-trim" x2="1" y2="1">
          <stop stopColor="#5d666d" />
          <stop offset=".35" stopColor="#262d33" />
          <stop offset="1" stopColor="#0b0f13" />
        </linearGradient>
      </defs>
      {kind === "sixpack" && (
        <g fill="url(#ck-trim)" stroke="#6c757c" strokeWidth="2">
          {/* High wing root + headliner, door posts, centre post. */}
          <path d="M0 0H1600V95Q800 60 0 95Z" />
          <path d="M0 0L95 95L210 560L120 900H0Z M1600 0L1505 95L1390 560L1480 900H1600Z" />
          <path d="M792 70L796 520H804L808 70Z" />
          <path d="M0 150L260 105L250 160L0 230Z" fill="#c9ced2" opacity="0.92" />
        </g>
      )}
      {(kind === "glass" || kind === "airbus") && (
        <g fill="url(#ck-trim)" stroke="#6c757c" strokeWidth="2">
          <path d="M0 0H1600V85Q1200 40 800 52Q400 40 0 85Z" />
          <path d="M0 0L70 70L190 560L90 900H0Z M1600 0L1530 70L1410 560L1510 900H1600Z" />
          <path d="M786 52L800 520L814 52Z" />
          <path d="M150 300L380 110L400 120L210 480Z M1450 300L1220 110L1200 120L1390 480Z" opacity="0.9" />
        </g>
      )}
      {kind === "heli" && (
        <g fill="url(#ck-trim)" stroke="#6c757c" strokeWidth="2">
          {/* Bubble canopy ribs and chin-window frame. */}
          <path d="M0 0H1600V40Q800 0 0 40Z" />
          <path d="M0 0Q90 300 60 900H0Z M1600 0Q1510 300 1540 900H1600Z" />
          <path d="M780 30Q790 260 790 520H810Q810 260 820 30Z" />
          <path d="M0 520Q400 470 790 520L780 560Q400 520 0 580Z M1600 520Q1200 470 810 520L820 560Q1200 520 1600 580Z" />
        </g>
      )}
      {kind === "hud" && (
        <g fill="url(#ck-trim)" stroke="#6c757c" strokeWidth="2">
          {/* Bubble canopy bow and canopy rails. */}
          <path d="M0 0H1600V24Q800 -6 0 24Z" />
          <path d="M0 0Q40 450 0 900Z M1600 0Q1560 450 1600 900Z" />
        </g>
      )}
    </svg>
  );
}

/* ---------- panels ---------- */

function SixPack({ s }: { s: Live }) {
  const r = 82, y1 = 140, y2 = 345;
  const xs = [520, 800, 1080];
  return (
    <g>
      <path d="M0 40Q800 -10 1600 40V560H0Z" fill="#23272b" stroke="#4b5257" strokeWidth="3" />
      <path d="M0 40Q800 -10 1600 40" stroke="#0b0d0f" strokeWidth="26" fill="none" />
      <Bezel cx={xs[0]} cy={y1} r={r} label="AIRSPEED">
        <Dial cx={xs[0]} cy={y1} r={r} value={s.kt} min={0} max={200} a0={-160} a1={160} major={20} minor={10} labels={(v) => (v % 40 === 0 && v ? String(v) : "")} unit="KNOTS" arcs={[{ from: 48, to: 85, color: "#ddd" }, { from: 55, to: 129, color: "#2bb34a" }, { from: 129, to: 163, color: "#e6c229" }, { from: 163, to: 166, color: "#d33" }]} />
      </Bezel>
      <Bezel cx={xs[1]} cy={y1} r={r} label="ATTITUDE"><AttitudeBall cx={xs[1]} cy={y1} r={r} pitch={s.pitch} roll={s.roll} id="ck-ai" /></Bezel>
      <Bezel cx={xs[2]} cy={y1} r={r} label="ALTITUDE">
        <Dial cx={xs[2]} cy={y1} r={r} value={s.ft % 1000} min={0} max={1000} a0={0} a1={360} major={100} minor={20} labels={(v) => (v < 1000 ? String(v / 100) : "")} digital={`${Math.round(s.ft).toLocaleString()} FT`} />
        <g transform={`rotate(${((s.ft % 10000) / 10000) * 360} ${xs[2]} ${y1})`}><path d={`M${xs[2] - 5} ${y1}L${xs[2]} ${y1 - r * 0.5}L${xs[2] + 5} ${y1}Z`} fill="#fff" /></g>
      </Bezel>
      <Bezel cx={xs[0]} cy={y2} r={r} label="TURN"><TurnCoordinator cx={xs[0]} cy={y2} r={r} roll={s.roll} /></Bezel>
      <Bezel cx={xs[1]} cy={y2} r={r} label="HEADING"><HeadingCard cx={xs[1]} cy={y2} r={r} hdg={s.hdg} /></Bezel>
      <Bezel cx={xs[2]} cy={y2} r={r} label="VERT SPEED">
        <Dial cx={xs[2]} cy={y2} r={r} value={clampN(s.fpm / 100, -20, 20)} min={-20} max={20} a0={-260} a1={80} major={5} minor={1} labels={(v) => String(Math.abs(v))} unit="100 FT/MIN" />
      </Bezel>
      {/* Engine cluster, radio stack, throttle. */}
      <Bezel cx={260} cy={y1} r={58} label="TACH"><Dial cx={260} cy={y1} r={58} value={600 + s.thr * 2100} min={0} max={3500} a0={-135} a1={135} major={500} arcs={[{ from: 2100, to: 2700, color: "#2bb34a" }, { from: 2700, to: 2750, color: "#d33" }]} labels={(v) => (v % 1000 === 0 ? String(v / 100) : "")} unit="RPM ×100" /></Bezel>
      <rect x="1240" y="70" width="250" height="300" rx="8" fill="#0d0f11" stroke="#444" />
      {["COM1 122.800", "NAV1 110.50", "XPDR 1200 ALT", `AP ${pad3(s.hdg)}`].map((t, i) => (
        <g key={t}><rect x="1256" y={90 + i * 70} width="218" height="50" rx="4" fill="#111a14" stroke="#2c3" /><text x="1365" y={123 + i * 70} textAnchor="middle" className="ck-grn">{t}</text></g>
      ))}
      <rect x="150" y="300" width="230" height="120" rx="8" fill="#15181b" stroke="#444" />
      <text x="265" y="335" textAnchor="middle" className="ck-cap">THROTTLE {Math.round(s.thr * 100)}%</text>
      <rect x="180" y="355" width="170" height="16" rx="8" fill="#000" />
      <rect x="180" y="355" width={170 * s.thr} height="16" rx="8" fill="#e8e8e8" />
      <text x="800" y="520" textAnchor="middle" className="ck-brand">CESSNA 172 · SKYHAWK</text>
    </g>
  );
}

function GlassDeck({ s, airbus, title }: { s: Live; airbus: boolean; title: string }) {
  return (
    <g>
      <path d="M0 30Q800 -10 1600 30V560H0Z" fill="#2a3036" stroke="#50585f" strokeWidth="3" />
      <path d="M260 30Q800 0 1340 30L1320 70H280Z" fill="#14181b" />
      <text x="800" y="58" textAnchor="middle" className="ck-cap">{airbus ? "FCU   SPD ---   HDG " + pad3(s.hdg) + "   ALT " + Math.round(s.ft / 100) * 100 + "   V/S " + Math.round(s.fpm / 100) * 100 : "AFCS   HDG " + pad3(s.hdg) + "   ALT " + Math.round(s.ft / 100) * 100}</text>
      <Pfd x={110} y={90} w={420} h={390} s={s} id="ck-pfd1" />
      <Nd x={560} y={90} w={360} h={390} s={s} title={airbus ? "ND  ARC" : "MFD  MAP"} />
      <Engine x={950} y={90} w={300} h={390} s={s} title={airbus ? "E/WD" : "EICAS"} />
      <Pfd x={1280} y={90} w={300} h={390} s={s} id="ck-pfd2" />
      {airbus ? (
        <g>
          {/* Side-sticks instead of yokes. */}
          <rect x="30" y="420" width="50" height="120" rx="20" fill="#1a1e22" />
          <rect x="44" y="360" width="22" height="90" rx="10" fill="#303840" transform={`rotate(${clampN(s.roll, -30, 30) * 0.4} 55 450)`} />
          <rect x="1520" y="420" width="50" height="120" rx="20" fill="#1a1e22" />
        </g>
      ) : (
        <g transform={`rotate(${clampN(s.roll, -45, 45) * 0.25} 320 560)`}>
          <path d="M220 540h200M320 540v40" stroke="#1b2228" strokeWidth="26" strokeLinecap="round" />
          <path d="M220 520v40M420 520v40" stroke="#283139" strokeWidth="30" strokeLinecap="round" />
        </g>
      )}
      <text x="800" y="530" textAnchor="middle" className="ck-brand">{title}</text>
    </g>
  );
}

function HeliPanel({ s }: { s: Live }) {
  const r = 64;
  return (
    <g>
      {/* Hooded centre console, like a Bell 206 JetRanger. */}
      <path d="M430 60Q800 10 1170 60L1130 560H470Z" fill="#202427" stroke="#4b5257" strokeWidth="3" />
      <path d="M430 60Q800 10 1170 60" stroke="#0a0c0e" strokeWidth="22" fill="none" />
      <Bezel cx={560} cy={150} r={r} label="AIRSPEED"><Dial cx={560} cy={150} r={r} value={s.kt} min={0} max={150} a0={-160} a1={160} major={20} labels={(v) => (v % 40 === 0 && v ? String(v) : "")} unit="KNOTS" arcs={[{ from: 0, to: 130, color: "#2bb34a" }, { from: 130, to: 133, color: "#d33" }]} /></Bezel>
      <Bezel cx={720} cy={150} r={r} label="ATTITUDE"><AttitudeBall cx={720} cy={150} r={r} pitch={s.pitch} roll={s.roll} id="ck-hai" /></Bezel>
      <Bezel cx={880} cy={150} r={r} label="ALTITUDE"><Dial cx={880} cy={150} r={r} value={s.ft % 1000} min={0} max={1000} a0={0} a1={360} major={100} labels={(v) => (v < 1000 ? String(v / 100) : "")} digital={`${Math.round(s.ft).toLocaleString()}`} /></Bezel>
      <Bezel cx={1040} cy={150} r={r} label="ROTOR / ENG RPM"><Dial cx={1040} cy={150} r={r} value={95 + s.thr * 5} min={0} max={110} a0={-140} a1={140} major={20} arcs={[{ from: 95, to: 100, color: "#2bb34a" }, { from: 100, to: 110, color: "#d33" }]} unit="% RPM" /></Bezel>
      <Bezel cx={640} cy={330} r={r} label="TORQUE"><Dial cx={640} cy={330} r={r} value={20 + s.thr * 80} min={0} max={120} a0={-140} a1={140} major={20} arcs={[{ from: 0, to: 85, color: "#2bb34a" }, { from: 85, to: 100, color: "#e6c229" }, { from: 100, to: 120, color: "#d33" }]} unit="% TQ" /></Bezel>
      <Bezel cx={800} cy={330} r={r} label="HEADING"><HeadingCard cx={800} cy={330} r={r} hdg={s.hdg} /></Bezel>
      <Bezel cx={960} cy={330} r={r} label="VERT SPEED"><Dial cx={960} cy={330} r={r} value={clampN(s.fpm / 100, -20, 20)} min={-20} max={20} a0={-260} a1={80} major={5} labels={(v) => (v % 10 === 0 ? String(Math.abs(v)) : "")} unit="100 FT/MIN" /></Bezel>
      {/* Cyclic between the knees, collective on the left. */}
      <g transform={`rotate(${clampN(s.roll, -30, 30) * 0.5} 800 900) rotate(${clampN(-s.pitch, -20, 20) * 0.3} 800 900)`}>
        <path d="M800 900V610" stroke="#1a1e22" strokeWidth="22" strokeLinecap="round" />
        <rect x="778" y="570" width="44" height="70" rx="16" fill="#2a3036" />
      </g>
      <path d={`M120 560L${300 + s.thr * 60} ${470 - s.thr * 40}`} stroke="#1a1e22" strokeWidth="24" strokeLinecap="round" />
      <text x="800" y="520" textAnchor="middle" className="ck-brand">BELL 206 · JETRANGER</text>
    </g>
  );
}

function Hud({ s }: { s: Live }) {
  // Pitch ladder + flight-path marker in green, collimated look.
  const cx = 800, cy = 450, k = 15; // ~15 px/deg matches Cesium's 60° vertical FOV
  const ladder: ReactNode[] = [];
  for (let d = -30; d <= 30; d += 5) {
    if (d === 0) continue;
    const y = cy - (d - s.pitch) * k;
    const dash = d < 0 ? "10 8" : undefined;
    ladder.push(
      <g key={d}>
        <path d={`M${cx - 130} ${y + (d > 0 ? 10 : -10)}V${y}H${cx - 50}M${cx + 50} ${y}H${cx + 130}V${y + (d > 0 ? 10 : -10)}`} strokeDasharray={dash} />
        <text x={cx - 140} y={y + 6} textAnchor="end" className="ck-hudt">{Math.abs(d)}</text>
        <text x={cx + 140} y={y + 6} className="ck-hudt">{Math.abs(d)}</text>
      </g>,
    );
  }
  const hdgTicks: ReactNode[] = [];
  for (let d = Math.floor(s.hdg / 5) * 5 - 30; d <= s.hdg + 30; d += 5) {
    const x = cx + (d - s.hdg) * 8;
    hdgTicks.push(<line key={d} x1={x} x2={x} y1={120} y2={d % 10 ? 130 : 138} />);
    if (d % 10 === 0) hdgTicks.push(<text key={`t${d}`} x={x} y={112} textAnchor="middle" className="ck-hudt">{pad3(d)}</text>);
  }
  return (
    <svg className="ck-hud" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet" aria-label="Fighter head-up display">
      <g stroke="#6dff8a" strokeWidth="2.5" fill="none" opacity="0.95">
        <clipPath id="hud-clip"><rect x="500" y="150" width="600" height="520" /></clipPath>
        <g clipPath="url(#hud-clip)">
          <g transform={`rotate(${-s.roll} ${cx} ${cy})`}>
            <line x1={cx - 400} x2={cx - 40} y1={cy + s.pitch * k} y2={cy + s.pitch * k} />
            <line x1={cx + 40} x2={cx + 400} y1={cy + s.pitch * k} y2={cy + s.pitch * k} />
            <g transform={`translate(0 0)`}>{ladder}</g>
          </g>
        </g>
        <path d={`M${cx - 30} ${cy}h18M${cx + 12} ${cy}h18M${cx} ${cy - 12}v-12`} />
        <circle cx={cx} cy={cy} r="12" />
        <path d={`M${cx - 70} ${cy + 4}l20 0l10 10l10 -10l10 10l10 -10l20 0`} opacity="0.5" />
        {hdgTicks}
        <path d={`M${cx} 140l-7 12h14z`} fill="#6dff8a" />
        <rect x="560" y={cy - 22} width="96" height="44" />
        <text x="608" y={cy + 10} textAnchor="middle" className="ck-hudb">{Math.round(s.kt)}</text>
        <text x="608" y={cy - 32} textAnchor="middle" className="ck-hudt">KTS</text>
        <rect x="940" y={cy - 22} width="110" height="44" />
        <text x="995" y={cy + 10} textAnchor="middle" className="ck-hudb">{Math.round(s.ft / 10) * 10}</text>
        <text x="995" y={cy - 32} textAnchor="middle" className="ck-hudt">ALT</text>
        <text x="560" y="660" className="ck-hudt">M {(s.kt / 661).toFixed(2)}   G {(1 / Math.max(0.3, Math.cos((s.roll * Math.PI) / 180))).toFixed(1)}</text>
        <text x="1050" y="660" textAnchor="end" className="ck-hudt">VS {Math.round(s.fpm)}</text>
        <text x="800" y="690" textAnchor="middle" className="ck-hudt">THR {Math.round(s.thr * 100)}%</text>
      </g>
    </svg>
  );
}

function FighterPanel({ s }: { s: Live }) {
  return (
    <g>
      <path d="M0 120Q800 20 1600 120V560H0Z" fill="#16191c" stroke="#3d454b" strokeWidth="3" />
      {/* HUD combiner glass and two MFDs + up-front controls. */}
      <path d="M600 120L640 10H960L1000 120Z" fill="#2c4a3a" opacity="0.25" stroke="#4f6b5c" strokeWidth="3" />
      <Pfd x={230} y={170} w={360} h={330} s={s} id="ck-mfd1" />
      <Nd x={1010} y={170} w={360} h={330} s={s} title="TSD" />
      <rect x="640" y="170" width="320" height="200" rx="6" fill="#0b0d0f" stroke="#3d454b" />
      <text x="800" y="230" textAnchor="middle" className="ck-grn">UFC</text>
      <text x="800" y="275" textAnchor="middle" className="ck-grn">HDG {pad3(s.hdg)}  ALT {Math.round(s.ft)}</text>
      <text x="800" y="320" textAnchor="middle" className="ck-grn">MACH {(s.kt / 661).toFixed(2)}</text>
      <g transform={`rotate(${clampN(s.roll, -30, 30) * 0.4} 800 900)`}>
        <path d="M800 900V560" stroke="#202529" strokeWidth="30" strokeLinecap="round" />
        <rect x="772" y="510" width="56" height="90" rx="18" fill="#2c3338" />
      </g>
    </g>
  );
}

export function Cockpit({ flight, aircraft }: { flight: Flight; aircraft: Pick<Aircraft, "id" | "engine" | "name"> }) {
  const kind = cockpitKind(aircraft);
  const s = live(flight);
  return (
    <div className="cockpit-art" data-cockpit={kind} aria-label={`${aircraft.name} cockpit`}>
      <FrameSvg kind={kind} />
      {kind === "hud" && <Hud s={s} />}
      <svg className="ck-panel" viewBox="0 0 1600 560" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
        {kind === "sixpack" && <SixPack s={s} />}
        {kind === "glass" && <GlassDeck s={s} airbus={false} title={aircraft.id === "citation" ? "CITATION · PRO LINE" : `${aircraft.name.toUpperCase()} · FLIGHT DECK`} />}
        {kind === "airbus" && <GlassDeck s={s} airbus title="A320 · FBW" />}
        {kind === "heli" && <HeliPanel s={s} />}
        {kind === "hud" && <FighterPanel s={s} />}
      </svg>
    </div>
  );
}
