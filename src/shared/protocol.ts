// Host ⇄ webview messages. The webview never receives keys or ciphertext — only what it displays.
import type { BreakConfig, BreakKind } from "../core/breaks";
import type { HeatLevel } from "../core/stats";

export interface EntryView {
  id: string; text: string; at: number; day: string; project: string; branch: string;
  tags: string[]; star: boolean; impact: "normal" | "high"; lockedAdd: boolean;
}
export interface YearView {
  offset: number; // 0 = current appraisal year, -1 = previous …
  label: string;
  total: number;
  projects: number;
  byProject: [string, number][];
  byTag: [string, number][];
  highlights: EntryView[];
}
export interface StandupView { yesterday: string[]; today: string; blockers: string; previousPlan?: string; previousDay: string }
export interface BreaksView {
  config: BreakConfig;
  week: Record<BreakKind, { taken: number; due: number }>;
  focusEndsAt: number | null;
}

export type ViewState =
  | { screen: "setup" }
  | { screen: "locked"; throttledMs?: number; remember: boolean }
  | {
      screen: "unlocked";
      today: string;
      entries: EntryView[];
      stats: { streak: number; starsThisMonth: number; entriesThisYear: number };
      heatmap: { day: string; count: number; level: HeatLevel }[];
      year: YearView;
      standup: StandupView;
      breaks: BreaksView;
      forgedCount: number;
      backupWarning: "none" | "stale" | null;
      autoBackupFolder: string;
    };

export type HostMsg =
  | { type: "state"; state: ViewState }
  | { type: "toast"; text: string; kind?: "ok" | "error" }
  | { type: "error"; form: string; text: string }
  | { type: "done"; form: string }
  | { type: "tab"; tab: "today" | "standup" | "year" }
  | { type: "added"; id: string };

export type ViewMsg =
  | { type: "ready" }
  | { type: "activity" }
  | { type: "create"; password: string }
  | { type: "unlock"; password: string; remember: boolean }
  | { type: "lock" }
  | { type: "quickAdd"; text: string }
  | { type: "edit"; id: string; text: string }
  | { type: "toggleStar"; id: string }
  | { type: "setImpact"; id: string; impact: "normal" | "high" }
  | { type: "delete"; id: string }
  | { type: "confirm"; id: string }
  | { type: "selectYear"; offset: number }
  | { type: "copyStandup"; yesterday: string[]; today: string; blockers: string }
  | { type: "exportAppraisal"; offset: number }
  | { type: "copyHighlights"; offset: number }
  | { type: "chooseBackupFolder" }
  | { type: "backupNow" }
  | { type: "exportBackup" }
  | { type: "importBackup" }
  | { type: "changePassword"; oldPassword: string; newPassword: string }
  | { type: "setBreaks"; config: Partial<BreakConfig> }
  | { type: "resetBreaks" }
  | { type: "focus"; minutes: number }
  | { type: "previewBreak"; kind: BreakKind };
