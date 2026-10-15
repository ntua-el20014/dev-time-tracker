/**
 * Layout for Home's "Today" timeline: where each session sits on a
 * horizontal axis of the local day. Pure, so it can be tested.
 *
 * The axis covers at least 08:00–18:00 and widens to whole hours around the
 * earliest and latest session (and "now" while recording).
 */

export interface TimelineSession {
  id: string;
  title: string;
  start: Date;
  /** Wall-clock end; null for the running session (ends "now") */
  end: Date | null;
  /** Active seconds (pauses excluded) */
  duration: number;
  projectName?: string | null;
  color?: string | null;
  billable?: boolean;
  running?: boolean;
}

export interface TimelineBar {
  session: TimelineSession;
  /** Percent of the axis from the left edge */
  left: number;
  /** Percent of the axis; at least MIN_BAR_PERCENT so short work shows */
  width: number;
  start: Date;
  end: Date;
}

export interface TimelineLayout {
  axisStart: Date;
  axisEnd: Date;
  bars: TimelineBar[];
  /** Hour marks for labels, every two hours */
  ticks: { at: Date; left: number }[];
  totalSeconds: number;
  billableSeconds: number;
}

export const MIN_BAR_PERCENT = 0.6;
const HOUR = 3600_000;

function atHour(day: Date, hour: number): Date {
  const d = new Date(day);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export function layoutTimeline(
  sessions: TimelineSession[],
  now: Date,
): TimelineLayout {
  const dayStart = atHour(now, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * HOUR);

  // Clip every session to today, up to now
  const spans = sessions
    .map((session) => {
      const rawEnd = session.end ?? now;
      const start = new Date(Math.max(session.start.getTime(), dayStart.getTime()));
      const end = new Date(Math.min(rawEnd.getTime(), now.getTime(), dayEnd.getTime()));
      return { session, start, end };
    })
    .filter(({ start, end }) => end.getTime() >= start.getTime());

  let axisStart = atHour(now, 8);
  let axisEnd = atHour(now, 18);
  for (const { start, end } of spans) {
    if (start < axisStart) axisStart = atHour(start, start.getHours());
    if (end > axisEnd) {
      const h = end.getMinutes() || end.getSeconds() ? end.getHours() + 1 : end.getHours();
      axisEnd = h >= 24 ? dayEnd : atHour(end, h);
    }
  }
  const span = axisEnd.getTime() - axisStart.getTime();
  const pct = (d: Date) => ((d.getTime() - axisStart.getTime()) / span) * 100;

  const bars = spans.map(({ session, start, end }) => {
    const left = pct(start);
    const width = Math.max(MIN_BAR_PERCENT, pct(end) - left);
    return { session, start, end, left, width: Math.min(width, 100 - left) };
  });

  const ticks: TimelineLayout["ticks"] = [];
  const firstTick = axisStart.getHours() + (axisStart.getHours() % 2);
  for (let h = firstTick; h <= 24; h += 2) {
    const at = h === 24 ? dayEnd : atHour(now, h);
    if (at > axisEnd) break;
    ticks.push({ at, left: pct(at) });
  }

  return {
    axisStart,
    axisEnd,
    bars,
    ticks,
    totalSeconds: sessions.reduce((sum, s) => sum + (s.duration || 0), 0),
    billableSeconds: sessions.reduce(
      (sum, s) => sum + (s.billable ? s.duration || 0 : 0),
      0,
    ),
  };
}
