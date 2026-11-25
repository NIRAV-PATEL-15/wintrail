import { execFile } from "node:child_process";

export interface Commit { subject: string; at: number; repo: string }

function run(dir: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile("git", ["-C", dir, "-c", "core.fsmonitor=false", ...args], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolve(err ? "" : String(stdout)));
  });
}

/** My commits (by author email) in [sinceTs, untilTs) across repos. Never throws: no git / not a repo / no email → []. */
export async function gitCommits(repoDirs: string[], email: string | undefined, sinceTs: number, untilTs: number): Promise<Commit[]> {
  if (!email) return [];
  const s = Math.floor(sinceTs / 1000), u = Math.floor(untilTs / 1000);
  const all = await Promise.all(repoDirs.map(async (repo) => {
    const out = await run(repo, ["log", "--all", "--no-merges", `--author=<${email}>`, `--since=@${s}`, `--until=@${u}`, "--format=%ct%x1f%s"]);
    return out.split("\n").filter(Boolean).map((line) => {
      const [ct, subject] = line.split("\x1f");
      return { subject: (subject ?? "").trim(), at: Number(ct) * 1000, repo };
    }).filter((c) => c.subject && c.at >= sinceTs && c.at < untilTs);
  }));
  return all.flat().sort((a, b) => a.at - b.at);
}

/** The user's configured git email for a repo (falls back to global). */
export async function gitEmail(dir: string): Promise<string | undefined> {
  return (await run(dir, ["config", "user.email"])).trim() || undefined;
}
