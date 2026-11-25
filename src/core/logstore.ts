// Wintrail's encrypted, append-only work log.
//   vault.json     WrappedKeys: X25519 public key (plaintext, bound to the wrapped private key) + wrapped private/MAC keys
//   entries.jsonl  one sealed record per line; see records.ts
//   head.json      MAC'd {count,last} of authentic records, so deleted/rolled-back lines are noticed
// Adding needs only the public key, so it works while locked. Reading needs the password.
// Edits/deletes/confirms/plans carry a MAC that only an unlocked session can produce.
import { existsSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_KDF, KdfCost, WrongPasswordError, deriveKey } from "./envelope";
import {
  Opener, VaultTamperedError, WrappedKeys, generateKeys, isWrappedKeys, mac, makeOpener, unwrapKeys, unwrapWithKey, verifyMac, wrapKeys,
} from "./keys";
import { EntryData, Plan, Rec, decodeLine, encodeRecord, isEntryData, pickEntryData } from "./records";
import { appendDurable, fsyncDir, withFileLock, writeDurable } from "./fsutil";

export type { EntryData, Plan } from "./records";
export { VaultTamperedError } from "./keys";
export interface Entry extends EntryData { id: string; lockedAdd: boolean }

/** Where the last verified public key is remembered (globalState in VS Code), so a swapped key file is refused. */
export interface PubPin { get(): string | undefined; set(pub: string): void | Promise<void> }
/** Test hook to simulate a crash in the middle of a password change. */
export interface Faults { crashAfter?: "prepare" | "log" }

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
  undecodable: number;
  seen: Set<string>; // record ids (r) already applied — replays are ignored
  authentic: number; // authentic (MAC'd) records applied
  macs: Set<string>; // their MACs, to verify the head
  lastMac?: string;
}
const emptyState = (): State => ({
  entries: new Map(), plans: new Map(), forged: 0, lines: 0, undecodable: 0, seen: new Set(), authentic: 0, macs: new Set(),
});

/** Apply one decoded record to the state (replay rules from the design). */
function applyRecord(st: State, rec: Rec, authentic: boolean) {
  switch (rec.kind) {
    case "add":
      if (typeof rec.id !== "string" || st.entries.has(rec.id)) return;
      if (!isEntryData(rec.data)) { st.forged++; return; }
      st.entries.set(rec.id, { data: pickEntryData(rec.data), locked: authentic ? !!rec.locked : true, deleted: false });
      return;
    case "edit": case "delete": case "confirm": case "plan":
      if (!authentic) { st.forged++; return; }
      if (rec.kind === "plan") {
        if (rec.plan && typeof rec.plan.day === "string" && typeof rec.plan.text === "string") st.plans.set(rec.plan.day, rec.plan.text.slice(0, 600));
        return;
      }
      {
        const e = st.entries.get(rec.target);
        if (!e || e.deleted) return;
        if (rec.kind === "edit") { if (isEntryData(rec.data)) e.data = pickEntryData(rec.data); else st.forged++; }
        else if (rec.kind === "delete") e.deleted = true;
        else e.locked = false;
      }
  }
}

function replayInto(st: State, text: string, k: { opener: Opener; macKey: Buffer }) {
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    st.lines++;
    const d = decodeLine(line, k.opener, k.macKey);
    if (!d) { st.undecodable++; continue; }
    if (st.seen.has(d.r)) { if (d.authentic) st.forged++; continue; } // replayed line
    st.seen.add(d.r);
    if (d.authentic && d.m) { st.authentic++; st.macs.add(d.m); st.lastMac = d.m; }
    applyRecord(st, d.rec, d.authentic);
  }
}

interface Head { v: 1; count: number; last: string | null; mac: string }
const headInput = (count: number, last: string | null) => `wintrail-head.${count}.${last ?? ""}`;
const memoryPin = (): PubPin => { let v: string | undefined; return { get: () => v, set: (p) => { v = p; } }; };

export class LogStore {
  private keys: Keys | null = null;
  private st: State = emptyState();
  private offset = 0; // bytes of entries.jsonl already replayed (complete lines only)
  private ino = -1;
  private failures = 0;
  private blockedUntil = 0;
  private integrity = false;

  constructor(
    readonly dir: string,
    private readonly cost: KdfCost = DEFAULT_KDF,
    private readonly now: () => number = Date.now,
    private readonly pin: PubPin = memoryPin(),
    private readonly faults: Faults = {},
  ) {}

