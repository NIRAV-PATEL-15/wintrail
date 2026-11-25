// Key material for Wintrail's "write without unlocking" log.
//  - An X25519 key pair: anyone holding the public key can seal entries (works while locked);
//    only the private key (unwrapped with the password) can open them.
//  - A MAC key (HMAC-SHA256): only an unlocked session can authenticate edits/deletes.
import {
  createCipheriv, createDecipheriv, createHmac, createPrivateKey, createPublicKey, diffieHellman,
  generateKeyPairSync, hkdfSync, randomBytes, timingSafeEqual, KeyObject,
} from "node:crypto";
import { DEFAULT_KDF, KdfCost, KdfParams, WrongPasswordError, deriveKey, newKdf, isKdfSafe } from "./envelope";

export interface KeySet {
  publicKey: Buffer; // raw 32-byte X25519 public key
  privateKey: Buffer; // PKCS#8 DER
  macKey: Buffer; // 32 bytes
}

export interface WrappedKeys {
  v: 1;
  kdf: KdfParams;
  pub: string; // base64 raw public key (plaintext: sealing must work while locked)
  iv: string;
  ct: string; // AES-256-GCM(JSON {priv, mac}) || tag
}

export interface SealedBlob {
  epk: string; // ephemeral public key (base64 raw)
  iv: string;
  ct: string; // ciphertext || tag
}

const SEAL_INFO = Buffer.from("wintrail-seal-v1");
const b64 = (b: Buffer) => b.toString("base64");
const unb64 = (s: string) => Buffer.from(s, "base64");

function rawPublic(k: KeyObject): Buffer {
  const jwk = k.export({ format: "jwk" }) as { x: string };
  return Buffer.from(jwk.x, "base64url");
}
function publicFromRaw(raw: Buffer): KeyObject {
  if (raw.length !== 32) throw new Error("Bad public key");
  return createPublicKey({ key: { kty: "OKP", crv: "X25519", x: raw.toString("base64url") }, format: "jwk" });
}

export function generateKeys(): KeySet {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return {
    publicKey: rawPublic(publicKey),
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }) as Buffer,
    macKey: randomBytes(32),
  };
}

function gcmEncrypt(key: Buffer, data: Buffer): { iv: string; ct: string } {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  return { iv: b64(iv), ct: b64(Buffer.concat([c.update(data), c.final(), c.getAuthTag()])) };
}
function gcmDecrypt(key: Buffer, ivB64: string, ctB64: string): Buffer {
  const buf = unb64(ctB64);
  if (buf.length < 16) throw new Error("Ciphertext too short");
  const d = createDecipheriv("aes-256-gcm", key, unb64(ivB64));
  d.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]);
}

export async function wrapKeys(k: KeySet, password: string, cost: KdfCost = DEFAULT_KDF): Promise<WrappedKeys> {
  const kdf = newKdf(cost);
  return wrapKeysWith(k, await deriveKey(password, kdf), kdf);
}

export function wrapKeysWith(k: KeySet, wrapKey: Buffer, kdf: KdfParams): WrappedKeys {
  const inner = Buffer.from(JSON.stringify({ priv: b64(k.privateKey), mac: b64(k.macKey) }));
  return { v: 1, kdf, pub: b64(k.publicKey), ...gcmEncrypt(wrapKey, inner) };
}

export function isWrappedKeys(x: unknown): x is WrappedKeys {
  const w = x as WrappedKeys;
  return !!w && w.v === 1 && isKdfSafe(w.kdf) && typeof w.pub === "string" && unb64(w.pub).length === 32
    && typeof w.iv === "string" && unb64(w.iv).length === 12 && typeof w.ct === "string";
}

/** Open the wrapped keys with an already-derived wrap key (e.g. remembered in the OS keychain). */
export function unwrapWithKey(w: WrappedKeys, wrapKey: Buffer): { privateKey: Buffer; macKey: Buffer } {
  let inner: { priv: string; mac: string };
  try {
    inner = JSON.parse(gcmDecrypt(wrapKey, w.iv, w.ct).toString("utf8"));
  } catch {
    throw new WrongPasswordError();
  }
  return { privateKey: unb64(inner.priv), macKey: unb64(inner.mac) };
}

export async function unwrapKeys(w: WrappedKeys, password: string): Promise<{ privateKey: Buffer; macKey: Buffer; wrapKey: Buffer }> {
  if (!isWrappedKeys(w)) throw new Error("Key file is not recognised or has unsafe parameters");
  const wrapKey = await deriveKey(password, w.kdf);
  try {
    return { ...unwrapWithKey(w, wrapKey), wrapKey };
  } catch (e) {
    wrapKey.fill(0);
    throw e;
  }
}

function sealKey(shared: Buffer, epk: Buffer, recipient: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", shared, Buffer.concat([epk, recipient]), SEAL_INFO, 32));
}

/** Anonymous sealed box: ephemeral X25519 → ECDH → HKDF-SHA256 → AES-256-GCM. */
export function sealTo(publicKey: Buffer, plaintext: Buffer): SealedBlob {
  const recipient = publicFromRaw(publicKey);
  const eph = generateKeyPairSync("x25519");
  const epk = rawPublic(eph.publicKey);
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: recipient });
  const key = sealKey(shared, epk, publicKey);
  const out = gcmEncrypt(key, plaintext);
  key.fill(0);
  shared.fill(0);
  return { epk: b64(epk), ...out };
}

/** A private key prepared once (KeyObject + raw public key), for fast bulk opening. */
export interface Opener { priv: KeyObject; recipient: Buffer }
export function makeOpener(privateKey: Buffer): Opener {
  const priv = createPrivateKey({ key: privateKey, format: "der", type: "pkcs8" });
  return { priv, recipient: rawPublic(createPublicKey(priv)) };
}

export function openSealed(privateKey: Buffer | Opener, b: SealedBlob): Buffer {
  const { priv, recipient } = Buffer.isBuffer(privateKey) ? makeOpener(privateKey) : privateKey;
  const epk = unb64(b.epk);
  const shared = diffieHellman({ privateKey: priv, publicKey: publicFromRaw(epk) });
  const key = sealKey(shared, epk, recipient);
  try {
    return gcmDecrypt(key, b.iv, b.ct);
  } finally {
    key.fill(0);
    shared.fill(0);
  }
}

export function mac(macKey: Buffer, data: string): string {
  return createHmac("sha256", macKey).update(data, "utf8").digest("base64");
}

export function verifyMac(macKey: Buffer, data: string, tag: string): boolean {
  const expected = createHmac("sha256", macKey).update(data, "utf8").digest();
  const got = Buffer.from(String(tag), "base64");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

const BUCKET = 256;
/** 4-byte big-endian length prefix, then zero padding to a multiple of 256 bytes (hides entry length). */
export function pad(buf: Buffer): Buffer {
  const total = Math.ceil((buf.length + 4) / BUCKET) * BUCKET;
  const out = Buffer.alloc(total);
  out.writeUInt32BE(buf.length, 0);
  buf.copy(out, 4);
  return out;
}

export function unpad(buf: Buffer): Buffer {
  if (buf.length < 4) throw new Error("Padded data too short");
  const n = buf.readUInt32BE(0);
  if (n > buf.length - 4) throw new Error("Corrupt padding");
  return buf.subarray(4, 4 + n);
}
