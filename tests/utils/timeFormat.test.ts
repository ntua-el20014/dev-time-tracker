import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  toLocalDateString,
  localDayStartISO,
  localDayEndISO,
} from "../../src/utils/timeFormat";

// Pin a timezone ahead of UTC so day-boundary bugs are visible.
// Europe/Athens is UTC+3 in summer (EEST).
const originalTZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Europe/Athens";
});
afterAll(() => {
  process.env.TZ = originalTZ;
});

describe("local-day helpers", () => {
  it("toLocalDateString uses the local day, not the UTC day", () => {
    // 00:30 local on Oct 14 is still Oct 13 in UTC
    expect(toLocalDateString("2026-10-13T21:30:00.000Z")).toBe("2026-10-14");
    expect(toLocalDateString(new Date("2026-10-13T21:30:00.000Z"))).toBe(
      "2026-10-14",
    );
  });

  it("localDayStartISO returns local midnight as a UTC instant", () => {
    expect(localDayStartISO("2026-10-14")).toBe("2026-10-13T21:00:00.000Z");
  });

  it("localDayEndISO returns the last ms of the local day", () => {
    expect(localDayEndISO("2026-10-14")).toBe("2026-10-14T20:59:59.999Z");
  });

  it("passes full timestamps through unchanged", () => {
    const ts = "2026-10-14T12:00:00.000Z";
    expect(localDayStartISO(ts)).toBe(ts);
    expect(localDayEndISO(ts)).toBe(ts);
  });
});
