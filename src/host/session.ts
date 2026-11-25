import * as vscode from "vscode";
import { writeFileSync, statSync, mkdirSync, watch } from "node:fs";
import { join } from "node:path";
import { LogStore, Entry, EntryData, PubPin } from "../core/logstore";
import { writeBackupFile } from "../core/backupfiles";

const KEY_SECRET = "wintrail.rememberedKey";
const PIN_KEY = "wintrail.pinnedPublicKey";
const LOCK_SIGNAL = "lock-signal";
const LAST_BACKUP_KEY = "wintrail.lastBackupAt";
const STALE_BACKUP_MS = 30 * 86_400_000;

export function cfg() {
  const c = vscode.workspace.getConfiguration("wintrail");
  return {
    autoLockMinutes: c.get<number>("autoLockMinutes", 15),
    rememberOnThisMachine: c.get<boolean>("rememberOnThisMachine", false),
    autoBackupFolder: c.get<string>("autoBackupFolder", ""),
    backupKeep: Math.max(1, c.get<number>("backupKeep", 10)),
    yearStartMonth: Math.min(12, Math.max(1, c.get<number>("yearStartMonth", 1))),
  };
}

/** Owns the log's lifecycle: lock state, auto-lock, remembered key, other windows, auto-backup. */
export class Session implements vscode.Disposable {
  readonly store: LogStore;
  private lastActivity = Date.now();
  private unlockedAt = 0;
  private get lockSignalPath() { return join(this.ctx.globalStorageUri.fsPath, LOCK_SIGNAL); }
  private readonly timer: NodeJS.Timeout;
  private backupTimer?: NodeJS.Timeout;
  private mutations = 0;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly ctx: vscode.ExtensionContext) {
    const pin: PubPin = { get: () => ctx.globalState.get<string>(PIN_KEY), set: async (p) => { await ctx.globalState.update(PIN_KEY, p); } };
    this.store = new LogStore(ctx.globalStorageUri.fsPath, undefined, Date.now, pin);
    // Poll as a fallback (fs.watch can miss events on some filesystems); every 2s is cheap.
    this.timer = setInterval(() => { this.checkAutoLock(); this.checkLockSignal(); }, 2_000);
    // VS Code's FileSystemWatcher is unreliable outside the workspace, so watch the storage folder directly.
    try {
      mkdirSync(ctx.globalStorageUri.fsPath, { recursive: true });
      const w = watch(ctx.globalStorageUri.fsPath, (_ev, file) => {
        const f = String(file ?? "");
        if (f === LOCK_SIGNAL) this.checkLockSignal();
        else if ((f === "entries.jsonl" || f === "vault.json") && this.store.isUnlocked) {
          clearTimeout(this.refreshTimer);
          this.refreshTimer = setTimeout(() => { this.store.refresh(); this.fire(); }, 150);
        }
      });
      this.disposables.push({ dispose: () => w.close() });
    } catch { /* polling still covers the lock signal */ }
  }
  private refreshTimer?: NodeJS.Timeout;

  /** "Lock" in any window locks every window (newer than this window's last unlock). */
  private checkLockSignal() {
    if (!this.store.isUnlocked) return;
    try {
      if (statSync(this.lockSignalPath).mtimeMs > this.unlockedAt) { this.store.lock(); this.fire(); }
    } catch { /* no signal yet */ }
  }

  dispose() {
    clearInterval(this.timer);
    if (this.backupTimer) clearTimeout(this.backupTimer);
    this.disposables.forEach((d) => d.dispose());
    this.store.lock();
    this.changed.dispose();
  }

  touch() { this.lastActivity = Date.now(); }
  fire() { this.changed.fire(); }

  private checkAutoLock() {
    const mins = cfg().autoLockMinutes;
    if (this.store.isUnlocked && mins > 0 && Date.now() - this.lastActivity > mins * 60_000) void this.lock(false);
  }

  async tryRememberedUnlock() {
    if (!cfg().rememberOnThisMachine || !this.store.exists()) return;
    const b64 = await this.ctx.secrets.get(KEY_SECRET);
    if (!b64) return;
    try {
      this.unlockedAt = Date.now() + 1; // only lock signals written after this count
      await this.store.unlockWithKey(Buffer.from(b64, "base64"));
      this.afterUnlock();
    } catch {
      await this.ctx.secrets.delete(KEY_SECRET);
    }
  }

  async syncRememberedKey() {
    if (cfg().rememberOnThisMachine && this.store.isUnlocked) {
      await this.ctx.secrets.store(KEY_SECRET, this.store.exportWrapKey().toString("base64"));
    } else if (!cfg().rememberOnThisMachine) {
      await this.ctx.secrets.delete(KEY_SECRET);
    }
  }

  private afterUnlock() {
    this.touch();
    void this.store.compactIfNeeded().catch(() => undefined);
    this.fire();
  }

  async create(password: string) {
    this.unlockedAt = Date.now() + 1; // only lock signals written after this count
    await this.store.create(password);
    await this.syncRememberedKey();
    this.afterUnlock();
  }

  async unlock(password: string) {
    this.unlockedAt = Date.now() + 1; // only lock signals written after this count
    await this.store.unlock(password);
    await this.syncRememberedKey();
    this.afterUnlock();
  }

  /** Lock this window and every other window. The remembered key is deleted (not just flagged),
   *  so only a password unlock brings it back. Auto-lock (`everywhere=false`) only locks this window. */
  async lock(everywhere = true) {
    const was = this.store.isUnlocked;
    this.store.lock();
    if (was) this.fire();
    await this.ctx.secrets.delete(KEY_SECRET);
    if (everywhere) {
      try { mkdirSync(this.ctx.globalStorageUri.fsPath, { recursive: true }); writeFileSync(this.lockSignalPath, String(Date.now()), { mode: 0o600 }); } catch { /* ignore */ }
    }
  }

  async changePassword(oldPw: string, newPw: string) {
    await this.store.changePassword(oldPw, newPw);
    await this.syncRememberedKey();
    this.fire();
    void this.offerToPruneOldBackups();
  }

  /** Quick-add: works while locked. */
  async add(data: EntryData): Promise<string> {
    const id = await this.store.add(data);
    this.afterMutation();
    return id;
  }

  /** Mutations that need the unlocked log. */
  async mutate(fn: () => Promise<unknown>) {
    this.touch();
    try {
      await fn();
    } finally {
      this.afterMutation();
    }
  }

  private afterMutation() {
    this.mutations++;
    if (this.store.isUnlocked && this.mutations % 50 === 0) void this.store.compactIfNeeded().catch(() => undefined);
    this.scheduleBackup();
    this.fire();
  }

  entries(): Entry[] { return this.store.isUnlocked ? this.store.entries() : []; }

  // ---- backups ----
  private scheduleBackup() {
    if (!cfg().autoBackupFolder) return;
    if (this.backupTimer) clearTimeout(this.backupTimer);
    this.backupTimer = setTimeout(() => void this.backupNow(false), 5_000);
  }

  /** Backups are the already-encrypted files; they open with the master password. */
  async backupNow(force: boolean): Promise<string | undefined> {
    const { autoBackupFolder, backupKeep } = cfg();
    if (!autoBackupFolder) {
      if (force) throw new Error("Choose an auto-backup folder first");
      return;
    }
    if (!this.store.exists()) return;
    try {
      const file = writeBackupFile(autoBackupFolder, this.store.exportBackup(), backupKeep);
      await this.ctx.globalState.update(LAST_BACKUP_KEY, Date.now());
      this.fire();
      return file;
    } catch (e) {
      void vscode.window.showWarningMessage(`Wintrail auto-backup failed: ${(e as Error).message}`);
      if (force) throw e;
    }
  }

  /** After a password change, older auto-backups still open with the OLD password. */
  async offerToPruneOldBackups() {
    const folder = cfg().autoBackupFolder;
    if (!folder) return;
    const choice = await vscode.window.showWarningMessage(
      "Your older Wintrail backups still open with the OLD password. If someone may know it, delete them.",
      "Delete older backups", "Keep");
    if (choice !== "Delete older backups") return;
    const { readdirSync, unlinkSync } = await import("node:fs");
    const ours = readdirSync(folder).filter((f) => /^wintrail-\d{8}-\d{6}\.wintrail$/.test(f));
    for (const f of ours) { try { unlinkSync(join(folder, f)); } catch { /* ignore */ } }
    await this.backupNow(true);
    void vscode.window.showInformationMessage(`Deleted ${ours.length} older backup(s); a fresh backup was saved.`);
  }

  backupWarning(entryCount: number): "none" | "stale" | null {
    if (entryCount === 0) return null;
    if (!cfg().autoBackupFolder) return "none";
    const last = this.ctx.globalState.get<number>(LAST_BACKUP_KEY, 0);
    return Date.now() - last > STALE_BACKUP_MS ? "stale" : null;
  }
}
