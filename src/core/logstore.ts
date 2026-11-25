// Wintrail's encrypted, append-only work log.
//   vault.json     WrappedKeys: X25519 public key (plaintext), private key + MAC key (wrapped by Argon2id(password))
//   entries.jsonl  one sealed record per line; see records.ts
// Adding needs only the public key, so it works while locked. Reading needs the password.
// Edits/deletes/confirms/plans carry a MAC that only an unlocked session can produce.
import { copyFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_KDF, KdfCost, WrongPasswordError, deriveKey } from "./envelope";
import { Opener, WrappedKeys, generateKeys, isWrappedKeys, makeOpener, unwrapKeys, unwrapWithKey, wrapKeys } from "./keys";
import { EntryData, Plan, Rec, decodeLine, encodeRecord } from "./records";
import { appendDurable, withFileLock, writeDurable } from "./fsutil";

export type { EntryData, Plan } from "./records";
export interface Entry extends EntryData { id: string; lockedAdd: boolean }

export class LockedError extends Error {
  constructor() { super("Wintrail is locked"); this.name = "LockedError"; }
}
export class ThrottledError extends Error {
  constructor(public waitMs: number) {
    super(`Too many attempts. Try again in ${Math.ceil(waitMs / 1000)}s`);
    this.name = "ThrottledError";
  }
}
export class VaultChangedError extends Error {
  constructor() {
    super("Your Wintrail password was changed in another window. Unlock again with the new password.");
    this.name = "VaultChangedError";
  }
}
export class WrongBackupPasswordError extends Error {
  constructor() { super("Wrong backup password"); this.name = "WrongBackupPasswordError"; }
}

const FREE_ATTEMPTS = 3;
const MAX_PLANS_KEPT = 60;

interface Keys { pub: string; opener: Opener; macKey: Buffer; wrapKey: Buffer }
interface State {
  entries: Map<string, { data: EntryData; locked: boolean; deleted: boolean }>;
  plans: Map<string, string>;
  forged: number;
  lines: number;
}
const emptyState = (): State => ({ entries: new Map(), plans: new Map(), forged: 0, lines: 0 });

/** Apply one decoded record to the state (replay rules from the design). */
function applyRecord(st: State, rec: Rec, authentic: boolean) {
  switch (rec.kind) {
    case "add":
      if (typeof rec.id !== "string" || st.entries.has(rec.id) || !rec.data) return;
      st.entries.set(rec.id, { data: rec.data, locked: authentic ? !!rec.locked : true, deleted: false });
      return;
    case "edit": case "delete": case "confirm": case "plan":
      if (!authentic) { st.forged++; return; }
      if (rec.kind === "plan") { if (rec.plan && typeof rec.plan.day === "string") st.plans.set(rec.plan.day, String(rec.plan.text ?? "")); return; }
      { const e = st.entries.get(rec.target);
        if (!e || e.deleted) return;
        if (rec.kind === "edit" && rec.data) e.data = rec.data;
        else if (rec.kind === "delete") e.deleted = true;
        else if (rec.kind === "confirm") e.locked = false; }
  }
}

function replayInto(st: State, text: string, k: { opener: Opener; macKey: Buffer }) {
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    st.lines++;
    const d = decodeLine(line, k.opener, k.macKey);
    if (d) applyRecord(st, d.rec, d.authentic);
  }
}

export class LogStore {
  private keys: Keys | null = null;
  private st: State = emptyState();
  private offset = 0; // bytes of entries.jsonl already replayed (complete lines only)
  private ino = -1;
  private failures = 0;
  private blockedUntil = 0;

  constructor(readonly dir: string, private readonly cost: KdfCost = DEFAULT_KDF, private readonly now: () => number = Date.now) {}

  private get vaultPath() { return join(this.dir, "vault.json"); }
  private get logPath() { return join(this.dir, "entries.jsonl"); }
  private get lockPath() { return join(this.dir, "wintrail.lock"); }

  exists(): boolean { return existsSync(this.vaultPath) || existsSync(this.vaultPath + ".bak"); }
  get isUnlocked(): boolean { return this.keys !== null; }
  get forgedCount(): number { return this.st.forged; }

  private readVault(): WrappedKeys {
    for (const p of [this.vaultPath, this.vaultPath + ".bak"]) {
      try {
        const w = JSON.parse(readFileSync(p, "utf8"));
        if (isWrappedKeys(w)) return w;
      } catch { /* try the backup copy */ }
    }
    throw new Error("Wintrail key file is missing or damaged");
  }

  private requireKeys(): Keys {
    if (!this.keys) throw new LockedError();
    return this.keys;
  }

  /** Lock and throw if another window changed the password (public key differs). */
  private checkNotRekeyed() {
    const k = this.requireKeys();
    if (this.readVault().pub !== k.pub) { this.lock(); throw new VaultChangedError(); }
  }

