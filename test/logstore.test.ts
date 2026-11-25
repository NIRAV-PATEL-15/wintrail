import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LogStore, VaultChangedError, EntryData } from "../src/core/logstore";
import { encodeRecord } from "../src/core/records";
import { FAST_KDF_FOR_TESTS as P, WrongPasswordError } from "../src/core/envelope";
import { generateKeys, sealTo, pad } from "../src/core/keys";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "wintrail-")); });

const PW = "password-one";
const data = (text: string, extra: Partial<EntryData> = {}): EntryData => ({
  text, at: Date.UTC(2026, 10, 20, 10), project: "authora-api", branch: "feature/perf",
  tags: ["performance"], star: false, impact: "normal", ...extra,
});
async function fresh() { const s = new LogStore(dir, P); await s.create(PW); return s; }
const disk = () => readFileSync(join(dir, "entries.jsonl"), "utf8") + readFileSync(join(dir, "vault.json"), "utf8");

describe("write without unlocking", () => {
  it("an add while locked is readable after unlock and marked lockedAdd", async () => {
    const s = await fresh();
    s.lock();
    const id = await s.add(data("Cut login latency"));
    expect(() => s.entries()).toThrow();
    await s.unlock(PW);
    expect(s.entries()).toEqual([expect.objectContaining({ id, text: "Cut login latency", lockedAdd: true })]);
  });
  it("an add while unlocked is not marked", async () => {
    const s = await fresh();
    await s.add(data("Reviewed PRs"));
    expect(s.entries()[0].lockedAdd).toBe(false);
  });
  it("confirm clears the lockedAdd mark", async () => {
    const s = await fresh();
    s.lock();
    const id = await s.add(data("x"));
    await s.unlock(PW);
    await s.confirm(id);
    expect(s.entries()[0].lockedAdd).toBe(false);
    const again = new LogStore(dir, P);
    await again.unlock(PW);
    expect(again.entries()[0].lockedAdd).toBe(false);
  });
  it("wrong password throws", async () => {
    const s = await fresh();
    s.lock();
    await expect(s.unlock("nope-nope")).rejects.toBeInstanceOf(WrongPasswordError);
  });
});

describe("edits, deletes, plans", () => {
  it("edit then delete replay correctly in a fresh store", async () => {
    const s = await fresh();
    const a = await s.add(data("first"));
    const b = await s.add(data("second", { at: Date.UTC(2026, 10, 21) }));
    await s.edit(a, data("first (edited)", { star: true, impact: "high" }));
    await s.remove(b);
    const t = new LogStore(dir, P);
    await t.unlock(PW);
    expect(t.entries().map((e) => [e.text, e.star, e.impact])).toEqual([["first (edited)", true, "high"]]);
  });
  it("entries are sorted newest first", async () => {
    const s = await fresh();
    await s.add(data("old", { at: 1000 }));
    await s.add(data("new", { at: 5000 }));
    expect(s.entries().map((e) => e.text)).toEqual(["new", "old"]);
  });
  it("plans are saved sealed and returned", async () => {
    const s = await fresh();
    await s.savePlan({ day: "2026-11-24", text: "Continue payments webhooks" });
    expect(s.plans()).toEqual([{ day: "2026-11-24", text: "Continue payments webhooks" }]);
    expect(disk()).not.toContain("payments");
  });
});

