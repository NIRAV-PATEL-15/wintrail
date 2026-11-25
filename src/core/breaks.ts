// Break Buddy: reminds based on ACTIVE coding time, one reminder at a time, never in a burst.
export type BreakKind = "eyes" | "stretch" | "water";
export const BREAK_KINDS: BreakKind[] = ["stretch", "eyes", "water"]; // priority order when several are due
export type BreakStyle = "notification" | "screen";

export interface BreakConfig {
  intervals: Record<BreakKind, number>; // minutes of active time
  enabled: Record<BreakKind, boolean>;
  style: Record<BreakKind, BreakStyle>;
  eyeSeconds: number;
  stretchSeconds: number;
  snoozeMin: number;
  idleMin: number; // stop counting after this long without activity
  resetMin: number; // a gap this long counts as a real break
  focusPresets: number[]; // minutes
  workHours?: { start: string; end: string }; // "HH:MM" local
}

export const DEFAULT_BREAKS: BreakConfig = {
  intervals: { eyes: 20, stretch: 50, water: 75 },
  enabled: { eyes: true, stretch: true, water: true },
  style: { eyes: "notification", stretch: "notification", water: "notification" },
  eyeSeconds: 20,
  stretchSeconds: 60,
  snoozeMin: 10,
  idleMin: 5,
  resetMin: 5,
  focusPresets: [60, 120],
};

export const BREAK_RANGES = {
  intervals: { eyes: [5, 120], stretch: [10, 240], water: [15, 240] },
  eyeSeconds: [10, 120], stretchSeconds: [30, 600], snoozeMin: [1, 60], idleMin: [1, 30], resetMin: [1, 60], focusPreset: [15, 480],
} as const;

