import { describe, it, expect } from "vitest";
import { BreakScheduler, DEFAULT_BREAKS, clampBreakConfig, BreakConfig } from "../src/core/breaks";

const MIN = 60_000;
function setup(cfg: Partial<BreakConfig> = {}) {
  let now = new Date(2026, 10, 25, 10, 0).getTime(); // Wed 10:00 local
  const s = new BreakScheduler(clampBreakConfig({ ...cfg }), () => now);
  /** type continuously for `minutes` (an activity event every 30s, ticking every 15s). */
  const work = (minutes: number) => {
    const fired: string[] = [];
    for (let t = 0; t < minutes * 4; t++) {
      now += 15_000;
      if (t % 2 === 0) s.activity();
      const k = s.tick();
      if (k) fired.push(k);
    }
    return fired;
  };
  return { s, work, advance: (ms: number) => { now += ms; }, nowFn: () => now };
}

describe("defaults and clamping", () => {
  it("defaults match the spec", () => {
    expect(DEFAULT_BREAKS.intervals).toEqual({ eyes: 20, stretch: 50, water: 75 });
    expect(DEFAULT_BREAKS).toMatchObject({ eyeSeconds: 20, stretchSeconds: 60, snoozeMin: 10, idleMin: 5, resetMin: 5, focusPresets: [60, 120] });
    expect(DEFAULT_BREAKS.style).toEqual({ eyes: "notification", stretch: "notification", water: "notification" });
  });
  it("clamps out-of-range values", () => {
    const c = clampBreakConfig({ intervals: { eyes: 1, stretch: 9999, water: 15 }, snoozeMin: 0, focusPresets: [5, 60, 60, 999, 120] } as never);
    expect(c.intervals).toEqual({ eyes: 5, stretch: 240, water: 15 });
    expect(c.snoozeMin).toBe(1);
    expect(c.focusPresets).toEqual([15, 60, 480]);
  });
});

describe("reminders", () => {
  it("20 minutes of activity gives the eye reminder", () => {
    const { work } = setup();
    expect(work(19)).toEqual([]);
    expect(work(2)).toEqual(["eyes"]);
  });
  it("only one reminder is pending at a time", () => {
    const { s, work } = setup();
    expect(work(21)).toEqual(["eyes"]);
    expect(work(40)).toEqual([]); // eyes still pending; stretch is due but must wait
    s.done("eyes");
    expect(work(1)).toEqual(["stretch"]);
  });
  it("idle for 6 minutes pauses accrual (but < reset keeps progress)", () => {
    const { s, work, advance } = setup({ resetMin: 10 });
    work(15);
    advance(6 * MIN);
    s.activity();
    expect(work(4)).toEqual([]); // 15 + 4 = 19 active minutes
    expect(work(2)).toEqual(["eyes"]);
  });
  it("a real break (≥ reset threshold) resets the counters", () => {
    const { s, work, advance } = setup();
    work(19);
    advance(6 * MIN); // ≥ 5 min reset
    s.activity();
    expect(work(19)).toEqual([]);
  });
  it("snooze defers by snoozeMin", () => {
    const { s, work } = setup();
    work(21);
    s.snooze("eyes");
    expect(work(9)).toEqual([]);
    expect(work(2)).toEqual(["eyes"]);
  });
  it("skip clears that reminder's progress", () => {
    const { s, work } = setup();
    work(21);
    s.skip("eyes");
    expect(work(18)).toEqual([]);
  });
  it("disabled reminders never fire", () => {
    const { work } = setup({ enabled: { eyes: false, stretch: true, water: true } });
    expect(work(30)).toEqual([]);
  });
  it("focus mode mutes until it ends", () => {
    const { s, work, nowFn } = setup();
    s.focus(nowFn() + 30 * MIN);
    expect(work(29)).toEqual([]);
    expect(work(2)).toEqual(["eyes"]);
  });
  it("outside working hours there are no reminders", () => {
    const { work } = setup({ workHours: { start: "11:00", end: "18:00" } });
    expect(work(30)).toEqual([]); // 10:00–10:30
  });
  it("waking from a 3h sleep gives no burst and resets counters", () => {
    const { s, work, advance } = setup();
    work(19);
    advance(3 * 60 * MIN);
    expect(s.tick()).toBeNull();
    s.activity();
    expect(work(19)).toEqual([]);
  });
});

describe("week stats", () => {
  it("counts reminders due and breaks taken this week, and round-trips through state", () => {
    const { s, work } = setup();
    work(21); s.done("eyes");
    work(21); s.skip("eyes");
    expect(s.weekStats().eyes).toEqual({ taken: 1, due: 2 });
    const t = new BreakScheduler(DEFAULT_BREAKS, () => Date.now());
    t.importState(s.exportState());
    expect(t.exportState()).toEqual(s.exportState());
  });
});