  /** Replay new complete lines since the last read (or everything if the file was rewritten). */
  private syncLog() {
    const k = this.requireKeys();
    if (!existsSync(this.logPath)) { this.st = emptyState(); this.offset = 0; this.ino = -1; return; }
    const stat = statSync(this.logPath);
    if (stat.ino !== this.ino || stat.size < this.offset) {
      this.st = emptyState();
      this.offset = 0;
      this.ino = stat.ino;
    }
    if (stat.size === this.offset) return;
    const buf = readFileSync(this.logPath);
    const end = buf.lastIndexOf(0x0a) + 1; // only complete lines; a torn tail waits
    if (end <= this.offset) return;
    replayInto(this.st, buf.subarray(this.offset, end).toString("utf8"), k);
    this.offset = end;
  }

  private setKeys(w: WrappedKeys, privateKey: Buffer, macKey: Buffer, wrapKey: Buffer) {
    this.keys = { pub: w.pub, opener: makeOpener(privateKey), macKey, wrapKey };
    privateKey.fill(0);
    this.st = emptyState();
    this.offset = 0;
    this.ino = -1;
    this.syncLog();
  }

  async create(password: string): Promise<void> {
    if (this.exists()) throw new Error("Wintrail is already set up");
    const k = generateKeys();
    const w = await wrapKeys(k, password, this.cost);
    await withFileLock(this.lockPath, () => {
      if (existsSync(this.vaultPath)) throw new Error("Wintrail is already set up");
      writeDurable(this.vaultPath, JSON.stringify(w), false);
      if (!existsSync(this.logPath)) appendDurable(this.logPath, "");
    });
    const { wrapKey } = await unwrapKeys(w, password);
    this.setKeys(w, k.privateKey, k.macKey, wrapKey);
  }

  async unlock(password: string): Promise<void> {
    const wait = this.blockedUntil - this.now();
    if (wait > 0) throw new ThrottledError(wait);
    const w = this.readVault();
    try {
      const u = await unwrapKeys(w, password);
      this.failures = 0;
      this.blockedUntil = 0;
      this.setKeys(w, u.privateKey, u.macKey, u.wrapKey);
    } catch (e) {
      if (e instanceof WrongPasswordError) {
        this.failures++;
        if (this.failures >= FREE_ATTEMPTS) {
          this.blockedUntil = this.now() + Math.min(5000 * 2 ** (this.failures - FREE_ATTEMPTS), 300_000);
        }
      }
      throw e;
    }
  }

  async unlockWithKey(wrapKey: Buffer): Promise<void> {
    const w = this.readVault();
    const u = unwrapWithKey(w, wrapKey);
    this.setKeys(w, u.privateKey, u.macKey, Buffer.from(wrapKey));
  }

  lock(): void {
    if (this.keys) { this.keys.macKey.fill(0); this.keys.wrapKey.fill(0); }
    this.keys = null;
    this.st = emptyState();
    this.offset = 0;
    this.ino = -1;
  }

  exportWrapKey(): Buffer { return Buffer.from(this.requireKeys().wrapKey); }
  /** Test hook: the MAC key of the unlocked session. */
  exportKeysForTests(): { macKey: Buffer } { return { macKey: Buffer.from(this.requireKeys().macKey) }; }

  /** Pick up changes from other windows. Returns false if this session is (now) locked. */
  refresh(): boolean {
    if (!this.keys) return false;
    try { this.checkNotRekeyed(); this.syncLog(); return true; } catch { return this.isUnlocked; }
  }

  entries(): Entry[] {
    this.requireKeys();
    const out: Entry[] = [];
    for (const [id, e] of this.st.entries) if (!e.deleted) out.push({ ...e.data, id, lockedAdd: e.locked });
    return out.sort((a, b) => b.at - a.at);
  }

  plans(): Plan[] {
    this.requireKeys();
    return [...this.st.plans].map(([day, text]) => ({ day, text })).sort((a, b) => a.day.localeCompare(b.day));
  }

  /** Works while locked (no password). When unlocked, the record is MAC'd and not marked. */
  async add(data: EntryData): Promise<string> {
    const id = randomUUID();
    await withFileLock(this.lockPath, () => {
      const w = this.readVault();
      if (this.keys && w.pub !== this.keys.pub) this.lock(); // re-keyed elsewhere: seal as a locked add
      const macKey = this.keys?.macKey;
      appendDurable(this.logPath, encodeRecord(Buffer.from(w.pub, "base64"), macKey, { kind: "add", id, data }) + "\n");
      if (this.keys) this.syncLog();
    });
    return id;
  }

  private async appendAuthentic(rec: Rec) {
    this.requireKeys();
    await withFileLock(this.lockPath, () => {
      this.checkNotRekeyed();
      const k = this.requireKeys();
      appendDurable(this.logPath, encodeRecord(Buffer.from(k.pub, "base64"), k.macKey, rec) + "\n");
      this.syncLog();
    });
  }

