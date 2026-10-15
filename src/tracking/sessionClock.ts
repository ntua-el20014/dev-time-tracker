/**
 * Timing state of the current recording session.
 *
 * Pure: every method takes `now`, so it can be tested without timers or
 * Electron. `duration` is active time (pauses excluded); the session's end is
 * the wall-clock stop time.
 *
 * Supervising time (no input while an AI agent works) is part of `duration`
 * and is also kept as spans, so it can be billed and drawn separately. A
 * pause may be backdated (idle time is trimmed); spans after it are clipped.
 */

export interface SessionSnapshot {
  start: Date;
  end: Date;
  /** Active seconds, pauses excluded */
  duration: number;
  /** Part of duration spent supervising */
  supervisingSeconds: number;
  /** [start, end] ISO pairs */
  supervisingSpans: [string, string][];
}

interface Span {
  start: Date;
  /** null while the span is open */
  end: Date | null;
}

export interface ClockState {
  isRecording: boolean;
  isPaused: boolean;
  /** Paused by idle/lock/sleep rather than by the user */
  autoPaused: boolean;
}

function secondsBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
}

export class SessionClock {
  private start: Date | null = null;
  /** Active seconds accumulated before the current running stretch */
  private accumulated = 0;
  /** Start of the current running stretch; null while paused or idle */
  private runningSince: Date | null = null;
  private pausedAutomatically = false;
  private spans: Span[] = [];

  /** Wall-clock start of the current session, or null */
  get startedAt(): Date | null {
    return this.start;
  }

  get isRecording(): boolean {
    return this.start !== null;
  }

  get isPaused(): boolean {
    return this.start !== null && this.runningSince === null;
  }

  get state(): ClockState {
    return {
      isRecording: this.isRecording,
      isPaused: this.isPaused,
      autoPaused: this.isPaused && this.pausedAutomatically,
    };
  }

  /** Starts a new session, discarding any current one. */
  startAt(now: Date): void {
    this.start = now;
    this.accumulated = 0;
    this.runningSince = now;
    this.pausedAutomatically = false;
    this.spans = [];
  }

  /**
   * Returns true if the session was running and is now paused. `now` may be
   * in the past (trimming idle time), but not before the running stretch.
   */
  pause(now: Date, automatic: boolean): boolean {
    if (!this.start || !this.runningSince) return false;
    const at = new Date(Math.max(now.getTime(), this.runningSince.getTime()));
    this.accumulated += secondsBetween(this.runningSince, at);
    this.runningSince = null;
    this.pausedAutomatically = automatic;
    this.clipSpans(at);
    return true;
  }

  /** Whether the running session is being supervised right now. */
  setSupervising(now: Date, supervising: boolean): void {
    if (!this.start || !this.runningSince) return;
    const open = this.spans.find((s) => s.end === null);
    if (supervising && !open) {
      this.spans.push({ start: now, end: null });
    } else if (!supervising && open) {
      open.end = now;
    }
  }

  get isSupervising(): boolean {
    return this.spans.some((s) => s.end === null);
  }

  supervisingSeconds(now: Date): number {
    return this.spans.reduce(
      (sum, s) => sum + secondsBetween(s.start, s.end ?? now),
      0,
    );
  }

  /** [start, end] ISO pairs so far; an open span ends at `now`. */
  supervisingSpans(now: Date): [string, string][] {
    return this.spans
      .filter((s) => secondsBetween(s.start, s.end ?? now) > 0)
      .map((s) => [s.start.toISOString(), (s.end ?? now).toISOString()]);
  }

  /** Close the open span and cut everything after `at`. */
  private clipSpans(at: Date): void {
    this.spans = this.spans
      .filter((s) => s.start < at)
      .map((s) => ({
        start: s.start,
        end: s.end === null || s.end > at ? at : s.end,
      }));
  }

  /** Returns true if the session was paused and is now running. */
  resume(now: Date): boolean {
    if (!this.start || this.runningSince) return false;
    this.runningSince = now;
    this.pausedAutomatically = false;
    return true;
  }

  activeSeconds(now: Date): number {
    if (!this.start) return 0;
    return (
      this.accumulated +
      (this.runningSince ? secondsBetween(this.runningSince, now) : 0)
    );
  }

  /** Ends the session. Returns its snapshot, or null if none was recording. */
  stop(now: Date): SessionSnapshot | null {
    if (!this.start) return null;
    if (this.runningSince) this.clipSpans(now);
    const snapshot: SessionSnapshot = {
      start: this.start,
      end: now,
      duration: this.activeSeconds(now),
      supervisingSeconds: Math.min(
        this.activeSeconds(now),
        this.supervisingSeconds(now),
      ),
      supervisingSpans: this.supervisingSpans(now),
    };
    this.start = null;
    this.accumulated = 0;
    this.runningSince = null;
    this.pausedAutomatically = false;
    this.spans = [];
    return snapshot;
  }
}