describe("tamper protection", () => {
  it("a forged delete without the MAC key is ignored and counted", async () => {
    const s = await fresh();
    const id = await s.add(data("keep me"));
    const pub = Buffer.from(JSON.parse(readFileSync(join(dir, "vault.json"), "utf8")).pub, "base64");
    appendFileSync(join(dir, "entries.jsonl"), encodeRecord(pub, undefined, { kind: "delete", target: id }) + "\n");
    const t = new LogStore(dir, P);
    await t.unlock(PW);
    expect(t.entries().map((e) => e.text)).toEqual(["keep me"]);
    expect(t.forgedCount).toBe(1);
  });
  it("a forged MAC (random tag) is also rejected", async () => {
    const s = await fresh();
    const id = await s.add(data("keep me"));
    const pub = Buffer.from(JSON.parse(readFileSync(join(dir, "vault.json"), "utf8")).pub, "base64");
    appendFileSync(join(dir, "entries.jsonl"), encodeRecord(pub, generateKeys().macKey, { kind: "delete", target: id }) + "\n");
    s.refresh();
    expect(s.entries()).toHaveLength(1);
    expect(s.forgedCount).toBe(1);
  });
  it("nothing about entries is readable on disk", async () => {
    const s = await fresh();
    const id = await s.add(data("Secret promotion project", { tags: ["confidential"] }));
    await s.edit(id, data("Secret promotion project v2"));
    const raw = disk();
    for (const needle of ["Secret", "promotion", "confidential", "authora-api", "feature/perf", id]) {
      expect(raw).not.toContain(needle);
    }
  });
  it("entry length is hidden by padding", async () => {
    const s = await fresh();
    await s.add(data("a"));
    await s.add(data("a noticeably longer entry, same size bucket")); // both fit one 256-byte bucket
    const lines = readFileSync(join(dir, "entries.jsonl"), "utf8").trim().split("\n");
    expect(lines[0].length).toBe(lines[1].length);
  });
});

describe("robustness", () => {
  it("a torn last line is skipped and the rest loads", async () => {
    const s = await fresh();
    await s.add(data("survivor"));
    appendFileSync(join(dir, "entries.jsonl"), '{"r":"abc","s":{"epk":"tor');
    const t = new LogStore(dir, P);
    await t.unlock(PW);
    expect(t.entries().map((e) => e.text)).toEqual(["survivor"]);
  });
  it("garbage sealed to someone else's key is skipped", async () => {
    const s = await fresh();
    await s.add(data("mine"));
    const other = generateKeys();
    appendFileSync(join(dir, "entries.jsonl"), JSON.stringify({ r: "zzz", s: sealTo(other.publicKey, pad(Buffer.from("{}"))) }) + "\n");
    s.refresh();
    expect(s.entries().map((e) => e.text)).toEqual(["mine"]);
  });
  it("5,000 entries + 2,000 edits replay in under 1s", async () => {
    const s = await fresh();
    const keysFile = JSON.parse(readFileSync(join(dir, "vault.json"), "utf8"));
    const pub = Buffer.from(keysFile.pub, "base64");
    const { macKey } = s.exportKeysForTests();
    const lines: string[] = [];
    for (let i = 0; i < 5000; i++) lines.push(encodeRecord(pub, macKey, { kind: "add", id: `id${i}`, data: data(`entry ${i}`, { at: i }) }));
    for (let i = 0; i < 2000; i++) lines.push(encodeRecord(pub, macKey, { kind: "edit", target: `id${i}`, data: data(`edited ${i}`, { at: i }) }));
    writeFileSync(join(dir, "entries.jsonl"), lines.join("\n") + "\n");
    const t = new LogStore(dir, P);
    const started = Date.now();
    await t.unlockWithKey(s.exportWrapKey());
    const ms = Date.now() - started;
    expect(t.entries()).toHaveLength(5000);
    expect(ms).toBeLessThan(1000);
  });
});

