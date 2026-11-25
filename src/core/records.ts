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

/** Strict shape check for entry data coming out of a file (a forged record must not break the UI/export). */
export function isEntryData(d: unknown): d is EntryData {
  const x = d as EntryData;
  return !!x && typeof x === "object"
    && typeof x.text === "string" && x.text.length > 0 && x.text.length <= 500
    && typeof x.at === "number" && Number.isFinite(x.at)
    && typeof x.project === "string" && x.project.length <= 200
    && typeof x.branch === "string" && x.branch.length <= 250
    && Array.isArray(x.tags) && x.tags.length <= 50 && x.tags.every((t) => typeof t === "string" && t.length <= 64)
    && typeof x.star === "boolean" && (x.impact === "normal" || x.impact === "high");
}

/** Only the known fields, so nothing else is ever sealed or displayed. */
export function pickEntryData(d: EntryData): EntryData {
  return { text: d.text, at: d.at, project: d.project, branch: d.branch, tags: [...d.tags], star: d.star, impact: d.impact };
}

/** null = unreadable (torn, corrupt, or sealed to another key). `r`/`m` let replay spot duplicates and check the head. */
export function decodeLine(line: string, opener: Opener, macKey: Buffer): { rec: Rec; authentic: boolean; r: string; m?: string } | null {
  try {
    const l = JSON.parse(line) as Line;
    if (!l || typeof l.r !== "string" || !l.s) return null;
    const rec = JSON.parse(unpad(openSealed(opener, l.s)).toString("utf8")) as Rec;
    if (!rec || typeof rec !== "object" || typeof (rec as { kind?: unknown }).kind !== "string") return null;
    const authentic = typeof l.m === "string" && verifyMac(macKey, macInput(l.r, l.s), l.m);
    return { rec, authentic, r: l.r, m: authentic ? l.m : undefined };
  } catch {
    return null;
  }
}
