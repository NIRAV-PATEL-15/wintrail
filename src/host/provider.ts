import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { writeFileSync, chmodSync } from "node:fs";
import { Session, cfg } from "./session";
import { BreakHost, readBreakConfig, writeBreakConfig } from "./breaks";
import { currentContext, workspaceDirs } from "./context";
import { isValidViewMsg } from "../shared/validate";
import type { EntryView, HostMsg, ViewMsg, ViewState, YearView } from "../shared/protocol";
import { Entry, ThrottledError, VaultChangedError, WrongBackupPasswordError } from "../core/logstore";
import { WrongPasswordError } from "../core/envelope";
import { parseQuickAdd } from "../core/model";
import { heatmap, localDay, streak, yearRange, yearSummary, previousWorkday } from "../core/stats";
import { buildStandup, formatTeams } from "../core/standup";
import { gitCommits, gitEmail } from "../core/gitlog";
import { exportMarkdown } from "../core/exporter";

const toView = (e: Entry): EntryView => ({
  id: e.id, text: e.text, at: e.at, day: localDay(e.at), project: e.project, branch: e.branch,
  tags: e.tags, star: e.star, impact: e.impact, lockedAdd: e.lockedAdd,
});

const dataOf = (e: Entry) => ({ text: e.text, at: e.at, project: e.project, branch: e.branch, tags: e.tags, star: e.star, impact: e.impact });

