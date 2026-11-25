import type { ViewMsg } from "./protocol";

const str = (v: unknown, max = 512) => typeof v === "string" && v.length <= max;
const bool = (v: unknown) => typeof v === "boolean";
const int = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const KINDS = ["eyes", "stretch", "water"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Shape check only; values are clamped again by clampBreakConfig on the host. */
function validBreaks(c: unknown): boolean {
  if (!obj(c)) return false;
  const perKind = (k: string, check: (v: unknown) => boolean) => {
    const v = c[k];
    if (v === undefined) return true;
    if (!obj(v)) return false;
    return Object.entries(v).every(([kk, vv]) => KINDS.includes(kk) && check(vv));
  };
  const nums = ["eyeSeconds", "stretchSeconds", "snoozeMin", "idleMin", "resetMin"];
  return perKind("intervals", (v) => int(v, 1, 1000))
    && perKind("enabled", bool)
    && perKind("style", (v) => v === "notification" || v === "screen")
    && nums.every((n) => c[n] === undefined || int(c[n], 0, 10_000))
    && (c.focusPresets === undefined || (Array.isArray(c.focusPresets) && c.focusPresets.length <= 3 && c.focusPresets.every((v) => int(v, 1, 1000))))
    && (c.workHours === undefined || c.workHours === null
      || (obj(c.workHours) && str(c.workHours.start, 5) && str(c.workHours.end, 5)
        && HHMM.test(c.workHours.start as string) && HHMM.test(c.workHours.end as string)))
    && Object.keys(c).every((k) => ["intervals", "enabled", "style", "focusPresets", "workHours", ...nums].includes(k));
}

export function isValidViewMsg(x: unknown): x is ViewMsg {
  if (!obj(x)) return false;
  const m = x;
  switch (m.type) {
    case "ready": case "activity": case "lock": case "chooseBackupFolder": case "backupNow":
    case "exportBackup": case "importBackup": case "resetBreaks":
      return true;
    case "create": return str(m.password, 1024);
    case "unlock": return str(m.password, 1024) && bool(m.remember);
    case "quickAdd": return str(m.text, 2000);
    case "edit": return str(m.id, 64) && str(m.text, 2000);
    case "toggleStar": case "delete": case "confirm": return str(m.id, 64);
    case "setImpact": return str(m.id, 64) && (m.impact === "normal" || m.impact === "high");
    case "selectYear": case "exportAppraisal": case "copyHighlights": return int(m.offset, -50, 0);
    case "copyStandup":
      return Array.isArray(m.yesterday) && m.yesterday.length <= 10 && m.yesterday.every((l) => str(l, 600))
        && str(m.today, 600) && str(m.blockers, 600);
    case "changePassword": return str(m.oldPassword, 1024) && str(m.newPassword, 1024);
    case "setBreaks": return validBreaks(m.config);
    case "focus": return int(m.minutes, 0, 24 * 60);
    case "previewBreak": return KINDS.includes(m.kind as string);
    default: return false;
  }
}
