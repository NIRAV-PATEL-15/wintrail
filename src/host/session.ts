import * as vscode from "vscode";
import { LogStore, Entry, EntryData } from "../core/logstore";
import { writeBackupFile } from "../core/backupfiles";

const KEY_SECRET = "wintrail.rememberedKey";
const REQUIRE_PW_KEY = "wintrail.requirePassword";
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
  private readonly timer: NodeJS.Timeout;
  private backupTimer?: NodeJS.Timeout;
  private mutations = 0;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.store = new LogStore(ctx.globalStorageUri.fsPath);
    this.timer = setInterval(() => this.checkAutoLock(), 10_000);
    for (const file of ["entries.jsonl", "vault.json"]) {
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(ctx.globalStorageUri, file));
      const onExternal = () => { if (this.store.isUnlocked) { this.store.refresh(); this.fire(); } };
      this.disposables.push(w, w.onDidChange(onExternal), w.onDidCreate(onExternal));
    }
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
    if (this.store.isUnlocked && mins > 0 && Date.now() - this.lastActivity > mins * 60_000) void this.lock();
  }

  async tryRememberedUnlock() {
    if (!cfg().rememberOnThisMachine || !this.store.exists()) return;
    if (this.ctx.globalState.get<boolean>(REQUIRE_PW_KEY, false)) return;
    const b64 = await this.ctx.secrets.get(KEY_SECRET);
    if (!b64) return;
    try {
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
    await this.store.create(password);
    await this.ctx.globalState.update(REQUIRE_PW_KEY, false);
    await this.syncRememberedKey();
    this.afterUnlock();
  }

  async unlock(password: string) {
    await this.store.unlock(password);
    await this.ctx.globalState.update(REQUIRE_PW_KEY, false);
    await this.syncRememberedKey();
    this.afterUnlock();
  }

  /** After a lock, the remembered key won't auto-unlock until a password unlock. */
  async lock() {
    if (!this.store.isUnlocked) return;
    this.store.lock();
    this.fire();
    await this.ctx.globalState.update(REQUIRE_PW_KEY, true);
  }

  async changePassword(oldPw: string, newPw: string) {
    await this.store.changePassword(oldPw, newPw);
    await this.syncRememberedKey();
    this.scheduleBackup();
    this.fire();
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

  backupWarning(entryCount: number): "none" | "stale" | null {
    if (entryCount === 0) return null;
    if (!cfg().autoBackupFolder) return "none";
    const last = this.ctx.globalState.get<number>(LAST_BACKUP_KEY, 0);
    return Date.now() - last > STALE_BACKUP_MS ? "stale" : null;
  }
}
