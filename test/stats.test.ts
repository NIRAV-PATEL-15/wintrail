import { describe, it, expect } from "vitest";
import { parseQuickAdd } from "../src/core/model";
import { localDay, streak, heatmap, yearRange, yearSummary } from "../src/core/stats";
import type { Entry } from "../src/core/logstore";

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const e = (ts: number, extra: Partial<Entry> = {}): Entry => ({
  id: String(ts) + Math.random(), text: "x", at: ts, project: "p", branch: "", tags: [], star: false,
  impact: "normal", lockedAdd: false, ...extra,
});

describe("parseQuickAdd", () => {
  it("leading ! stars, tags are lower-cased and de-duplicated, text keeps tags", () => {
    expect(parseQuickAdd("!Cut latency #perf #Perf")).toEqual({ text: "Cut latency #perf #Perf", star: true, tags: ["perf"] });
  });
  it("no star, trims, supports dashes, caps length at 500", () => {
    expect(parseQuickAdd("  Fixed bug #on-call  ")).toEqual({ text: "Fixed bug #on-call", star: false, tags: ["on-call"] });
    expect(parseQuickAdd("a".repeat(800)).text.length).toBe(500);
  });
  it("a ! not at the start is just text", () => {
    expect(parseQuickAdd("Shipped it!").star).toBe(false);
    expect(parseQuickAdd("!").text).toBe("");
  });
});

describe("streak (working days)", () => {
  it("Fri, Mon, Tue counts 3 across the weekend", () => {
    // 2026-11-20 is a Friday
    const es = [e(at(2026, 11, 20)), e(at(2026, 11, 23)), e(at(2026, 11, 24))];
    expect(streak(es, "2026-11-24")).toBe(3);
  });
  it("a gap on Wednesday resets it", () => {
    const es = [e(at(2026, 11, 17)), e(at(2026, 11, 19)), e(at(2026, 11, 20))]; // Tue, Thu, Fri
    expect(streak(es, "2026-11-20")).toBe(2);
  });
  it("today without entries yet doesn't break yesterday's streak", () => {
    const es = [e(at(2026, 11, 23)), e(at(2026, 11, 24))];
    expect(streak(es, "2026-11-25")).toBe(2);
  });
  it("no entries means 0", () => { expect(streak([], "2026-11-25")).toBe(0); });
});

describe("heatmap", () => {
  it("has 126 days ending on endDay with count levels", () => {
    const es = [
      e(at(2026, 11, 25)),
      ...Array.from({ length: 3 }, () => e(at(2026, 11, 24))),
      ...Array.from({ length: 6 }, () => e(at(2026, 11, 23))),
    ];
    const h = heatmap(es, "2026-11-25");
    expect(h).toHaveLength(126);
    expect(h[125]).toEqual({ day: "2026-11-25", count: 1, level: 1 });
    expect(h[124]).toMatchObject({ day: "2026-11-24", count: 3, level: 2 });
    expect(h[123]).toMatchObject({ day: "2026-11-23", count: 6, level: 4 });
    expect(h[0].level).toBe(0);
  });
});

describe("appraisal year", () => {
  it("startMonth 4: 15 Feb 2027 belongs to Apr 2026 – Mar 2027", () => {
    const r = yearRange(at(2027, 2, 15), 4);
    expect(new Date(r.start)).toEqual(new Date(2026, 3, 1));
    expect(new Date(r.end)).toEqual(new Date(2027, 3, 1));
    expect(r.label).toBe("2026–27");
  });
  it("startMonth 1 is the calendar year", () => {
    const r = yearRange(at(2026, 6, 1), 1);
    expect(new Date(r.start)).toEqual(new Date(2026, 0, 1));
    expect(r.label).toBe("2026");
  });
  it("summary counts by project and tag, highlights newest first, range filtered", () => {
    const es = [
      e(at(2026, 3, 1), { project: "api", tags: ["perf"], star: true, text: "old star" }),
      e(at(2026, 9, 1), { project: "api", tags: ["perf", "backend"], star: true, text: "new star" }),
      e(at(2026, 5, 1), { project: "web", tags: [] }),
      e(at(2025, 5, 1), { project: "legacy" }),
    ];
    const s = yearSummary(es, yearRange(at(2026, 6, 1), 1));
    expect(s.total).toBe(3);
    expect(s.byProject).toEqual([["api", 2], ["web", 1]]);
    expect(s.byTag).toEqual([["perf", 2], ["backend", 1]]);
    expect(s.highlights.map((x) => x.text)).toEqual(["new star", "old star"]);
  });
});
