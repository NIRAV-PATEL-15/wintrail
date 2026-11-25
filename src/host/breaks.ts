import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { BreakConfig, BreakKind, BreakScheduler, clampBreakConfig, DEFAULT_BREAKS, BreakState } from "../core/breaks";

const STATE_KEY = "wintrail.breakState";
const TEXT: Record<BreakKind, { icon: string; title: string; body: (c: BreakConfig) => string }> = {
  eyes: { icon: "👀", title: "Eye break", body: (c) => `Look at something 20 feet away for ${c.eyeSeconds} seconds.` },
  stretch: { icon: "🧘", title: "Stretch break", body: (c) => `Stand up, roll your shoulders, stretch your wrists (${c.stretchSeconds}s).` },
  water: { icon: "💧", title: "Hydration check", body: () => "Grab a glass of water." },
};

/** Read every wintrail.breaks.* setting into a clamped BreakConfig. */
export function readBreakConfig(): BreakConfig {
  const c = vscode.workspace.getConfiguration("wintrail.breaks");
  const k = <T>(kind: BreakKind, f: string, d: T) => c.get<T>(`${kind}.${f}`, d);
  const ws = c.get<string>("workHours.start", ""), we = c.get<string>("workHours.end", "");
  return clampBreakConfig({
    intervals: { eyes: k("eyes", "interval", 20), stretch: k("stretch", "interval", 50), water: k("water", "interval", 75) },
    enabled: { eyes: k("eyes", "enabled", true), stretch: k("stretch", "enabled", true), water: k("water", "enabled", true) },
    style: { eyes: k("eyes", "style", "notification"), stretch: k("stretch", "style", "notification"), water: k("water", "style", "notification") },
    eyeSeconds: c.get("eyeSeconds", 20), stretchSeconds: c.get("stretchSeconds", 60), snoozeMin: c.get("snoozeMinutes", 10),
    idleMin: c.get("idleMinutes", 5), resetMin: c.get("resetMinutes", 5), focusPresets: c.get("focusPresets", [60, 120]),
    ...(ws && we ? { workHours: { start: ws, end: we } } : {}),
  });
}

/** Write a config (null = reset to defaults) to the user's settings. Missing workHours = no working hours. */
export async function writeBreakConfig(p: Partial<BreakConfig> | null) {
  const c = vscode.workspace.getConfiguration("wintrail.breaks");
  const g = vscode.ConfigurationTarget.Global;
  const reset = p === null;
  const base = readBreakConfig();
  delete base.workHours;
  const cfg = p ? clampBreakConfig({ ...base, ...p }) : DEFAULT_BREAKS;
  const set = (key: string, v: unknown) => c.update(key, reset ? undefined : v, g);
  for (const kind of ["eyes", "stretch", "water"] as BreakKind[]) {
    await set(`${kind}.interval`, cfg.intervals[kind]);
    await set(`${kind}.enabled`, cfg.enabled[kind]);
    await set(`${kind}.style`, cfg.style[kind]);
  }
  await set("eyeSeconds", cfg.eyeSeconds); await set("stretchSeconds", cfg.stretchSeconds);
  await set("snoozeMinutes", cfg.snoozeMin); await set("idleMinutes", cfg.idleMin); await set("resetMinutes", cfg.resetMin);
  await set("focusPresets", cfg.focusPresets);
  await set("workHours.start", cfg.workHours?.start ?? "");
  await set("workHours.end", cfg.workHours?.end ?? "");
}

