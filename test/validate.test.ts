import { describe, it, expect } from "vitest";
import { isValidViewMsg } from "../src/shared/validate";

describe("isValidViewMsg", () => {
  it("accepts well-formed messages", () => {
    for (const m of [
      { type: "ready" }, { type: "lock" }, { type: "quickAdd", text: "!Shipped #perf" },
      { type: "unlock", password: "pw", remember: false }, { type: "edit", id: "abc", text: "x" },
      { type: "setImpact", id: "a", impact: "high" }, { type: "selectYear", offset: -2 },
      { type: "copyStandup", yesterday: ["a"], today: "b", blockers: "None" },
      { type: "setBreaks", config: { intervals: { eyes: 25, stretch: 50, water: 75 }, snoozeMin: 5 } },
      { type: "focus", minutes: 60 }, { type: "focus", minutes: 0 }, { type: "previewBreak", kind: "stretch" },
      { type: "changePassword", oldPassword: "a", newPassword: "b" },
    ]) expect(isValidViewMsg(m), JSON.stringify(m)).toBe(true);
  });
  it("rejects bad types, shapes and out-of-range values", () => {
    for (const m of [
      null, "x", { type: "nope" }, { type: "__proto__" }, { type: "quickAdd", text: 5 },
      { type: "quickAdd", text: "x".repeat(2001) }, { type: "unlock", password: "pw" },
      { type: "setImpact", id: "a", impact: "huge" }, { type: "selectYear", offset: 1 }, { type: "selectYear", offset: -100 },
      { type: "copyStandup", yesterday: "a", today: "", blockers: "" },
      { type: "copyStandup", yesterday: Array(50).fill("a"), today: "", blockers: "" },
      { type: "setBreaks", config: { intervals: { eyes: "20" } } },
      { type: "setBreaks", config: { workHours: { start: "9am", end: "18:00" } } },
      { type: "focus", minutes: 100000 }, { type: "previewBreak", kind: "nap" },
    ]) expect(isValidViewMsg(m), JSON.stringify(m)).toBe(false);
  });
});
