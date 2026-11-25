// Crash-safe file helpers (from Authora): cross-process lock file, durable atomic writes, durable appends.
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";

const LOCK_STALE_MS = 15_000;
const LOCK_WAIT_MS = 8_000;

export async function withFileLock<T>(lockPath: string, fn: () => Promise<T> | T): Promise<T> {
  mkdirSync(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  let fd: number | null = null;
  while (fd === null) {
    try {
      fd = openSync(lockPath, "wx", 0o600);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) unlinkSync(lockPath);
      } catch { /* raced with another remover */ }
      if (Date.now() > deadline) throw new Error("Wintrail is busy in another window. Try again.");
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  try {
    return await fn();
  } finally {
    closeSync(fd);
    try { unlinkSync(lockPath); } catch { /* ignore */ }
  }
}

function fsyncDir(path: string) {
  try {
    const d = openSync(dirname(path), "r");
    try { fsyncSync(d); } finally { closeSync(d); }
  } catch { /* unsupported (Windows) */ }
}

/** temp file + fsync, optional .bak of the previous version, atomic rename, directory fsync. */
export function writeDurable(path: string, content: string, keepBak = true) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  const fd = openSync(tmp, "w", 0o600);
  try { writeSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
  if (keepBak && existsSync(path)) copyFileSync(path, path + ".bak");
  renameSync(tmp, path);
  fsyncDir(path);
}

/** Append + fsync. Callers hold the lock file, so lines never interleave. */
export function appendDurable(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "a", 0o600);
  try { writeSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
}
