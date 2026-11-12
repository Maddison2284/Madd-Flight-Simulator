import { AIRPORTS, type Destination } from "./destinations";

const KEY = "mf.recentAirports";
const MAX = 6;

export function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function pushRecent(iata: string, list = readRecent()): string[] {
  if (!iata) return list;
  const next = [iata, ...list.filter((x) => x !== iata)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  return next;
}

/** Recent picks first, then the default quick airports, de-duplicated. */
export function quickAirports(recent: string[], count = 6): { airport: Destination; recent: boolean }[] {
  const byCode = new Map(AIRPORTS.map((a) => [a.iata, a]));
  const out: { airport: Destination; recent: boolean }[] = [];
  for (const code of recent) {
    const a = byCode.get(code);
    if (a && !out.some((o) => o.airport.iata === code)) out.push({ airport: a, recent: true });
  }
  for (const a of AIRPORTS) {
    if (out.length >= count) break;
    if (!out.some((o) => o.airport.iata === a.iata)) out.push({ airport: a, recent: false });
  }
  return out.slice(0, Math.max(count, out.filter((o) => o.recent).length));
}