function writePrivate(path: string, content: string) {
  writeFileSync(path, content, { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* unsupported */ }
}

/** The appraisal year `offset` years before the current one. */
export function rangeFor(offset: number, startMonth: number) {
  const cur = yearRange(Date.now(), startMonth);
  const d = new Date(cur.start);
  d.setFullYear(d.getFullYear() + offset);
  return yearRange(d.getTime(), startMonth);
}

export class WintrailViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "wintrail.dashboard";
  private view?: vscode.WebviewView;
  private yearOffset = 0;
  private pending: HostMsg[] = [];

  constructor(private readonly ctx: vscode.ExtensionContext, private readonly s: Session, private readonly breaks: BreakHost) {
    s.onDidChange(() => void this.pushState());
    breaks.onDidChange(() => void this.pushState());
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    const dist = vscode.Uri.joinPath(this.ctx.extensionUri, "dist");
    view.webview.options = { enableScripts: true, localResourceRoots: [dist, vscode.Uri.joinPath(this.ctx.extensionUri, "media")] };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((m: unknown) => void this.handle(m));
    view.onDidChangeVisibility(() => { if (view.visible) void this.pushState(); });
  }

  post(m: HostMsg) {
    if (this.view) void this.view.webview.postMessage(m);
    else this.pending.push(m);
  }

  showTab(tab: "today" | "standup" | "year") { this.post({ type: "tab", tab }); }

  async buildState(throttledMs?: number): Promise<ViewState> {
    const st = this.s.store;
    if (!st.exists()) return { screen: "setup" };
    if (!st.isUnlocked) return { screen: "locked", throttledMs, remember: cfg().rememberOnThisMachine };
    const entries = st.entries();
    const today = localDay(Date.now());
    const sm = cfg().yearStartMonth;
    const cur = yearRange(Date.now(), sm);
    const month = today.slice(0, 7);
    const range = rangeFor(this.yearOffset, sm);
    const ys = yearSummary(entries, range);
    const year: YearView = {
      offset: this.yearOffset, label: range.label, total: ys.total, projects: ys.byProject.length,
      byProject: ys.byProject.slice(0, 8), byTag: ys.byTag.slice(0, 12), highlights: ys.highlights.map(toView),
    };
    // Standup: previous workday's log, falling back to git commits.
    const prevDay = previousWorkday(today);
    const [py, pm, pd] = prevDay.split("-").map(Number);
    const since = new Date(py, pm - 1, pd).getTime(), until = new Date(py, pm - 1, pd + 1).getTime();
    const commits = entries.some((e) => localDay(e.at) === prevDay) ? [] : await this.commitsFor(prevDay, since, until);
    const plans = st.plans();
    const su = buildStandup({ entries, commits, today, branch: currentContext().branch, lastPlan: plans.find((p) => p.day === prevDay) });
    const bs = this.breaks.scheduler;
    return {
      screen: "unlocked",
      today,
      entries: entries.slice(0, 400).map(toView),
      stats: {
        streak: streak(entries, today),
        starsThisMonth: entries.filter((e) => e.star && localDay(e.at).startsWith(month)).length,
        entriesThisYear: entries.filter((e) => e.at >= cur.start && e.at < cur.end).length,
      },
      heatmap: heatmap(entries, today),
      year,
      standup: { ...su, previousDay: prevDay },
      breaks: { config: bs.config, week: bs.weekStats(), focusEndsAt: bs.focusEndsAt },
      forgedCount: st.forgedCount,
      backupWarning: this.s.backupWarning(entries.length),
      autoBackupFolder: cfg().autoBackupFolder,
    };
  }

  private commitCache: { key: string; at: number; commits: Awaited<ReturnType<typeof gitCommits>> } | null = null;
  /** Git is only consulted in trusted workspaces, only when the log has nothing for that day, and cached briefly. */
  private async commitsFor(day: string, since: number, until: number) {
    if (!vscode.workspace.isTrusted) return [];
    const dirs = workspaceDirs();
    if (!dirs.length) return [];
    const key = day + "|" + dirs.join(",");
    if (this.commitCache && this.commitCache.key === key && Date.now() - this.commitCache.at < 10 * 60_000) return this.commitCache.commits;
    const commits = await gitCommits(dirs, await gitEmail(dirs[0]), since, until);
    this.commitCache = { key, at: Date.now(), commits };
    return commits;
  }

  async pushState(throttledMs?: number) {
    if (!this.view) return;
    try {
      this.post({ type: "state", state: await this.buildState(throttledMs) });
    } catch (e) {
      if (e instanceof VaultChangedError) this.post({ type: "state", state: await this.buildState() });
    }
  }

  private find(id: string): Entry {
    const e = this.s.store.entries().find((x) => x.id === id);
    if (!e) throw new Error("Entry not found");
    return e;
  }

  /** Quick-add from anywhere (sidebar box or command). Works while locked. */
  async quickAdd(raw: string): Promise<string | undefined> {
    const q = parseQuickAdd(raw);
    if (!q.text) return;
    const { project, branch } = currentContext();
    const id = await this.s.add({ text: q.text, at: Date.now(), project, branch, tags: q.tags, star: q.star, impact: "normal" });
    this.post({ type: "added", id });
    return id;
  }

  async exportAppraisal(offset: number) {
    const range = rangeFor(offset, cfg().yearStartMonth);
    const ok = await vscode.window.showWarningMessage(
      "The appraisal export is a plain-text Markdown file. Anyone who opens it can read it.", { modal: true }, "Export");
    if (ok !== "Export") return false;
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`wintrail-appraisal-${range.label}.md`), filters: { Markdown: ["md"] },
    });
    if (!uri) return false;
    writePrivate(uri.fsPath, exportMarkdown(this.s.store.entries(), range));
    return true;
  }

  async handle(raw: unknown) {
    if (!isValidViewMsg(raw)) return;
    const m: ViewMsg = raw;
    if (m.type !== "ready") this.s.touch();
    const form = m.type;
    try {
      switch (m.type) {
        case "ready":
          for (const p of this.pending.splice(0)) this.post(p);
          this.s.store.refresh();
          await this.pushState();
          break;
        case "activity": break;
        case "create":
          if (m.password.length < 8) throw new Error("Use at least 8 characters");
          await this.s.create(m.password);
          break;
        case "unlock":
          if (m.remember !== cfg().rememberOnThisMachine) {
            await vscode.workspace.getConfiguration("wintrail").update("rememberOnThisMachine", m.remember, vscode.ConfigurationTarget.Global);
          }
          await this.s.unlock(m.password);
          break;
        case "lock": await this.s.lock(); break;
        case "quickAdd": await this.quickAdd(m.text); this.post({ type: "done", form }); break;
        case "edit": {
          const e = this.find(m.id);
          const q = parseQuickAdd(m.text);
          if (!q.text) throw new Error("Entry text can't be empty");
          await this.s.mutate(() => this.s.store.edit(e.id, { text: q.text, at: e.at, project: e.project, branch: e.branch, tags: q.tags, star: q.star || e.star, impact: e.impact }));
          this.post({ type: "done", form });
          break;
        }
        case "toggleStar": { const e = this.find(m.id); await this.s.mutate(() => this.s.store.edit(e.id, { ...dataOf(e), star: !e.star })); break; }
        case "setImpact": { const e = this.find(m.id); await this.s.mutate(() => this.s.store.edit(e.id, { ...dataOf(e), impact: m.impact })); break; }
        case "confirm": await this.s.mutate(() => this.s.store.confirm(m.id)); break;
        case "delete": {
          const e = this.find(m.id);
          const ok = await vscode.window.showWarningMessage(`Delete "${e.text.slice(0, 60)}"?`, { modal: true }, "Delete");
          if (ok === "Delete") await this.s.mutate(() => this.s.store.remove(e.id));
          break;
        }
        case "selectYear": this.yearOffset = m.offset; await this.pushState(); break;
        case "copyStandup": {
          const text = formatTeams(m);
          await vscode.env.clipboard.writeText(text);
          if (m.today.trim()) await this.s.mutate(() => this.s.store.savePlan({ day: localDay(Date.now()), text: m.today.trim() }));
          this.post({ type: "toast", text: "Standup copied — paste it into Teams", kind: "ok" });
          break;
        }
        case "exportAppraisal":
          if (await this.exportAppraisal(m.offset)) this.post({ type: "toast", text: "Appraisal export saved", kind: "ok" });
          break;
        case "copyHighlights": {
          const range = rangeFor(m.offset, cfg().yearStartMonth);
          const lines = yearSummary(this.s.store.entries(), range).highlights.slice().reverse()
            .map((e) => `• ${e.text}${e.impact === "high" ? " (high impact)" : ""}`);
          await vscode.env.clipboard.writeText(lines.join("\n") || "No highlights yet");
          this.post({ type: "toast", text: `${lines.length} highlights copied`, kind: "ok" });
          break;
        }
        case "chooseBackupFolder": await vscode.commands.executeCommand("wintrail.chooseBackupFolder"); break;
        case "backupNow": if (await this.s.backupNow(true)) this.post({ type: "toast", text: "Backed up", kind: "ok" }); break;
        case "exportBackup": await vscode.commands.executeCommand("wintrail.exportBackup"); break;
        case "importBackup": await vscode.commands.executeCommand("wintrail.importBackup"); break;
        case "changePassword":
          if (m.newPassword.length < 8) throw new Error("Use at least 8 characters");
          await this.s.changePassword(m.oldPassword, m.newPassword);
          this.post({ type: "done", form });
          this.post({ type: "toast", text: "Password changed — everything re-encrypted with new keys", kind: "ok" });
          break;
        case "setBreaks": await writeBreakConfig({ ...readBreakConfig(), ...m.config }); break;
        case "resetBreaks": await writeBreakConfig(null); break;
        case "focus": this.breaks.focus(m.minutes); break;
        case "previewBreak": this.breaks.remind(m.kind, true); break;
      }
    } catch (err) {
      if (err instanceof ThrottledError) { await this.pushState(err.waitMs); this.post({ type: "error", form, text: err.message }); return; }
      const text = err instanceof WrongPasswordError ? (form === "changePassword" ? "Current password is wrong" : "Wrong password")
        : err instanceof WrongBackupPasswordError ? "Wrong backup password"
        : (err as Error).message || String(err);
      this.post({ type: "error", form, text });
      if (err instanceof VaultChangedError || (err as Error)?.name === "VaultTamperedError") await this.pushState();
      if (!["create", "unlock", "changePassword", "edit", "quickAdd"].includes(form)) this.post({ type: "toast", text, kind: "error" });
    }
  }

  private html(w: vscode.Webview): string {
    const nonce = randomBytes(16).toString("base64");
    const js = w.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "dist", "webview.js"));
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${w.cspSource} 'unsafe-inline'; img-src ${w.cspSource} data:; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><div id="app"></div><script nonce="${nonce}" src="${js}"></script></body></html>`;
  }
}