  private get vaultPath() { return join(this.dir, "vault.json"); }
  private get logPath() { return join(this.dir, "entries.jsonl"); }
  private get headPath() { return join(this.dir, "head.json"); }
  private get lockPath() { return join(this.dir, "wintrail.lock"); }

  exists(): boolean { return existsSync(this.vaultPath) || existsSync(this.vaultPath + ".next"); }
  get isUnlocked(): boolean { return this.keys !== null; }
  get forgedCount(): number { return this.st.forged; }
  /** True when authentic records were removed or the log was rolled back since the last write. */
  get integrityWarning(): boolean { return this.integrity; }

  /** Finish or undo a password change interrupted by a crash (call under the lock). */
  private recoverRekey() {
    const vNext = this.vaultPath + ".next", lNext = this.logPath + ".next";
    if (!existsSync(vNext)) { if (existsSync(lNext)) unlinkSync(lNext); return; }
    if (existsSync(lNext)) {
      // crashed before anything was swapped: roll back to the old (still complete) pair
      unlinkSync(lNext);
      unlinkSync(vNext);
    } else {
      // the log was already swapped: roll forward
      renameSync(vNext, this.vaultPath);
      fsyncDir(this.vaultPath);
      this.removeStaleCopies();
    }
  }

  /** Old-key copies must not survive a password change. */
  private removeStaleCopies() {
    for (const f of [this.vaultPath + ".bak", this.logPath + ".bak", this.vaultPath + ".rekey.bak", this.logPath + ".rekey.bak"]) {
      try { unlinkSync(f); } catch { /* absent */ }
    }
  }

  private readVault(): WrappedKeys {
    let w: unknown;
    try { w = JSON.parse(readFileSync(this.vaultPath, "utf8")); } catch {
      throw new Error("Wintrail's key file is missing or damaged. Restore vault.json from a backup.");
    }
    if (!isWrappedKeys(w)) throw new Error("Wintrail's key file is missing or damaged. Restore vault.json from a backup.");
    return w;
  }

  private requireKeys(): Keys {
    if (!this.keys) throw new LockedError();
    return this.keys;
  }

  /** Lock and throw if the key file changed: a password change in another window, or tampering. */
  private checkNotRekeyed() {
    const k = this.requireKeys();
    const filePub = this.readVault().pub;
    if (filePub === k.pub) return;
    const legit = this.pin.get() === filePub;
    this.lock();
    throw legit ? new VaultChangedError() : new VaultTamperedError();
  }

  /** Replay new complete lines since the last read (or everything if the file was rewritten). */
  private syncLog() {
    const k = this.requireKeys();
    if (!existsSync(this.logPath)) { this.st = emptyState(); this.offset = 0; this.ino = -1; return; }
    const stat = statSync(this.logPath);
    if (stat.ino !== this.ino || stat.size < this.offset) { this.st = emptyState(); this.offset = 0; this.ino = stat.ino; }
    if (stat.size === this.offset) return;
    const buf = readFileSync(this.logPath);
    const end = buf.lastIndexOf(0x0a) + 1; // only complete lines; a torn tail waits
    if (end <= this.offset) return;
    replayInto(this.st, buf.subarray(this.offset, end).toString("utf8"), k);
    this.offset = end;
  }

  /** Compare the replayed log with the MAC'd head (call under the lock, after syncLog). */
  private checkIntegrity() {
    const k = this.requireKeys();
    let head: Head | null = null;
    try { head = JSON.parse(readFileSync(this.headPath, "utf8")); } catch { /* missing */ }
    if (!head) { this.integrity = this.st.authentic > 0; return; }
    const valid = typeof head.count === "number" && verifyMac(k.macKey, headInput(head.count, head.last), String(head.mac));
    this.integrity = !valid || this.st.authentic < head.count || (head.last !== null && !this.st.macs.has(head.last));
  }

  private writeHead(count: number, last: string | null) {
    const k = this.requireKeys();
    const head: Head = { v: 1, count, last, mac: mac(k.macKey, headInput(count, last)) };
    writeDurable(this.headPath, JSON.stringify(head), false);
  }

  private setKeys(w: WrappedKeys, privateKey: Buffer, macKey: Buffer, wrapKey: Buffer) {
    this.keys = { pub: w.pub, opener: makeOpener(privateKey), macKey, wrapKey };
    privateKey.fill(0);
    this.st = emptyState();
    this.offset = 0;
    this.ino = -1;
    this.syncLog();
    this.checkIntegrity();
  }

