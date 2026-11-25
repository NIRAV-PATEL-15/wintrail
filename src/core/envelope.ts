import { argon2id } from "hash-wasm";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface KdfParams {
  alg: "argon2id";
  salt: string; // base64
  m: number; // memory KiB
  t: number; // iterations
  p: number; // parallelism
}

export interface Envelope {
  v: 1;
  kdf: KdfParams;
  iv: string; // base64, 12 bytes
  ct: string; // base64, ciphertext || 16-byte GCM tag
}

export class WrongPasswordError extends Error {
  constructor() {
    super("Wrong password or corrupted data");
    this.name = "WrongPasswordError";
  }
}

export type KdfCost = Pick<KdfParams, "m" | "t" | "p">;
export const DEFAULT_KDF: KdfCost = { m: 65536, t: 3, p: 1 };
/** Cheap parameters so unit tests run fast. Never use in production. */
export const FAST_KDF_FOR_TESTS: KdfCost = { m: 1024, t: 1, p: 1 };

export function newKdf(cost: KdfCost = DEFAULT_KDF): KdfParams {
  return { alg: "argon2id", salt: randomBytes(16).toString("base64"), ...cost };
}

export async function deriveKey(password: string, kdf: KdfParams): Promise<Buffer> {
  const out = await argon2id({
    password: password.normalize("NFKC"),
    salt: Buffer.from(kdf.salt, "base64"),
    memorySize: kdf.m,
    iterations: kdf.t,
    parallelism: kdf.p,
    hashLength: 32,
    outputType: "binary",
  });
  return Buffer.from(out);
}

export function sealWithKey(data: unknown, key: Buffer, kdf: KdfParams): Envelope {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(data), "utf8"), c.final(), c.getAuthTag()]);
  return { v: 1, kdf, iv: iv.toString("base64"), ct: ct.toString("base64") };
}

export function openWithKey(env: Envelope, key: Buffer): unknown {
  try {
    const buf = Buffer.from(env.ct, "base64");
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"));
    d.setAuthTag(buf.subarray(buf.length - 16));
    const pt = Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]);
    return JSON.parse(pt.toString("utf8"));
  } catch {
    throw new WrongPasswordError();
  }
}

export async function seal(data: unknown, password: string, cost: KdfCost = DEFAULT_KDF): Promise<Envelope> {
  const kdf = newKdf(cost);
  return sealWithKey(data, await deriveKey(password, kdf), kdf);
}

export async function open(env: Envelope, password: string): Promise<unknown> {
  if (!isEnvelope(env)) throw new Error("Unsupported or unsafe encryption parameters");
  return openWithKey(env, await deriveKey(password, env.kdf));
}

/** Bounds for KDF parameters we accept from files (a hostile backup must not freeze VS Code). */
export const KDF_LIMITS = { mMin: 1024, mMax: 262_144, tMin: 1, tMax: 10, pMin: 1, pMax: 4 } as const;

const intIn = (n: unknown, lo: number, hi: number) => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;
const b64Len = (s: unknown) => (typeof s === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(s) ? Buffer.from(s, "base64").length : -1);

/** Argon2id parameters within safe bounds (a hostile file must not freeze VS Code). */
export function isKdfSafe(k: unknown): k is KdfParams {
  const x = k as KdfParams;
  return !!x && typeof x === "object" && x.alg === "argon2id"
    && intIn(x.m, KDF_LIMITS.mMin, KDF_LIMITS.mMax)
    && intIn(x.t, KDF_LIMITS.tMin, KDF_LIMITS.tMax)
    && intIn(x.p, KDF_LIMITS.pMin, KDF_LIMITS.pMax)
    && b64Len(x.salt) >= 16;
}

/** Structural check plus sane bounds on everything that drives work or allocation. */
export function isEnvelope(x: unknown): x is Envelope {
  const e = x as Envelope;
  if (!e || typeof e !== "object" || e.v !== 1 || !e.kdf || typeof e.kdf !== "object") return false;
  const k = e.kdf;
  return k.alg === "argon2id"
    && intIn(k.m, KDF_LIMITS.mMin, KDF_LIMITS.mMax)
    && intIn(k.t, KDF_LIMITS.tMin, KDF_LIMITS.tMax)
    && intIn(k.p, KDF_LIMITS.pMin, KDF_LIMITS.pMax)
    && b64Len(k.salt) >= 16
    && b64Len(e.iv) === 12
    && b64Len(e.ct) >= 16;
}

/** True when `x` looks like an envelope (so we can give a specific error instead of "unknown format"). */
export function looksLikeEnvelope(x: unknown): boolean {
  const e = x as Envelope;
  return !!e && typeof e === "object" && e.v === 1 && !!e.kdf && typeof e.iv === "string";
}
