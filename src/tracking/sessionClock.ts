/**
 * Timing state of the current recording session.
 *
 * Pure: every method takes `now`, so it can be tested without timers or
 * Electron. `duration` is active time (pauses excluded); the session's end is
 * the wall-clock stop time.
 */

export interface SessionSnapshot {
  start: Date;
  end: Date;
  /** Active seconds, pauses excluded */
  duration: number;
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
  }

  /** Returns true if the session was running and is now paused. */
  pause(now: Date, automatic: boolean): boolean {
    if (!this.start || !this.runningSince) return false;
    this.accumulated += secondsBetween(this.runningSince, now);
    this.runningSince = null;
    this.pausedAutomatically = automatic;
    return true;
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
    const snapshot = {
      start: this.start,
      end: now,
      duration: this.activeSeconds(now),
    };
    this.start = null;
    this.accumulated = 0;
    this.runningSince = null;
    this.pausedAutomatically = false;
    return snapshot;
  }
}
