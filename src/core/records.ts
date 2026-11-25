// On-disk record format. One JSONL line = { r: random id, s: sealed blob, m?: MAC }.
// Everything meaningful (kind, ids, entry data) is inside the sealed, padded plaintext.
import { randomBytes } from "node:crypto";
import { Opener, SealedBlob, mac, openSealed, pad, sealTo, unpad, verifyMac } from "./keys";

export interface EntryData {
  text: string;
  at: number;
  project: string;
  branch: string;
  tags: string[];
  star: boolean;
  impact: "normal" | "high";
}
export interface Plan { day: string; text: string }

export type Rec =
  | { kind: "add"; id: string; data: EntryData; locked?: boolean }
  | { kind: "edit"; target: string; data: EntryData }
  | { kind: "delete"; target: string }
  | { kind: "confirm"; target: string }
  | { kind: "plan"; plan: Plan };

interface Line { r: string; s: SealedBlob; m?: string }

const macInput = (r: string, s: SealedBlob) => r + "." + s.epk + "." + s.iv + "." + s.ct;

export function encodeRecord(publicKey: Buffer, macKey: Buffer | undefined, rec: Rec): string {
  const r = randomBytes(12).toString("base64url");
  const s = sealTo(publicKey, pad(Buffer.from(JSON.stringify(rec), "utf8")));
  const line: Line = { r, s };
  if (macKey) line.m = mac(macKey, macInput(r, s));
  return JSON.stringify(line);
}

/** null = unreadable (torn, corrupt, or sealed to another key). */
export function decodeLine(line: string, opener: Opener, macKey: Buffer): { rec: Rec; authentic: boolean } | null {
  try {
    const l = JSON.parse(line) as Line;
    if (!l || typeof l.r !== "string" || !l.s) return null;
    const rec = JSON.parse(unpad(openSealed(opener, l.s)).toString("utf8")) as Rec;
    if (!rec || typeof rec !== "object" || typeof (rec as { kind?: unknown }).kind !== "string") return null;
    const authentic = typeof l.m === "string" && verifyMac(macKey, macInput(l.r, l.s), l.m);
    return { rec, authentic };
  } catch {
    return null;
  }
}
