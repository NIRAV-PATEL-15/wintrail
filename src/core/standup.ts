import type { Entry, Plan } from "./logstore";
import type { Commit } from "./gitlog";
import { localDay, previousWorkday } from "./stats";

export { previousWorkday } from "./stats";

const TRUNK = new Set(["", "main", "master", "develop", "dev", "head", "trunk"]);
const FIX = new Set(["fix", "bugfix", "hotfix", "bug"]);
const MAX_BULLETS = 4;

/** "feature/payments-webhooks" → "Continue payments webhooks"; "fix/JIRA-12-token-race" → "Continue fixing token race". */
export function branchToPlan(branch: string): string {
  const b = String(branch ?? "").trim();
  if (TRUNK.has(b.toLowerCase())) return "";
  const parts = b.split("/");
  const kind = parts.length > 1 ? parts[0].toLowerCase() : "";
  const words = parts[parts.length - 1]
    .replace(/^[A-Za-z]+-\d+[-_]?/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!words) return "";
  return FIX.has(kind) ? `Continue fixing ${words}` : `Continue ${words}`;
}

export interface Standup { yesterday: string[]; today: string; blockers: string; previousPlan?: string }

export function buildStandup(input: { entries: Entry[]; commits: Commit[]; today: string; branch: string; lastPlan?: Plan }): Standup {
  const prev = previousWorkday(input.today);
  const logged = input.entries.filter((e) => localDay(e.at) === prev)
    .sort((a, b) => Number(b.star) - Number(a.star) || a.at - b.at)
    .map((e) => (e.star ? `⭐ ${e.text}` : e.text));
  const source = logged.length ? logged
    : input.commits.filter((c) => localDay(c.at) === prev).map((c) => c.subject);
  const seen = new Set<string>();
  const yesterday: string[] = [];
  for (const line of source) {
    const key = line.replace(/^⭐ /, "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    yesterday.push(line.trim());
    if (yesterday.length === MAX_BULLETS) break;
  }
  return {
    yesterday,
    today: branchToPlan(input.branch),
    blockers: "None",
    previousPlan: input.lastPlan && input.lastPlan.day === prev ? input.lastPlan.text : undefined,
  };
}

export function formatTeams(s: Pick<Standup, "yesterday" | "today" | "blockers">): string {
  const y = s.yesterday.length ? s.yesterday : ["Nothing logged"];
  return [
    "Yesterday", ...y.map((l) => `• ${l}`),
    "Today", `• ${s.today.trim() || "—"}`,
    "Blockers", `• ${s.blockers.trim() || "None"}`,
  ].join("\n");
}
