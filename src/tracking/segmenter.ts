/**
 * Always-on mode (Phase D): cuts activity outside manual sessions into
 * segments, which are later saved as drafts and confirmed by the user.
 *
 * Pure: every call takes `now`, so it can be tested without timers.
 *
 * - A segment opens on human input. An agent working on its own never
 *   opens one (no overnight drafts from an unattended run).
 * - Inside a segment, time counts the way it does in a session (C4): input,
 *   short breaks and supervising count; away stretches don't (the segment
 *   pauses, backdated to the last sign of work).
 * - A segment ends after SEGMENT_GAP_SECONDS without any sign of work, at
 *   the last sign of work.
 * - It is split when work moves to another project for at least
 *   PROJECT_SWITCH_SECONDS, at the moment of the move. "Project" is the
 *   repo's linked project, or the repo itself while it isn't linked. A
 *   segment that has seen no repo yet adopts the first one.
 */
import {
  AUTO_RESUME_IDLE_SECONDS,
  decideIdleAction,
} from "./idlePolicy";

/** A segment ends after this long without any sign of work. */
export const SEGMENT_GAP_SECONDS = 15 * 60;
/** Work must stay in another project this long before the segment splits. */
export const PROJECT_SWITCH_SECONDS = 3 * 60;

export interface SegmentSnapshot {
  /** Chosen here; the draft's client_id, so re-saving it upserts */
  clientId: string;
  start: Date;
  /** Last sign of work so far (or `now` while it runs) */
  end: Date;
  /** Active seconds, away stretches excluded */
  duration: number;
  /** Part of duration spent supervising */
  supervisingSeconds: number;
  /** [start, end] ISO pairs */
  supervisingSpans: [string, string][];
  /** The repo the segment is about, or null if none was seen */
  repoKey: string | null;
  isPaused: boolean;
}

/** "idle": the gap; "project": split; "ended": end() (manual Start, sign-out, quit, off) */
export type SegmentEndReason = "idle" | "project" | "ended";

export type SegmentEvent =
  | { type: "opened"; clientId: string; start: Date }
  | { type: "closed"; segment: SegmentSnapshot; reason: SegmentEndReason };

export interface SegmentActivityInput {
  now: Date;
  idleSeconds: number;
  idleTimeoutSeconds: number;
  /** Seconds since an agent last showed activity; null if never */
  secondsSinceAgent: number | null;
  screenLocked: boolean;
  systemSuspended: boolean;
}

export interface SegmenterDeps {
  newId: () => string;
  /** The (active) project a repo is linked to, if any */
  projectOf: (repoKey: string) => string | null;
}

/** Times in ms; `end` is null while open. */
interface Interval {
  start: number;
  end: number | null;
}

interface OpenSegment {
  clientId: string;
  repoKey: string | null;
  /** Stretches that count; the last one is open while running */
  running: Interval[];
  supervising: Interval[];
}

const lastOf = <T>(list: T[]): T | undefined => list[list.length - 1];
const seconds = (ms: number) => Math.max(0, Math.round(ms / 1000));

function sumMs(intervals: Interval[], now: number): number {
  return intervals.reduce((sum, i) => sum + ((i.end ?? now) - i.start), 0);
}

/** Splits intervals at `at` into the parts before and after it. */
function splitIntervals(
  intervals: Interval[],
  at: number,
): [Interval[], Interval[]] {
  const before: Interval[] = [];
  const after: Interval[] = [];
  for (const i of intervals) {
    if (i.start >= at) after.push(i);
    else if (i.end !== null && i.end <= at) before.push(i);
    else {
      before.push({ start: i.start, end: at });
      after.push({ start: at, end: i.end });
    }
  }
  return [before, after];
}

export class Segmenter {
  private seg: OpenSegment | null = null;
  /** Another project's repo, focused since `since` (not yet a split) */
  private candidate: { repoKey: string; since: number } | null = null;
  /** Last repo observed, also between segments; a new segment starts in it */
  private lastRepoKey: string | null = null;

  constructor(private readonly deps: SegmenterDeps) {}

  get isOpen(): boolean {
    return this.seg !== null;
  }

  get isPaused(): boolean {
    return this.seg !== null && this.openInterval() === null;
  }

  private openInterval(): Interval | null {
    const last = this.seg ? lastOf(this.seg.running) : undefined;
    return last && last.end === null ? last : null;
  }

  /** Where the current pause began (the last sign of work), or null. */
  private pausedAt(): number | null {
    if (!this.seg || this.openInterval()) return null;
    return lastOf(this.seg.running)?.end ?? null;
  }

  /**
   * Feed one activity poll. Opens, pauses, resumes and closes segments;
   * returns what happened, in order.
   */
  observeActivity(input: SegmentActivityInput): SegmentEvent[] {
    const now = input.now.getTime();
    const events: SegmentEvent[] = [];
    const away = input.screenLocked || input.systemSuspended;

    if (this.seg && !this.isPaused) {
      // The gap ends the segment even if the idle timeout is longer
      const decision = decideIdleAction({
        ...input,
        idleTimeoutSeconds: Math.min(
          input.idleTimeoutSeconds,
          SEGMENT_GAP_SECONDS,
        ),
        isRecording: true,
        isPaused: false,
        autoPaused: false,
      });
      if (away) {
        this.pause(now); // lock/sleep: not backdated, as in a session
      } else if (decision.action === "pause") {
        this.pause(now - (decision.pauseSecondsAgo ?? 0) * 1000);
      } else {
        this.setSupervising(now, decision.activity === "supervising");
      }
    }

    const pausedAt = this.pausedAt();
    if (pausedAt !== null && now - pausedAt >= SEGMENT_GAP_SECONDS * 1000) {
      events.push(this.close(pausedAt, "idle"));
    }

    const freshInput = !away && input.idleSeconds < AUTO_RESUME_IDLE_SECONDS;
    if (freshInput) {
      const at = now - input.idleSeconds * 1000;
      if (!this.seg) {
        events.push(this.open(at, this.lastRepoKey));
      } else if (this.isPaused) {
        this.seg.running.push({ start: Math.max(at, pausedAt ?? at), end: null });
      }
    }
    return events;
  }