const clamp = (v: unknown, [lo, hi]: readonly [number, number], d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function clampBreakConfig(p: Partial<BreakConfig>): BreakConfig {
  const d = DEFAULT_BREAKS;
  const kinds = (f: (k: BreakKind) => unknown) => ({ eyes: f("eyes"), stretch: f("stretch"), water: f("water") });
  const presets = [...new Set((Array.isArray(p.focusPresets) ? p.focusPresets : d.focusPresets)
    .map((v) => clamp(v, BREAK_RANGES.focusPreset, 60)))].slice(0, 3);
  const wh = p.workHours && HHMM.test(p.workHours.start) && HHMM.test(p.workHours.end) ? { ...p.workHours } : undefined;
  return {
    intervals: kinds((k) => clamp(p.intervals?.[k], BREAK_RANGES.intervals[k], d.intervals[k])) as Record<BreakKind, number>,
    enabled: kinds((k) => (typeof p.enabled?.[k] === "boolean" ? p.enabled[k] : d.enabled[k])) as Record<BreakKind, boolean>,
    style: kinds((k) => (p.style?.[k] === "screen" ? "screen" : "notification")) as Record<BreakKind, BreakStyle>,
    eyeSeconds: clamp(p.eyeSeconds, BREAK_RANGES.eyeSeconds, d.eyeSeconds),
    stretchSeconds: clamp(p.stretchSeconds, BREAK_RANGES.stretchSeconds, d.stretchSeconds),
    snoozeMin: clamp(p.snoozeMin, BREAK_RANGES.snoozeMin, d.snoozeMin),
    idleMin: clamp(p.idleMin, BREAK_RANGES.idleMin, d.idleMin),
    resetMin: clamp(p.resetMin, BREAK_RANGES.resetMin, d.resetMin),
    focusPresets: presets.length ? presets : [...d.focusPresets],
    ...(wh ? { workHours: wh } : {}),
  };
}

interface BreakEvent { kind: BreakKind; type: "due" | "taken"; at: number }
export interface BreakState { events: BreakEvent[] }

const MIN = 60_000;
const minutesOfDay = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

export class BreakScheduler {
  private accrued: Record<BreakKind, number> = { eyes: 0, stretch: 0, water: 0 };
  private snoozedUntil: Record<BreakKind, number> = { eyes: 0, stretch: 0, water: 0 };
  private pending: BreakKind | null = null;
  private lastActivity: number | null = null;
  private lastTick: number | null = null;
  private focusUntil: number | null = null;
  private events: BreakEvent[] = [];

  constructor(private cfg: BreakConfig, private readonly now: () => number = Date.now) {}

  setConfig(cfg: BreakConfig) { this.cfg = cfg; }
  get config(): BreakConfig { return this.cfg; }
  get pendingKind(): BreakKind | null { return this.pending; }
  get focusEndsAt(): number | null { return this.focusUntil && this.focusUntil > this.now() ? this.focusUntil : null; }

  private resetAll() {
    this.accrued = { eyes: 0, stretch: 0, water: 0 };
    this.pending = null;
  }

  /** Call on edits, selection changes and window focus. */
  activity() {
    const now = this.now();
    if (this.lastActivity !== null) {
      const gap = now - this.lastActivity;
      if (gap >= this.cfg.resetMin * MIN) this.resetAll();
      else if (gap < this.cfg.idleMin * MIN) for (const k of BREAK_KINDS) this.accrued[k] += gap;
    }
    this.lastActivity = now;
  }

  private inWorkHours(now: number): boolean {
    if (!this.cfg.workHours) return true;
    const d = new Date(now);
    const m = d.getHours() * 60 + d.getMinutes();
    const s = minutesOfDay(this.cfg.workHours.start), e = minutesOfDay(this.cfg.workHours.end);
    return s <= e ? m >= s && m < e : m >= s || m < e; // supports overnight shifts
  }

  /** Call every ~15s. Returns a newly due reminder, or null. */
  tick(): BreakKind | null {
    const now = this.now();
    // Sleep/resume or a long absence counts as a break: no burst afterwards.
    const sinceTick = this.lastTick === null ? 0 : now - this.lastTick;
    const sinceActivity = this.lastActivity === null ? 0 : now - this.lastActivity;
    this.lastTick = now;
    if (sinceTick >= this.cfg.resetMin * MIN || sinceActivity >= this.cfg.resetMin * MIN) {
      this.resetAll();
      if (sinceTick >= this.cfg.resetMin * MIN) this.lastActivity = null;
      return null;
    }
    if (this.pending) return null;
    if (this.focusUntil !== null && now < this.focusUntil) return null;
    if (!this.inWorkHours(now)) return null;
    for (const k of BREAK_KINDS) {
      if (!this.cfg.enabled[k] || this.snoozedUntil[k] > now) continue;
      if (this.accrued[k] >= this.cfg.intervals[k] * MIN) {
        this.pending = k;
        this.record(k, "due");
        return k;
      }
    }
    return null;
  }

  private record(kind: BreakKind, type: BreakEvent["type"]) {
    const now = this.now();
    this.events.push({ kind, type, at: now });
    this.events = this.events.filter((e) => now - e.at < 15 * 24 * 60 * MIN);
  }

  done(kind: BreakKind) {
    this.accrued[kind] = 0;
    if (kind === "stretch") this.accrued.eyes = 0; // a stretch break rests the eyes too
    this.record(kind, "taken");
    if (this.pending === kind) this.pending = null;
  }
  snooze(kind: BreakKind) {
    this.snoozedUntil[kind] = this.now() + this.cfg.snoozeMin * MIN;
    if (this.pending === kind) this.pending = null;
  }
  skip(kind: BreakKind) {
    this.accrued[kind] = 0;
    if (this.pending === kind) this.pending = null;
  }
  focus(untilTs: number | null) { this.focusUntil = untilTs; }

  /** Since Monday 00:00 local. */
  weekStats(): Record<BreakKind, { taken: number; due: number }> {
    const d = new Date(this.now());
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const since = d.getTime();
    const out = { eyes: { taken: 0, due: 0 }, stretch: { taken: 0, due: 0 }, water: { taken: 0, due: 0 } };
    for (const e of this.events) if (e.at >= since) out[e.kind][e.type === "due" ? "due" : "taken"]++;
    return out;
  }

  exportState(): BreakState { return { events: this.events.map((e) => ({ ...e })) }; }
  importState(s: BreakState | undefined) {
    if (!s || !Array.isArray(s.events)) return;
    this.events = s.events.filter((e) => e && BREAK_KINDS.includes(e.kind) && (e.type === "due" || e.type === "taken") && Number.isFinite(e.at));
  }
}
