import { describe, it, expect } from "vitest";
import {
  generateKeys, wrapKeys, unwrapKeys, sealTo, openSealed, mac, verifyMac, pad, unpad,
} from "../src/core/keys";
import { FAST_KDF_FOR_TESTS, WrongPasswordError } from "../src/core/envelope";

describe("sealed boxes", () => {
  it("seal then open round-trips", () => {
    const k = generateKeys();
    const blob = sealTo(k.publicKey, Buffer.from("hello wintrail"));
    expect(openSealed(k.privateKey, blob).toString()).toBe("hello wintrail");
  });
  it("two seals of the same plaintext differ (fresh ephemeral key + IV)", () => {
    const k = generateKeys();
    const a = sealTo(k.publicKey, Buffer.from("x"));
    const b = sealTo(k.publicKey, Buffer.from("x"));
    expect(a.epk).not.toBe(b.epk);
    expect(a.ct).not.toBe(b.ct);
  });
  it("openSealed with the wrong private key throws", () => {
    const a = generateKeys(), b = generateKeys();
    const blob = sealTo(a.publicKey, Buffer.from("secret"));
    expect(() => openSealed(b.privateKey, blob)).toThrow();
  });
  it("a flipped ciphertext byte throws", () => {
    const k = generateKeys();
    const blob = sealTo(k.publicKey, Buffer.from("secret"));
    const ct = Buffer.from(blob.ct, "base64");
    ct[0] ^= 1;
    expect(() => openSealed(k.privateKey, { ...blob, ct: ct.toString("base64") })).toThrow();
  });
});

describe("key wrapping", () => {
  it("unwraps with the right password and returns the same keys", async () => {
    const k = generateKeys();
    const w = await wrapKeys(k, "correct horse", FAST_KDF_FOR_TESTS);
    expect(w.v).toBe(1);
    expect(Buffer.from(w.pub, "base64")).toEqual(k.publicKey);
    const u = await unwrapKeys(w, "correct horse");
    expect(u.privateKey).toEqual(k.privateKey);
    expect(u.macKey).toEqual(k.macKey);
    expect(u.wrapKey.length).toBe(32);
  });
  it("wrong password throws WrongPasswordError", async () => {
    const w = await wrapKeys(generateKeys(), "correct horse", FAST_KDF_FOR_TESTS);
    await expect(unwrapKeys(w, "nope")).rejects.toBeInstanceOf(WrongPasswordError);
  });
  it("private key and mac key are not visible in the wrapped JSON", async () => {
    const k = generateKeys();
    const json = JSON.stringify(await wrapKeys(k, "pw", FAST_KDF_FOR_TESTS));
    expect(json).not.toContain(k.privateKey.toString("base64"));
    expect(json).not.toContain(k.macKey.toString("base64"));
  });
});

describe("mac", () => {
  it("verifies its own tag and rejects modified data", () => {
    const { macKey } = generateKeys();
    const tag = mac(macKey, "record-1");
    expect(verifyMac(macKey, "record-1", tag)).toBe(true);
    expect(verifyMac(macKey, "record-2", tag)).toBe(false);
    expect(verifyMac(generateKeys().macKey, "record-1", tag)).toBe(false);
    expect(verifyMac(macKey, "record-1", "garbage")).toBe(false);
  });
});

describe("padding", () => {
  it("pads to 256-byte buckets and round-trips", () => {
    expect(pad(Buffer.alloc(1)).length).toBe(256);
    expect(pad(Buffer.alloc(250)).length).toBe(256);
    expect(pad(Buffer.alloc(300)).length).toBe(512);
    const msg = Buffer.from("padded message");
    expect(unpad(pad(msg))).toEqual(msg);
  });
  it("unpad rejects a corrupt length prefix", () => {
    const p = pad(Buffer.from("x"));
    p.writeUInt32BE(9999, 0);
    expect(() => unpad(p)).toThrow();
  });
});
