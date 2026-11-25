// Regression tests for the final review's Critical/Important findings (each reproduces the attack).
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, unlinkSync, chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LogStore, EntryData, VaultTamperedError, PubPin } from "../src/core/logstore";
import { encodeRecord } from "../src/core/records";
import { generateKeys, makeOpener, openSealed, unpad } from "../src/core/keys";
import { gitCommits } from "../src/core/gitlog";
import { exportMarkdown } from "../src/core/exporter";
import { FAST_KDF_FOR_TESTS as P } from "../src/core/envelope";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "wt-sec-")); });
const PW = "password-one";
const data = (text: string, at = Date.UTC(2026, 10, 20)): EntryData =>
  ({ text, at, project: "p", branch: "", tags: [], star: false, impact: "normal" });
const vaultPath = () => join(dir, "vault.json");
const logPath = () => join(dir, "entries.jsonl");
const memPin = (): PubPin => { let v: string | undefined; return { get: () => v, set: (p) => { v = p; } }; };

describe("C1: swapped public key", () => {
  it("unlock refuses a vault whose public key doesn't match the private key", async () => {
    const s = new LogStore(dir, P);
    await s.create(PW);
    await s.add(data("history"));
    s.lock();
    const v = JSON.parse(readFileSync(vaultPath(), "utf8"));
    v.pub = generateKeys().publicKey.toString("base64");
    writeFileSync(vaultPath(), JSON.stringify(v));
    await expect(new LogStore(dir, P).unlock(PW)).rejects.toBeInstanceOf(VaultTamperedError);
  });
  it("a locked quick-add refuses to seal to a public key that differs from the pinned one", async () => {
    const pin = memPin();
    const s = new LogStore(dir, P, Date.now, pin);
    await s.create(PW);
    s.lock();
    const attacker = generateKeys();
    const v = JSON.parse(readFileSync(vaultPath(), "utf8"));
    v.pub = attacker.publicKey.toString("base64");
    writeFileSync(vaultPath(), JSON.stringify(v));
    const other = new LogStore(dir, P, Date.now, pin); // another window, same pin storage
    await expect(other.add(data("secret win"))).rejects.toBeInstanceOf(VaultTamperedError);
    // nothing was sealed to the attacker
    const opener = makeOpener(attacker.privateKey);
    const readable = readFileSync(logPath(), "utf8").split("\n").filter(Boolean).filter((l) => {
      try { unpad(openSealed(opener, JSON.parse(l).s)); return true; } catch { return false; }
    });
    expect(readable).toEqual([]);
  });
});

describe("C3: password change retires the old keys", () => {
  it("leaves no backup copies of the old key file or old log", async () => {
    const s = new LogStore(dir, P);
    await s.create(PW);
    await s.add(data("before"));
    await s.compactIfNeeded(-1); // creates entries.jsonl.bak under the old key
    await s.changePassword(PW, "password-two");
    for (const f of ["vault.json.bak", "vault.json.rekey.bak", "entries.jsonl.bak", "entries.jsonl.rekey.bak", "vault.json.next", "entries.jsonl.next"]) {
      expect(existsSync(join(dir, f)), f).toBe(false);
    }
  });
  it("deleting vault.json doesn't make new entries readable with the old password", async () => {
    const s = new LogStore(dir, P);
    await s.create(PW);
    await s.changePassword(PW, "password-two");
    unlinkSync(vaultPath());
    await expect(new LogStore(dir, P).add(data("new secret"))).rejects.toThrow();
  });
});

describe("I1: crash during password change", () => {
  it("crash after the log was swapped rolls forward: the new password opens everything", async () => {
    const s = new LogStore(dir, P, Date.now, undefined, { crashAfter: "log" });
    await s.create(PW);
    await s.add(data("one")); await s.add(data("two"));
    await expect(s.changePassword(PW, "password-two")).rejects.toThrow(/simulated crash/);
    const t = new LogStore(dir, P);
    await t.unlock("password-two");
    expect(t.entries().map((e) => e.text).sort()).toEqual(["one", "two"]);
  });
  it("crash before anything was swapped rolls back: the old password opens everything", async () => {
    const s = new LogStore(dir, P, Date.now, undefined, { crashAfter: "prepare" });
    await s.create(PW);
    await s.add(data("one"));
    await expect(s.changePassword(PW, "password-two")).rejects.toThrow(/simulated crash/);
    const t = new LogStore(dir, P);
    await t.unlock(PW);
    expect(t.entries().map((e) => e.text)).toEqual(["one"]);
    expect(existsSync(join(dir, "vault.json.next"))).toBe(false);
  });
  it("never compacts away lines it couldn't decode", async () => {
    const s = new LogStore(dir, P);
    await s.create(PW);
    await s.add(data("mine"));
    const foreign = generateKeys();
    for (let i = 0; i < 5; i++) writeFileSync(logPath(), encodeRecord(foreign.publicKey, undefined, { kind: "add", id: `x${i}`, data: data("other") }) + "\n", { flag: "a" });
    s.refresh();
    expect(await s.compactIfNeeded(0)).toBe(false);
    expect(readFileSync(logPath(), "utf8").trim().split("\n")).toHaveLength(6);
  });
});

