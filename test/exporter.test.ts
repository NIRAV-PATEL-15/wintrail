import { describe, it, expect } from "vitest";
import { exportMarkdown } from "../src/core/exporter";
import { yearRange } from "../src/core/stats";
import type { Entry } from "../src/core/logstore";

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();
const e = (ts: number, text: string, extra: Partial<Entry> = {}): Entry => ({
  id: text, text, at: ts, project: "api", branch: "", tags: [], star: false, impact: "normal", lockedAdd: false, ...extra,
});
const fixture = [
  e(at(2026, 3, 4), "Mentored 2 interns", { star: true, project: "team", tags: ["mentoring"] }),
  e(at(2026, 3, 10), "Fixed token race", { tags: ["bugfix"] }),
  e(at(2026, 4, 2), "Cut login latency 900ms → 120ms", { star: true, impact: "high", tags: ["perf", "backend"] }),
  e(at(2026, 4, 9), "Reviewed PRs"),
  e(at(2025, 12, 31), "Last year's work", { star: true }),
];

describe("exportMarkdown", () => {
  it("lists highlights by month (oldest first), then all work by project", () => {
    expect(exportMarkdown(fixture, yearRange(at(2026, 6, 1), 1))).toBe([
      "# Work highlights 2026",
      "",
      "## March 2026",
      "- **Mentored 2 interns** (team · #mentoring)",
      "",
      "## April 2026",
      "- **Cut login latency 900ms → 120ms** (api · #perf #backend) — impact: high",
      "",
      "# All work by project",
      "",
      "## api (3)",
      "- 2026-03-10 Fixed token race",
      "- 2026-04-02 ⭐ Cut login latency 900ms → 120ms",
      "- 2026-04-09 Reviewed PRs",
      "",
      "## team (1)",
      "- 2026-03-04 ⭐ Mentored 2 interns",
      "",
    ].join("\n"));
  });
  it("excludes entries outside the range and handles no highlights", () => {
    const md = exportMarkdown([e(at(2026, 5, 1), "Only normal work")], yearRange(at(2026, 6, 1), 1));
    expect(md).toContain("_No highlights starred in this period._");
    expect(md).not.toContain("Last year's work");
  });
});
