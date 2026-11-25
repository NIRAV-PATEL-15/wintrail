// Dates are always the user's LOCAL calendar days.
import type { Entry } from "./logstore";

const pad2 = (n: number) => String(n).padStart(2, "0");

export function localDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local midnight of a YYYY-MM-DD day, as a Date. */
export function dayDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(day: string, n: number): string {
  const d = dayDate(day);
  d.setDate(d.getDate() + n);
  return localDay(d.getTime());
}

export const isWeekend = (day: string) => { const w = dayDate(day).getDay(); return w === 0 || w === 6; };

/** Previous Mon–Fri day before `day`. */
export function previousWorkday(day: string): string {
  let d = addDays(day, -1);
  while (isWeekend(d)) d = addDays(d, -1);
  return d;
}

function countByDay(entries: Pick<Entry, "at">[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) { const k = localDay(e.at); m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
}

/** Consecutive working days with ≥1 entry, ending today (or yesterday's workday if today is still empty). */
export function streak(entries: Pick<Entry, "at">[], today: string): number {
  const days = countByDay(entries);
  let d = today;
  if (isWeekend(d) || !days.has(d)) d = previousWorkday(d);
  let n = 0;
  while (days.has(d)) { n++; d = previousWorkday(d); }
  return n;
}

export type HeatLevel = 0 | 1 | 2 | 3 | 4;
const level = (c: number): HeatLevel => (c === 0 ? 0 : c === 1 ? 1 : c <= 3 ? 2 : c <= 5 ? 3 : 4);

export function heatmap(entries: Pick<Entry, "at">[], endDay: string, weeks = 18): { day: string; count: number; level: HeatLevel }[] {
  const days = countByDay(entries);
  const out: { day: string; count: number; level: HeatLevel }[] = [];
  for (let i = weeks * 7 - 1; i >= 0; i--) {
    const day = addDays(endDay, -i);
    const count = days.get(day) ?? 0;
    out.push({ day, count, level: level(count) });
  }
  return out;
}

/** The appraisal year containing `ts`, starting on the 1st of `startMonth` (1–12). */
export function yearRange(ts: number, startMonth: number): { start: number; end: number; label: string } {
  const sm = Math.min(12, Math.max(1, Math.floor(startMonth) || 1));
  const d = new Date(ts);
  const y = d.getMonth() + 1 >= sm ? d.getFullYear() : d.getFullYear() - 1;
  const start = new Date(y, sm - 1, 1).getTime();
  const end = new Date(y + 1, sm - 1, 1).getTime();
  return { start, end, label: sm === 1 ? String(y) : `${y}–${String(y + 1).slice(2)}` };
}

const topCounts = (items: string[]): [string, number][] => {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

export function yearSummary(entries: Entry[], range: { start: number; end: number }) {
  const inYear = entries.filter((e) => e.at >= range.start && e.at < range.end);
  return {
    total: inYear.length,
    byProject: topCounts(inYear.map((e) => e.project || "(no project)")),
    byTag: topCounts(inYear.flatMap((e) => e.tags)),
    highlights: inYear.filter((e) => e.star).sort((a, b) => b.at - a.at),
  };
}
