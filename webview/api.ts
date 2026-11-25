import type { ViewMsg } from "../src/shared/protocol";

declare function acquireVsCodeApi(): { postMessage(m: ViewMsg): void };
const vs = acquireVsCodeApi();
export const send = (m: ViewMsg) => vs.postMessage(m);

export const fmtDay = (day: string, today: string): string => {
  if (day === today) return "Today";
  const d = new Date(day + "T12:00:00"), t = new Date(today + "T12:00:00");
  const diff = Math.round((t.getTime() - d.getTime()) / 86_400_000);
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() !== t.getFullYear() ? { year: "numeric" } : {}) });
};
export const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
export const monthName = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: "long", year: "numeric" });

export function strength(pw: string): { score: number; label: string } {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^\w\s]/.test(pw)) s++;
  if (pw.length >= 16) s++;
  const score = Math.min(4, Math.floor((s * 4) / 6));
  return { score, label: ["Too weak", "Weak", "Fair", "Good", "Strong"][score] };
}
