import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { backupFileName, writeBackupFile } from "../src/core/backupfiles";

describe("auto-backup files", () => {
  it("names files by local timestamp", () => {
    expect(backupFileName(new Date(2026, 10, 25, 9, 5, 7))).toBe("wintrail-20261125-090507.wintrail");
  });
  it("keeps only the newest N of its own files, leaves others alone, owner-only perms", () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-bk-"));
    writeFileSync(join(dir, "notes.txt"), "mine");
    for (let i = 0; i < 4; i++) writeBackupFile(dir, `backup ${i}`, 2, new Date(2026, 0, 1, 0, 0, i));
    expect(readdirSync(dir).sort()).toEqual(["notes.txt", "wintrail-20260101-000002.wintrail", "wintrail-20260101-000003.wintrail"]);
    if (process.platform !== "win32") expect(statSync(join(dir, "wintrail-20260101-000003.wintrail")).mode & 0o777).toBe(0o600);
  });
});