  /**
   * Feed the repo of the focused window (sticky while non-dev windows are
   * focused; null if none seen yet). May split the segment.
   */
  observeRepo(now: Date, repoKey: string | null): SegmentEvent[] {
    if (repoKey) this.lastRepoKey = repoKey;
    // Nothing moves while nobody works
    if (!this.seg || this.isPaused || !repoKey) return [];
    if (!this.seg.repoKey || this.sameWork(this.seg.repoKey, repoKey)) {
      this.seg.repoKey ??= repoKey;
      this.candidate = null;
      return [];
    }
    const t = now.getTime();
    if (!this.candidate || !this.sameWork(this.candidate.repoKey, repoKey)) {
      this.candidate = { repoKey, since: t };
    }
    if (t - this.candidate.since < PROJECT_SWITCH_SECONDS * 1000) return [];
    return this.split(this.candidate.since, repoKey);
  }

  /** Close the open segment now (manual Start, sign-out, quit, turned off). */
  end(now: Date): SegmentEvent[] {
    if (!this.seg) return [];
    const t = now.getTime();
    if (!this.isPaused) this.pause(t);
    return [this.close(this.pausedAt() ?? t, "ended")];
  }

  /** The open segment so far, or null. */
  current(now: Date): SegmentSnapshot | null {
    return this.seg ? this.snapshot(this.seg, now.getTime()) : null;
  }

  /** Forget the open segment without reporting it (user changed). */
  reset() {
    this.seg = null;
    this.candidate = null;
    this.lastRepoKey = null;
  }

  private sameWork(a: string, b: string): boolean {
    if (a === b) return true;
    const project = this.deps.projectOf(a);
    return project !== null && project === this.deps.projectOf(b);
  }

  private open(at: number, repoKey: string | null): SegmentEvent {
    const clientId = this.deps.newId();
    this.seg = {
      clientId,
      repoKey,
      running: [{ start: at, end: null }],
      supervising: [],
    };
    this.candidate = null;
    return { type: "opened", clientId, start: new Date(at) };
  }

  /** Stop counting at `at` (may be in the past, not before the stretch). */
  private pause(at: number) {
    const open = this.openInterval();
    if (!this.seg || !open) return;
    open.end = Math.max(at, open.start);
    // Supervising after the pause point didn't count either
    this.seg.supervising = this.seg.supervising
      .filter((s) => s.start < open.end!)
      .map((s) => ({
        start: s.start,
        end: s.end === null || s.end > open.end! ? open.end : s.end,
      }));
  }

  private setSupervising(now: number, supervising: boolean) {
    if (!this.seg) return;
    const open = this.seg.supervising.find((s) => s.end === null);
    if (supervising && !open) this.seg.supervising.push({ start: now, end: null });
    else if (!supervising && open) open.end = now;
  }

  private close(at: number, reason: SegmentEndReason): SegmentEvent {
    const segment = this.snapshot(this.seg!, at);
    this.seg = null;
    this.candidate = null;
    return { type: "closed", segment, reason };
  }

  /** The time from `at` on becomes a new segment in `repoKey`. */
  private split(at: number, repoKey: string): SegmentEvent[] {
    const seg = this.seg!;
    const [running, nextRunning] = splitIntervals(seg.running, at);
    const [supervising, nextSupervising] = splitIntervals(seg.supervising, at);
    this.candidate = null;
    // Nothing counted before the move: the segment just changes project
    if (sumMs(running, at) < 1000) {
      seg.repoKey = repoKey;
      return [];
    }
    const segment = this.snapshot({ ...seg, running, supervising }, at);
    const clientId = this.deps.newId();
    this.seg = {
      clientId,
      repoKey,
      running: nextRunning,
      supervising: nextSupervising,
    };
    return [
      { type: "closed", segment, reason: "project" },
      { type: "opened", clientId, start: new Date(nextRunning[0]?.start ?? at) },
    ];
  }

  private snapshot(seg: OpenSegment, now: number): SegmentSnapshot {
    const last = lastOf(seg.running);
    const end = last ? (last.end ?? now) : now;
    const duration = seconds(sumMs(seg.running, now));
    const spans = seg.supervising
      .map((s) => [s.start, s.end ?? now] as const)
      .filter(([s, e]) => seconds(e - s) > 0);
    return {
      clientId: seg.clientId,
      start: new Date(seg.running[0]?.start ?? now),
      end: new Date(end),
      duration,
      supervisingSeconds: Math.min(
        duration,
        spans.reduce((sum, [s, e]) => sum + seconds(e - s), 0),
      ),
      supervisingSpans: spans.map(([s, e]) => [
        new Date(s).toISOString(),
        new Date(e).toISOString(),
      ]),
      repoKey: seg.repoKey,
      isPaused: !last || last.end !== null,
    };
  }
}
