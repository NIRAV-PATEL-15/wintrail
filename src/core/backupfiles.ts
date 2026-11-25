import { chmodSync, mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PATTERN = /^wintrail-\d{8}-\d{6}\.wintrail$/;
const p2 = (n: number) => String(n).padStart(2, "0");

export function backupFileName(d: Date): string {
  return `wintrail-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.wintrail`;
}

/** Write an (already encrypted) backup into `dir` and delete our older ones beyond `keep`. */
export function writeBackupFile(dir: string, content: string, keep: number, when = new Date()): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, backupFileName(when));
  writeFileSync(file + ".tmp", content, { mode: 0o600 });
  try { chmodSync(file + ".tmp", 0o600); } catch { /* unsupported fs */ }
  renameSync(file + ".tmp", file);
  const ours = readdirSync(dir).filter((f) => PATTERN.test(f)).sort();
  for (const old of ours.slice(0, Math.max(0, ours.length - Math.max(1, keep)))) unlinkSync(join(dir, old));
  return file;
}
