import type { Entry } from "./logstore";
import { localDay } from "./stats";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthKey = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`; };
const monthLabel = (ts: number) => { const d = new Date(ts); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

/** Appraisal export: ⭐ highlights grouped by month (oldest first), then all work grouped by project. */
export function exportMarkdown(entries: Entry[], range: { start: number; end: number; label: string }): string {
  const inRange = entries.filter((e) => e.at >= range.start && e.at < range.end).sort((a, b) => a.at - b.at);
  const out: string[] = [`# Work highlights ${range.label}`, ""];

  const stars = inRange.filter((e) => e.star);
  if (!stars.length) out.push("_No highlights starred in this period._", "");
  let current = "";
  for (const e of stars) {
    const k = monthKey(e.at);
    if (k !== current) {
      if (current) out.push("");
      out.push(`## ${monthLabel(e.at)}`);
      current = k;
    }
    const ctx = [e.project, e.tags.map((t) => `#${t}`).join(" ")].filter(Boolean).join(" · ");
    out.push(`- **${e.text}**${ctx ? ` (${ctx})` : ""}${e.impact === "high" ? " — impact: high" : ""}`);
  }
  if (stars.length) out.push("");

  out.push("# All work by project", "");
  const byProject = new Map<string, Entry[]>();
  for (const e of inRange) {
    const p = e.project || "(no project)";
    byProject.set(p, [...(byProject.get(p) ?? []), e]);
  }
  for (const [project, list] of [...byProject].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    out.push(`## ${project} (${list.length})`);
    for (const e of list) out.push(`- ${localDay(e.at)} ${e.star ? "⭐ " : ""}${e.text}`);
    out.push("");
  }
  return out.join("\n");
}