  async create(password: string): Promise<void> {
    if (this.exists()) throw new Error("Wintrail is already set up");
    const k = generateKeys();
    const w = await wrapKeys(k, password, this.cost);
    const { wrapKey } = await unwrapKeys(w, password);
    await withFileLock(this.lockPath, async () => {
      if (existsSync(this.vaultPath)) throw new Error("Wintrail is already set up");
      writeDurable(this.vaultPath, JSON.stringify(w), false);
      if (!existsSync(this.logPath)) appendDurable(this.logPath, "");
      this.setKeys(w, Buffer.from(k.privateKey), k.macKey, wrapKey);
      this.writeHead(0, null);
      await this.pin.set(w.pub);
    });
  }

  async unlock(password: string): Promise<void> {
    const wait = this.blockedUntil - this.now();
    if (wait > 0) throw new ThrottledError(wait);
    await withFileLock(this.lockPath, () => this.recoverRekey());
    const w = this.readVault();
    try {
      const u = await unwrapKeys(w, password);
      this.failures = 0;
      this.blockedUntil = 0;
      await withFileLock(this.lockPath, () => this.setKeys(w, u.privateKey, u.macKey, u.wrapKey));
      await this.pin.set(w.pub);
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
    await withFileLock(this.lockPath, () => {
      this.recoverRekey();
      const w = this.readVault();
      if (this.pin.get() && this.pin.get() !== w.pub) throw new VaultTamperedError();
      const u = unwrapWithKey(w, wrapKey);
      this.setKeys(w, u.privateKey, u.macKey, Buffer.from(wrapKey));
    });
  }

  lock(): void {
    if (this.keys) { this.keys.macKey.fill(0); this.keys.wrapKey.fill(0); }
    this.keys = null;
    this.st = emptyState();
    this.offset = 0;
    this.ino = -1;
    this.integrity = false;
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

  /** Append one authentic line and advance the head (call under the lock, unlocked). */
  private appendSigned(rec: Rec) {
    const k = this.requireKeys();
    const line = encodeRecord(Buffer.from(k.pub, "base64"), k.macKey, rec);
    appendDurable(this.logPath, line + "\n");
    this.syncLog();
    this.writeHead(this.st.authentic, this.st.lastMac ?? null);
  }

  /** Works while locked (no password). When unlocked, the record is MAC'd and not marked. */
  async add(data: EntryData): Promise<string> {
    const id = randomUUID();
    const clean = pickEntryData(data);
    if (!isEntryData(clean)) throw new Error("Entry text must be 1–500 characters");
    await withFileLock(this.lockPath, async () => {
      this.recoverRekey();
      const filePub = this.readVault().pub;
      const pinned = this.pin.get();
      if (this.keys) {
        if (filePub === this.keys.pub) {
          this.syncLog();
          this.appendSigned({ kind: "add", id, data: clean });
          return;
        }
        if (pinned !== filePub) { this.lock(); throw new VaultTamperedError(); }
        this.lock(); // password changed in another window: continue as a locked add to the new key
      } else if (pinned && pinned !== filePub) {
        throw new VaultTamperedError();
      } else if (!pinned) {
        await this.pin.set(filePub); // first use on this machine
      }
      appendDurable(this.logPath, encodeRecord(Buffer.from(filePub, "base64"), undefined, { kind: "add", id, data: clean }) + "\n");
    });
    return id;
  }

  private async appendAuthentic(rec: Rec) {
    this.requireKeys();
    await withFileLock(this.lockPath, () => {
      this.recoverRekey();
      this.checkNotRekeyed();
      this.syncLog();
      this.appendSigned(rec);
    });
  }

  edit(id: string, data: EntryData) {
    const clean = pickEntryData(data);
    if (!isEntryData(clean)) return Promise.reject(new Error("Entry text must be 1–500 characters"));
    return this.appendAuthentic({ kind: "edit", target: id, data: clean });
  }
  remove(id: string) { return this.appendAuthentic({ kind: "delete", target: id }); }
  confirm(id: string) { return this.appendAuthentic({ kind: "confirm", target: id }); }
  savePlan(plan: Plan) { return this.appendAuthentic({ kind: "plan", plan: { day: plan.day, text: plan.text.slice(0, 600) } }); }

  /** Live state as a fresh set of records (add records keep their locked marks). */
  private liveRecords(): Rec[] {
    const recs: Rec[] = [];
    for (const [id, e] of this.st.entries) if (!e.deleted) recs.push({ kind: "add", id, data: e.data, locked: e.locked });
    const plans = [...this.st.plans].sort((a, b) => a[0].localeCompare(b[0])).slice(-MAX_PLANS_KEPT);
    for (const [day, text] of plans) recs.push({ kind: "plan", plan: { day, text } });
    return recs;
  }

  /** Seal records, returning the file body and the head values for it. */
  private sealAll(recs: Rec[], pub: Buffer, macKey: Buffer): { body: string; count: number; last: string | null } {
    let body = "", last: string | null = null;
    for (const r of recs) {
      const line = encodeRecord(pub, macKey, r);
      last = (JSON.parse(line) as { m: string }).m;
      body += line + "\n";
    }
    return { body, count: recs.length, last };
  }

  /** Rewrite the log without superseded records once there are more than `threshold` of them.
   *  Never compacts while any line can't be decoded (it might be data we must not lose). */
  async compactIfNeeded(threshold = 200): Promise<boolean> {
    this.requireKeys();
    return withFileLock(this.lockPath, () => {
      this.recoverRekey();
      this.checkNotRekeyed();
      this.syncLog();
      if (this.st.undecodable > 0) return false;
      const live = this.liveRecords();
      if (this.st.lines - live.length <= threshold) return false;
      const k = this.requireKeys();
      const sealed = this.sealAll(live, Buffer.from(k.pub, "base64"), k.macKey);
      writeDurable(this.logPath, sealed.body);
      this.syncLog();
      this.writeHead(sealed.count, sealed.last);
      this.checkIntegrity();
      return true;
    });
  }

  /** New key pair + MAC key, everything re-sealed. Crash-safe (prepare → swap log → swap keys),
   *  and no copy of the old keys or old log is left behind. */
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    this.requireKeys();
    const current = this.readVault();
    const verify = await unwrapKeys(current, oldPassword); // throws WrongPasswordError
    verify.privateKey.fill(0); verify.macKey.fill(0); verify.wrapKey.fill(0);
    const fresh = generateKeys();
    const wrapped = await wrapKeys(fresh, newPassword, this.cost);
    const wrapKey = await deriveKey(newPassword, wrapped.kdf);
    await withFileLock(this.lockPath, async () => {
      this.recoverRekey();
      this.checkNotRekeyed();
      this.syncLog();
      const sealed = this.sealAll(this.liveRecords(), fresh.publicKey, fresh.macKey);
      writeDurable(this.logPath + ".next", sealed.body, false);
      writeDurable(this.vaultPath + ".next", JSON.stringify(wrapped), false);
      if (this.faults.crashAfter === "prepare") throw new Error("simulated crash");
      renameSync(this.logPath + ".next", this.logPath);
      fsyncDir(this.logPath);
      if (this.faults.crashAfter === "log") throw new Error("simulated crash");
      renameSync(this.vaultPath + ".next", this.vaultPath);
      fsyncDir(this.vaultPath);
      this.removeStaleCopies();
      this.lock();
      this.setKeys(wrapped, Buffer.from(fresh.privateKey), fresh.macKey, wrapKey);
      this.writeHead(sealed.count, sealed.last);
      this.checkIntegrity();
      await this.pin.set(wrapped.pub);
    });
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
    try { u = await unwrapKeys(parsed.vault, password); } catch (e) {
      if (e instanceof VaultTamperedError) throw new Error("This backup's key file was tampered with");
      throw new WrongBackupPasswordError();
    }
    const theirs = emptyState();
    replayInto(theirs, (parsed.entries as unknown[]).filter((l): l is string => typeof l === "string").join("\n"),
      { opener: makeOpener(u.privateKey), macKey: u.macKey });
    u.privateKey.fill(0); u.macKey.fill(0); u.wrapKey.fill(0);

    return withFileLock(this.lockPath, () => {
      this.recoverRekey();
      this.checkNotRekeyed();
      this.syncLog();
      if (existsSync(this.logPath)) writeDurable(this.logPath + ".pre-import.bak", readFileSync(this.logPath, "utf8"), false);
      const seen = new Set([...this.st.entries.values()].filter((e) => !e.deleted).map((e) => `${e.data.at}|${e.data.text}`));
      let added = 0, skipped = 0;
      for (const e of theirs.entries.values()) {
        if (e.deleted) continue;
        const key = `${e.data.at}|${e.data.text}`;
        if (seen.has(key)) { skipped++; continue; }
        seen.add(key);
        this.appendSigned({ kind: "add", id: randomUUID(), data: e.data, locked: e.locked });
        added++;
      }
      return { added, skipped };
    });
  }
}