describe("password change rotates keys", () => {
  it("old password + an old copy of vault.json can't open new records; entries survive", async () => {
    const s = await fresh();
    await s.add(data("before change"));
    const oldVault = readFileSync(join(dir, "vault.json"), "utf8");
    await s.changePassword(PW, "password-two");
    await s.add(data("after change"));
    // attacker restores the old vault.json and uses the old password
    const stolen = mkdtempSync(join(tmpdir(), "wintrail-stolen-"));
    writeFileSync(join(stolen, "vault.json"), oldVault);
    writeFileSync(join(stolen, "entries.jsonl"), readFileSync(join(dir, "entries.jsonl")));
    const thief = new LogStore(stolen, P);
    await thief.unlock(PW);
    expect(thief.entries()).toEqual([]);
    const t = new LogStore(dir, P);
    await expect(t.unlock(PW)).rejects.toBeInstanceOf(WrongPasswordError);
    await t.unlock("password-two");
    expect(t.entries().map((e) => e.text).sort()).toEqual(["after change", "before change"]);
  });
  it("another window detects the re-key and locks", async () => {
    let pinned: string | undefined; // shared like VS Code globalState
    const pin = { get: () => pinned, set: (p: string) => { pinned = p; } };
    const a = new LogStore(dir, P, Date.now, pin);
    await a.create(PW);
    const b = new LogStore(dir, P, Date.now, pin);
    await b.unlock(PW);
    await a.changePassword(PW, "password-two");
    await expect(b.edit("x", data("y"))).rejects.toBeInstanceOf(VaultChangedError);
    expect(b.isUnlocked).toBe(false);
  });
  it("a locked quick-add after the re-key seals to the new key", async () => {
    const a = await fresh();
    const b = new LogStore(dir, P); // a second window that never unlocked
    await a.changePassword(PW, "password-two");
    await b.add(data("from window B"));
    a.refresh();
    expect(a.entries().map((e) => e.text)).toContain("from window B");
  });
});

describe("two windows", () => {
  it("B appends while A compacts: nothing is lost", async () => {
    const a = await fresh();
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push(await a.add(data(`e${i}`, { at: i })));
    for (const id of ids.slice(0, 20)) await a.remove(id);
    const b = new LogStore(dir, P);
    await Promise.all([a.compactIfNeeded(5), b.add(data("racing add", { at: 999 }))]);
    const t = new LogStore(dir, P);
    await t.unlock(PW);
    expect(t.entries().map((e) => e.text)).toContain("racing add");
    expect(t.entries()).toHaveLength(11);
  });
  it("compaction keeps lockedAdd marks", async () => {
    const a = await fresh();
    a.lock();
    await a.add(data("locked one"));
    await a.unlock(PW);
    const id = await a.add(data("victim"));
    for (let i = 0; i < 6; i++) await a.edit(id, data(`victim ${i}`));
    await a.compactIfNeeded(3);
    const t = new LogStore(dir, P);
    await t.unlock(PW);
    expect(t.entries().find((e) => e.text === "locked one")!.lockedAdd).toBe(true);
    expect(readFileSync(join(dir, "entries.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
  });
});

describe("backup import merge", () => {
  it("merges a backup from another vault, skips duplicates, backs up first", async () => {
    const other = mkdtempSync(join(tmpdir(), "wintrail-other-"));
    const o = new LogStore(other, P);
    await o.create("other-password");
    await o.add(data("from old laptop", { at: 111 }));
    await o.add(data("shared", { at: 222 }));
    const backup = o.exportBackup();

    const s = await fresh();
    await s.add(data("shared", { at: 222 }));
    const r = await s.importMerge(backup, "other-password");
    expect(r).toEqual({ added: 1, skipped: 1 });
    expect(s.entries().map((e) => e.text).sort()).toEqual(["from old laptop", "shared"]);
    expect(existsSync(join(dir, "entries.jsonl.pre-import.bak"))).toBe(true);
    expect(s.exportBackup()).not.toContain("from old laptop");
  });
  it("wrong backup password throws and changes nothing", async () => {
    const other = mkdtempSync(join(tmpdir(), "wintrail-other-"));
    const o = new LogStore(other, P);
    await o.create("other-password");
    const s = await fresh();
    await expect(s.importMerge(o.exportBackup(), "bad-bad")).rejects.toThrow(/password/i);
    expect(s.entries()).toEqual([]);
  });
});
