import { describe, expect, it } from "vitest";
import {
  layoutTimeline,
  MIN_BAR_PERCENT,
  type TimelineSession,
} from "../../renderer/utils/timelineLayout";

// Local times on one day (the layout works in local time)
const at = (h: number, m = 0) => new Date(2026, 9, 15, h, m, 0, 0);

function session(
  id: string,
  start: Date,
  end: Date | null,
  extra: Partial<TimelineSession> = {},
): TimelineSession {
  const duration = Math.round(((end ?? at(12)).getTime() - start.getTime()) / 1000);
  return { id, title: id, start, end, duration, ...extra };
}

describe("layoutTimeline", () => {
  it("uses an 08:00–18:00 axis for a normal working day", () => {
    const l = layoutTimeline([session("a", at(9), at(11))], at(12));
    expect(l.axisStart).toEqual(at(8));
    expect(l.axisEnd).toEqual(at(18));
    // 9:00 is 10% into a 10-hour axis; two hours is 20%
    expect(l.bars[0].left).toBeCloseTo(10);
    expect(l.bars[0].width).toBeCloseTo(20);
  });

  it("widens the axis to whole hours around early and late work", () => {
    const l = layoutTimeline(
      [session("early", at(6, 30), at(7, 15)), session("late", at(19), at(21, 10))],
      at(22),
    );
    expect(l.axisStart).toEqual(at(6));
    expect(l.axisEnd).toEqual(at(22));
  });

  it("draws the running session up to now", () => {
    const l = layoutTimeline(
      [session("live", at(13), null, { running: true, duration: 1800 })],
      at(14),
    );
    expect(l.bars[0].end).toEqual(at(14));
    expect(l.bars[0].width).toBeCloseTo(10);
  });

  it("clips a session that started yesterday to midnight", () => {
    const yesterday = new Date(2026, 9, 14, 23, 0);
    const l = layoutTimeline([session("night", yesterday, at(1))], at(9));
    expect(l.axisStart).toEqual(at(0));
    expect(l.bars[0].start).toEqual(at(0));
    expect(l.bars[0].left).toBeCloseTo(0);
  });

  it("keeps very short sessions visible", () => {
    const l = layoutTimeline([session("blip", at(10), at(10, 0))], at(12));
    expect(l.bars[0].width).toBe(MIN_BAR_PERCENT);
  });

  it("puts labels every two hours on even hours", () => {
    const l = layoutTimeline([], at(12));
    expect(l.ticks.map((t) => t.at.getHours())).toEqual([8, 10, 12, 14, 16, 18]);
    expect(l.ticks[0].left).toBe(0);
    expect(l.ticks.at(-1)?.left).toBe(100);
  });

  it("draws drafts but keeps them out of the tracked totals", () => {
    const l = layoutTimeline(
      [
        session("a", at(9), at(10), { duration: 3000, billable: true }),
        session("d", at(10, 30), at(11), { duration: 1500, draft: true, supervisingSeconds: 600 }),
      ],
      at(13),
    );
    expect(l.bars.map((b) => b.session.id)).toEqual(["a", "d"]);
    expect(l.totalSeconds).toBe(3000);
    expect(l.billableSeconds).toBe(3000);
    expect(l.supervisingSeconds).toBe(0);
    expect(l.draftSeconds).toBe(1500);
  });

  it("sums active and billable time", () => {
    const l = layoutTimeline(
      [
        session("a", at(9), at(10), { duration: 3000, billable: true }),
        session("b", at(11), at(12), { duration: 3600 }),
      ],
      at(13),
    );
    expect(l.totalSeconds).toBe(6600);
    expect(l.billableSeconds).toBe(3000);
  });

  it("places supervising slices on the axis, clipped to the session", () => {
    const l = layoutTimeline(
      [
        session("a", at(9), at(11), {
          supervisingSeconds: 3600,
          supervisingSpans: [
            { start: at(10), end: at(11) },
            // Outside the session's visible span: dropped
            { start: at(13), end: at(14) },
          ],
        }),
      ],
      at(12),
    );
    expect(l.supervising).toHaveLength(1);
    expect(l.supervising[0].left).toBeCloseTo(20);
    expect(l.supervising[0].width).toBeCloseTo(10);
    expect(l.supervisingSeconds).toBe(3600);
  });

  it("bills supervising time only where the project bills it", () => {
    const l = layoutTimeline(
      [
        session("a", at(9), at(10), { billable: true, billedSeconds: 1800 }),
        session("b", at(10), at(11), { billable: true }),
      ],
      at(12),
    );
    expect(l.billableSeconds).toBe(1800 + 3600);
  });
});
