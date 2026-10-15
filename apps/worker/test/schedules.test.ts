import { describe, expect, it } from "vitest";
import { MAINTENANCE_HANDLERS, MAINTENANCE_SCHEDULES } from "../src/processors/maintenance";

describe("maintenance schedules", () => {
  it("schedules every maintenance job exactly once", () => {
    const scheduled = MAINTENANCE_SCHEDULES.map((s) => s.name).sort();
    expect(scheduled).toEqual(Object.keys(MAINTENANCE_HANDLERS).sort());
    expect(new Set(scheduled).size).toBe(scheduled.length);
  });

  it("uses either a positive interval or a five-field cron pattern", () => {
    for (const s of MAINTENANCE_SCHEDULES) {
      if (s.every !== undefined) expect(s.every).toBeGreaterThan(0);
      else expect(s.pattern?.trim().split(/\s+/)).toHaveLength(5);
    }
  });
});