  edit(id: string, data: EntryData) { return this.appendAuthentic({ kind: "edit", target: id, data }); }
  remove(id: string) { return this.appendAuthentic({ kind: "delete", target: id }); }
  confirm(id: string) { return this.appendAuthentic({ kind: "confirm", target: id }); }
  savePlan(plan: Plan) { return this.appendAuthentic({ kind: "plan", plan }); }

  /** Live state as a fresh set of records (add records keep their locked marks). */
  private liveRecords(): Rec[] {
    const recs: Rec[] = [];
    for (const [id, e] of this.st.entries) if (!e.deleted) recs.push({ kind: "add", id, data: e.data, locked: e.locked });
    const plans = [...this.st.plans].sort((a, b) => a[0].localeCompare(b[0])).slice(-MAX_PLANS_KEPT);
    for (const [day, text] of plans) recs.push({ kind: "plan", plan: { day, text } });
    return recs;
  }

  /** Rewrite the log without superseded records once there are more than `threshold` of them. */
  async compactIfNeeded(threshold = 200): Promise<boolean> {
    this.requireKeys();
    return withFileLock(this.lockPath, () => {
      this.checkNotRekeyed();
      this.syncLog();
      const live = this.liveRecords();
      if (this.st.lines - live.length <= threshold) return false;
      const k = this.requireKeys();
      const pub = Buffer.from(k.pub, "base64");
      writeDurable(this.logPath, live.map((r) => encodeRecord(pub, k.macKey, r) + "\n").join(""));
      this.syncLog();
      return true;
    });
  }

  /** New key pair + MAC key, everything re-sealed: an old vault.json copy + old password reads nothing new. */
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    this.requireKeys();
    const current = this.readVault();
    await unwrapKeys(current, oldPassword); // throws WrongPasswordError
    const fresh = generateKeys();
    const wrapped = await wrapKeys(fresh, newPassword, this.cost);
    await withFileLock(this.lockPath, () => {
      this.checkNotRekeyed();
      this.syncLog();
      const pub = fresh.publicKey;
      const body = this.liveRecords().map((r) => encodeRecord(pub, fresh.macKey, r) + "\n").join("");
      // Keep the old pair together so a crash between the two renames is recoverable from .bak files.
      if (existsSync(this.logPath)) copyFileSync(this.logPath, this.logPath + ".rekey.bak");
      copyFileSync(this.vaultPath, this.vaultPath + ".rekey.bak");
      writeDurable(this.logPath, body);
      writeDurable(this.vaultPath, JSON.stringify(wrapped));
    });
    const wrapKey = await deriveKey(newPassword, wrapped.kdf);
    this.lock();
    this.setKeys(wrapped, fresh.privateKey, fresh.macKey, wrapKey);
  }

  /** Both encrypted files as one portable string; opens with the master password at export time. */
  exportBackup(): string {
    const lines = existsSync(this.logPath) ? readFileSync(this.logPath, "utf8").split("\n").filter((l) => l.trim()) : [];
    return JSON.stringify({ kind: "wintrail-backup", v: 1, vault: this.readVault(), entries: lines });
  }

  /** Merge a backup (possibly from another vault/password) into this log. Never replaces. */
  async importMerge(text: string, password: string): Promise<{ added: number; skipped: number }> {
    this.requireKeys();
    let parsed: { kind?: string; vault?: unknown; entries?: unknown };
    try { parsed = JSON.parse(text); } catch { throw new Error("Not a Wintrail backup file"); }
    if (parsed?.kind !== "wintrail-backup" || !isWrappedKeys(parsed.vault) || !Array.isArray(parsed.entries)) {
      throw new Error("Not a Wintrail backup file");
    }
    let u: { privateKey: Buffer; macKey: Buffer; wrapKey: Buffer };
    try { u = await unwrapKeys(parsed.vault, password); } catch { throw new WrongBackupPasswordError(); }
    const theirs = emptyState();
    replayInto(theirs, (parsed.entries as unknown[]).filter((l): l is string => typeof l === "string").join("\n"),
      { opener: makeOpener(u.privateKey), macKey: u.macKey });
    u.privateKey.fill(0); u.macKey.fill(0); u.wrapKey.fill(0);

    return withFileLock(this.lockPath, () => {
      this.checkNotRekeyed();
      this.syncLog();
      if (existsSync(this.logPath)) copyFileSync(this.logPath, this.logPath + ".pre-import.bak");
      const seen = new Set([...this.st.entries.values()].filter((e) => !e.deleted).map((e) => `${e.data.at}|${e.data.text}`));
      const k = this.requireKeys();
      const pub = Buffer.from(k.pub, "base64");
      let added = 0, skipped = 0, out = "";
      for (const e of theirs.entries.values()) {
        if (e.deleted) continue;
        const key = `${e.data.at}|${e.data.text}`;
        if (seen.has(key)) { skipped++; continue; }
        seen.add(key);
        out += encodeRecord(pub, k.macKey, { kind: "add", id: randomUUID(), data: e.data }) + "\n";
        added++;
      }
      if (out) appendDurable(this.logPath, out);
      this.syncLog();
      return { added, skipped };
    });
  }
}