describe("I2: deleted or replayed lines are noticed", () => {
  it("removing an authentic line triggers the integrity warning", async () => {
    const s = new LogStore(dir, P);
    await s.create(PW);
    await s.add(data("A")); await s.add(data("B"));
    const lines = readFileSync(logPath(), "utf8").trim().split("\n");
    writeFileSync(logPath(), lines.slice(1).join("\n") + "\n");
    const t = new LogStore(dir, P);
    await t.unlock(PW);
    expect(t.integrityWarning).toBe(true);
  });
  it("re-appending an old authentic edit is ignored and counted", async () => {
    const s = new LogStore(dir, P);
    await s.create(PW);
    const id = await s.add(data("A"));
    await s.edit(id, data("A draft"));
    const draftLine = readFileSync(logPath(), "utf8").trim().split("\n").pop()!;
    await s.edit(id, data("A final"));
    writeFileSync(logPath(), draftLine + "\n", { flag: "a" });
    const t = new LogStore(dir, P);
    await t.unlock(PW);
    expect(t.entries()[0].text).toBe("A final");
    expect(t.forgedCount).toBe(1);
  });
  it("a clean log has no warning", async () => {
    const s = new LogStore(dir, P);
    await s.create(PW);
    await s.add(data("A"));
    const t = new LogStore(dir, P);
    await t.unlock(PW);
    expect(t.integrityWarning).toBe(false);
  });
});

describe("I4: malformed entry data", () => {
  it("is rejected at replay and can't break the export", async () => {
    const s = new LogStore(dir, P);
    await s.create(PW);
    await s.add(data("good"));
    const pub = Buffer.from(JSON.parse(readFileSync(vaultPath(), "utf8")).pub, "base64");
    writeFileSync(logPath(), encodeRecord(pub, undefined, { kind: "add", id: "evil", data: { text: {}, tags: "x" } as never }) + "\n", { flag: "a" });
    s.refresh();
    expect(s.entries().map((e) => e.text)).toEqual(["good"]);
    expect(s.forgedCount).toBe(1);
    expect(() => exportMarkdown(s.entries(), { start: 0, end: Date.UTC(2030, 0), label: "x" })).not.toThrow();
  });
});

describe("I5: import keeps 'added while locked' marks", () => {
  it("a locked add in a backup stays marked after merging", async () => {
    const other = mkdtempSync(join(tmpdir(), "wt-sec-o-"));
    const o = new LogStore(other, P);
    await o.create("other-password");
    o.lock();
    await o.add(data("possibly forged"));
    await o.unlock("other-password");
    const s = new LogStore(dir, P);
    await s.create(PW);
    await s.importMerge(o.exportBackup(), "other-password");
    expect(s.entries()[0].lockedAdd).toBe(true);
  });
});

describe("C2: git never runs repository-controlled programs", () => {
  it("a repo with log.showSignature + gpg.program can't execute code", async () => {
    const repo = mkdtempSync(join(tmpdir(), "wt-evil-"));
    const marker = join(repo, "PWNED");
    const g = (args: string[]) => execFileSync("git", ["-C", repo, ...args]).toString().trim();
    g(["init", "-q"]);
    writeFileSync(join(repo, "f"), "x");
    g(["add", "f"]);
    const tree = g(["write-tree"]);
    const when = Math.floor(Date.UTC(2026, 10, 20, 12) / 1000);
    const commit = `tree ${tree}\nauthor Me <me@x.com> ${when} +0000\ncommitter Me <me@x.com> ${when} +0000\n` +
      `gpgsig -----BEGIN PGP SIGNATURE-----\n \n iQEz\n -----END PGP SIGNATURE-----\n\nsigned commit\n`;
    writeFileSync(join(repo, "c.txt"), commit);
    const sha = g(["hash-object", "-w", "-t", "commit", "--literally", "c.txt"]);
    g(["update-ref", "HEAD", sha]);
    const evil = join(repo, "evil.sh");
    writeFileSync(evil, `#!/bin/sh\ntouch "${marker}"\n`);
    chmodSync(evil, 0o755);
    g(["config", "log.showSignature", "true"]);
    g(["config", "gpg.program", evil]);
    await gitCommits([repo], "me@x.com", (when - 3600) * 1000, (when + 3600) * 1000);
    expect(existsSync(marker)).toBe(false);
  });
});