export class BreakHost implements vscode.Disposable {
  readonly scheduler: BreakScheduler;
  private readonly timer: NodeJS.Timeout;
  private readonly bar: vscode.StatusBarItem;
  private readonly subs: vscode.Disposable[] = [];
  private panel?: vscode.WebviewPanel;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.scheduler = new BreakScheduler(readBreakConfig());
    this.scheduler.importState(ctx.globalState.get<BreakState>(STATE_KEY));
    const act = () => this.scheduler.activity();
    this.subs.push(
      vscode.workspace.onDidChangeTextDocument((e) => { if (e.document.uri.scheme !== "output") act(); }),
      vscode.window.onDidChangeTextEditorSelection(act),
      vscode.window.onDidChangeWindowState((s) => { if (s.focused) act(); }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("wintrail.breaks")) { this.scheduler.setConfig(readBreakConfig()); this.render(); this.changed.fire(); }
      }),
    );
    this.timer = setInterval(() => this.tick(), 15_000);
    this.bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    this.bar.command = "wintrail.focus";
    this.render();
    this.bar.show();
  }

  dispose() {
    clearInterval(this.timer);
    this.bar.dispose();
    this.panel?.dispose();
    this.subs.forEach((s) => s.dispose());
    this.changed.dispose();
  }

  private save() { void this.ctx.globalState.update(STATE_KEY, this.scheduler.exportState()); this.changed.fire(); }

  render() {
    const f = this.scheduler.focusEndsAt;
    if (f) {
      const mins = Math.max(1, Math.round((f - Date.now()) / 60_000));
      this.bar.text = `$(bell-slash) Focus ${mins}m`;
      this.bar.tooltip = "Wintrail: break reminders muted — click to end focus mode";
    } else {
      this.bar.text = "$(bell) Breaks";
      this.bar.tooltip = "Wintrail Break Buddy — click to start focus mode";
    }
  }

  private tick() {
    const kind = this.scheduler.tick();
    this.render();
    if (kind) this.remind(kind);
  }

  /** Show a reminder in the configured style. */
  remind(kind: BreakKind, preview = false) {
    const cfg = this.scheduler.config;
    if (cfg.style[kind] === "screen") return this.openScreen(kind, preview);
    const t = TEXT[kind];
    const snooze = `Snooze ${cfg.snoozeMin} min`;
    void vscode.window.showInformationMessage(`${t.icon} ${t.title}: ${t.body(cfg)}`, "Done", snooze, "Skip").then((choice) => {
      if (preview) return;
      if (choice === "Done") this.scheduler.done(kind);
      else if (choice === "Skip") this.scheduler.skip(kind);
      else this.scheduler.snooze(kind); // snooze button or dismissed
      this.save();
    });
  }

  focus(minutes: number) {
    this.scheduler.focus(minutes > 0 ? Date.now() + minutes * 60_000 : null);
    this.render();
    this.changed.fire();
  }

  private openScreen(kind: BreakKind, preview: boolean) {
    const cfg = this.scheduler.config;
    this.panel?.dispose();
    const panel = vscode.window.createWebviewPanel("wintrail.break", `${TEXT[kind].icon} ${TEXT[kind].title}`, vscode.ViewColumn.Active, {
      enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "dist")],
    });
    this.panel = panel;
    const nonce = randomBytes(16).toString("base64");
    const js = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "dist", "break.js"));
    const seconds = kind === "eyes" ? cfg.eyeSeconds : kind === "stretch" ? cfg.stretchSeconds : 15;
    const data = JSON.stringify({ kind, seconds, title: TEXT[kind].title, body: TEXT[kind].body(cfg), icon: TEXT[kind].icon, snoozeMin: cfg.snoozeMin });
    panel.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
</head><body><div id="app" data-break='${data.replace(/'/g, "&#39;")}'></div><script nonce="${nonce}" src="${js}"></script></body></html>`;
    let settled = false;
    panel.webview.onDidReceiveMessage((m: { type?: string }) => {
      if (preview || settled) { panel.dispose(); return; }
      settled = true;
      if (m?.type === "done") this.scheduler.done(kind);
      else if (m?.type === "skip") this.scheduler.skip(kind);
      else this.scheduler.snooze(kind);
      this.save();
      panel.dispose();
    });
    panel.onDidDispose(() => {
      if (!preview && !settled) { this.scheduler.snooze(kind); this.save(); }
      if (this.panel === panel) this.panel = undefined;
    });
  }
}
