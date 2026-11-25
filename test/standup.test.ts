import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { previousWorkday, branchToPlan, buildStandup, formatTeams } from "../src/core/standup";
import { gitCommits } from "../src/core/gitlog";
import type { Entry } from "../src/core/logstore";

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const e = (ts: number, text: string, star = false): Entry => ({
  id: text, text, at: ts, project: "p", branch: "", tags: [], star, impact: "normal", lockedAdd: false,
});

describe("previousWorkday", () => {
  it("Monday → Friday, Sunday/Saturday → Friday, Wednesday → Tuesday", () => {
    expect(previousWorkday("2026-11-23")).toBe("2026-11-20"); // Mon
    expect(previousWorkday("2026-11-22")).toBe("2026-11-20"); // Sun
    expect(previousWorkday("2026-11-21")).toBe("2026-11-20"); // Sat
    expect(previousWorkday("2026-11-25")).toBe("2026-11-24"); // Wed
  });
});

describe("branchToPlan", () => {
  it("turns branch names into a plan line", () => {
    expect(branchToPlan("feature/payments-webhooks")).toBe("Continue payments webhooks");
    expect(branchToPlan("fix/JIRA-12-token-race")).toBe("Continue fixing token race");
    expect(branchToPlan("bugfix/login_timeout")).toBe("Continue fixing login timeout");
    expect(branchToPlan("nirav/refactor-auth")).toBe("Continue refactor auth");
    for (const b of ["main", "master", "develop", "", "HEAD"]) expect(branchToPlan(b)).toBe("");
  });
});

describe("buildStandup", () => {
  const today = "2026-11-23"; // Monday → yesterday = Friday 20th
  it("uses the previous workday's log, stars first, max 4, de-duplicated", () => {
    const s = buildStandup({
      today, branch: "feature/payments-webhooks", commits: [],
      entries: [
        e(at(2026, 11, 20, 9), "Reviewed PRs"),
        e(at(2026, 11, 20, 10), "Cut login latency 900ms → 120ms", true),
        e(at(2026, 11, 20, 11), "reviewed prs"),
        e(at(2026, 11, 20, 12), "Fixed token race"),
        e(at(2026, 11, 20, 13), "Updated docs"),
        e(at(2026, 11, 20, 14), "Paired with intern"),
        e(at(2026, 11, 19, 14), "Thursday work"),
      ],
    });
    expect(s.yesterday[0]).toBe("⭐ Cut login latency 900ms → 120ms");
    expect(s.yesterday).toHaveLength(4);
    expect(s.yesterday.filter((x) => x.toLowerCase().includes("reviewed prs"))).toHaveLength(1);
    expect(s.yesterday.join()).not.toContain("Thursday");
    expect(s.today).toBe("Continue payments webhooks");
    expect(s.blockers).toBe("None");
  });
  it("falls back to that day's commits when nothing was logged", () => {
    const s = buildStandup({ today, branch: "main", entries: [], commits: [
      { subject: "Fix flaky test", at: at(2026, 11, 20, 15), repo: "api" },
      { subject: "Old commit", at: at(2026, 11, 18, 15), repo: "api" },
    ] });
    expect(s.yesterday).toEqual(["Fix flaky test"]);
    expect(s.today).toBe("");
  });
  it("shows the plan written for the previous workday", () => {
    const s = buildStandup({ today, branch: "", entries: [], commits: [], lastPlan: { day: "2026-11-20", text: "Finish webhooks" } });
    expect(s.previousPlan).toBe("Finish webhooks");
    const t = buildStandup({ today, branch: "", entries: [], commits: [], lastPlan: { day: "2026-11-10", text: "Stale" } });
    expect(t.previousPlan).toBeUndefined();
  });
});

describe("formatTeams", () => {
  it("is short plain text with bullets", () => {
    expect(formatTeams({ yesterday: ["a", "b"], today: "t", blockers: "None" }))
      .toBe("Yesterday\n• a\n• b\nToday\n• t\nBlockers\n• None");
  });
  it("fills empty sections", () => {
    expect(formatTeams({ yesterday: [], today: "", blockers: "" }))
      .toBe("Yesterday\n• Nothing logged\nToday\n• —\nBlockers\n• None");
  });
});

describe("gitCommits", () => {
  it("returns [] for a folder that isn't a repo, a missing folder, or no email", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-nogit-"));
    expect(await gitCommits([dir, join(dir, "missing")], "me@x.com", 0, Date.now())).toEqual([]);
    expect(await gitCommits([dir], undefined, 0, Date.now())).toEqual([]);
  });
  it("reads only my commits in the time window from a real repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-git-"));
    const git = (args: string[], env: Record<string, string> = {}) =>
      execFileSync("git", ["-C", dir, ...args], { env: { ...process.env, ...env } });
    git(["init", "-q"]);
    const commit = (msg: string, email: string, when: Date) => {
      writeFileSync(join(dir, "f.txt"), msg);
      git(["add", "."]);
      const d = when.toISOString();
      git(["-c", `user.email=${email}`, "-c", "user.name=T", "commit", "-q", "-m", msg],
        { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d });
    };
    commit("Mine friday 1", "me@x.com", new Date(2026, 10, 20, 10));
    commit("Someone else", "other@x.com", new Date(2026, 10, 20, 11));
    commit("Mine friday 2", "me@x.com", new Date(2026, 10, 20, 16));
    commit("Mine monday", "me@x.com", new Date(2026, 10, 23, 9));
    const got = await gitCommits([dir], "me@x.com", new Date(2026, 10, 20).getTime(), new Date(2026, 10, 21).getTime());
    expect(got.map((c) => c.subject).sort()).toEqual(["Mine friday 1", "Mine friday 2"]);
    expect(got[0].repo).toBe(dir);
  });
});
