// Run under several time zones by `npm run test:tz` (TZ is set in the environment before Node starts).
import { describe, it, expect } from "vitest";
import { localDay, streak } from "../src/core/stats";

describe(`local time (TZ=${process.env.TZ ?? "system"})`, () => {
  it("an entry at 23:30 local belongs to that local day", () => {
    expect(localDay(new Date(2026, 10, 24, 23, 30).getTime())).toBe("2026-11-24");
    expect(localDay(new Date(2026, 10, 25, 0, 10).getTime())).toBe("2026-11-25");
  });
  it("days stay correct across a DST change (US DST ends 1 Nov 2026)", () => {
    expect(localDay(new Date(2026, 10, 1, 1, 30).getTime())).toBe("2026-11-01");
    expect(localDay(new Date(2026, 10, 2, 0, 30).getTime())).toBe("2026-11-02");
    const ts = [new Date(2026, 9, 30, 23, 0).getTime(), new Date(2026, 10, 2, 9, 0).getTime()]; // Fri, Mon
    expect(streak(ts.map((at) => ({ at })) as never, "2026-11-02")).toBe(2);
  });
});
