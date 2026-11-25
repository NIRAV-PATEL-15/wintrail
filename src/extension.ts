import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import { Session } from "./host/session";
import { BreakHost } from "./host/breaks";
import { WintrailViewProvider } from "./host/provider";
import { WrongPasswordError } from "./core/envelope";

export async function activate(ctx: vscode.ExtensionContext) {
  const s = new Session(ctx);
  const breaks = new BreakHost(ctx);
  const view = new WintrailViewProvider(ctx, s, breaks);
  ctx.subscriptions.push(s, breaks, vscode.window.registerWebviewViewProvider(WintrailViewProvider.viewId, view));
  ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("wintrail")) { void s.syncRememberedKey(); s.fire(); }
  }));

  const focusView = () => vscode.commands.executeCommand(`${WintrailViewProvider.viewId}.focus`);
  const ensureUnlocked = async (): Promise<boolean> => {
    if (s.store.isUnlocked) return true;
    if (!s.store.exists()) { await focusView(); return false; }
    const pw = await vscode.window.showInputBox({ prompt: "Wintrail password", password: true, ignoreFocusOut: true });
    if (!pw) return false;
    try { await s.unlock(pw); return true; } catch (e) {
      void vscode.window.showErrorMessage(e instanceof WrongPasswordError ? "Wrong password" : (e as Error).message);
      return false;
    }
  };
  const reg = (id: string, fn: () => unknown) => ctx.subscriptions.push(vscode.commands.registerCommand(id, async () => {
    try { s.touch(); await fn(); } catch (e) { void vscode.window.showErrorMessage(`Wintrail: ${(e as Error).message}`); }
  }));

  reg("wintrail.open", focusView);
  reg("wintrail.quickAdd", async () => {
    if (!s.store.exists()) { await focusView(); void vscode.window.showInformationMessage("Set a Wintrail password first."); return; }
    const text = await vscode.window.showInputBox({
      prompt: "What did you just finish?", placeHolder: "!Cut login latency 900ms → 120ms #perf   (! = highlight ⭐, #tags)",
      ignoreFocusOut: true, validateInput: (v) => (v.length > 500 ? "Keep it under 500 characters" : undefined),
    });
    if (text?.trim()) {
      await view.quickAdd(text);
      vscode.window.setStatusBarMessage(`$(check) Logged${text.trim().startsWith("!") ? " ⭐" : ""}`, 2500);
    }
  });
  reg("wintrail.unlock", async () => { if (await ensureUnlocked()) await focusView(); });
  reg("wintrail.lock", () => s.lock());
  reg("wintrail.writeStandup", async () => { if (await ensureUnlocked()) { await focusView(); view.showTab("standup"); } });
  reg("wintrail.exportAppraisal", async () => { if (await ensureUnlocked()) await view.exportAppraisal(0); });
  reg("wintrail.exportBackup", async () => {
    if (!s.store.exists()) return;
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`wintrail-backup-${new Date().toISOString().slice(0, 10)}.wintrail`), filters: { "Wintrail backup": ["wintrail"] },
    });
    if (uri) { await vscode.workspace.fs.writeFile(uri, Buffer.from(s.store.exportBackup())); void vscode.window.showInformationMessage("Encrypted backup saved. It opens with your current Wintrail password."); }
  });
  reg("wintrail.importBackup", async () => {
    if (!(await ensureUnlocked())) return;
    const uris = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { "Wintrail backup": ["wintrail", "json"] } });
    if (!uris?.length) return;
    const text = readFileSync(uris[0].fsPath, "utf8");
    const pw = await vscode.window.showInputBox({ prompt: "Password of that backup (the Wintrail password when it was made)", password: true, ignoreFocusOut: true });
    if (!pw) return;
    let r = { added: 0, skipped: 0 };
    await s.mutate(async () => { r = await s.store.importMerge(text, pw); });
    void vscode.window.showInformationMessage(`Imported ${r.added} entries${r.skipped ? `, ${r.skipped} already present` : ""}. Your previous log was backed up first.`);
  });
  reg("wintrail.chooseBackupFolder", async () => {
    const uris = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, openLabel: "Use for Wintrail backups" });
    if (!uris?.length) return;
    await vscode.workspace.getConfiguration("wintrail").update("autoBackupFolder", uris[0].fsPath, vscode.ConfigurationTarget.Global);
    await s.backupNow(true);
    void vscode.window.showInformationMessage("Auto-backup on: an encrypted copy is saved there after every change.");
  });
  reg("wintrail.changePassword", async () => {
    if (!(await ensureUnlocked())) return;
    const oldPw = await vscode.window.showInputBox({ prompt: "Current Wintrail password", password: true, ignoreFocusOut: true });
    if (!oldPw) return;
    const newPw = await vscode.window.showInputBox({ prompt: "New password (min 8 characters)", password: true, ignoreFocusOut: true, validateInput: (v) => (v.length < 8 ? "Use at least 8 characters" : undefined) });
    if (!newPw) return;
    if ((await vscode.window.showInputBox({ prompt: "Repeat new password", password: true, ignoreFocusOut: true })) !== newPw) {
      void vscode.window.showErrorMessage("Passwords don't match"); return;
    }
    await s.changePassword(oldPw, newPw);
    void vscode.window.showInformationMessage("Password changed. Everything was re-encrypted with new keys.");
  });
  reg("wintrail.focus", async () => {
    if (breaks.scheduler.focusEndsAt) { breaks.focus(0); vscode.window.setStatusBarMessage("$(bell) Break reminders back on", 2500); return; }
    const presets = breaks.scheduler.config.focusPresets;
    const pick = await vscode.window.showQuickPick(
      [...presets.map((m) => ({ label: `$(bell-slash) Focus for ${m >= 60 && m % 60 === 0 ? `${m / 60} h` : `${m} min`}`, minutes: m })),
        { label: "$(bell-slash) Focus until I turn it off", minutes: 24 * 60 }],
      { placeHolder: "Mute break reminders for…" });
    if (pick) breaks.focus(pick.minutes);
  });

  await s.tryRememberedUnlock();
  return { session: s, breaks, view }; // used by the integration test
}

export function deactivate() {}
