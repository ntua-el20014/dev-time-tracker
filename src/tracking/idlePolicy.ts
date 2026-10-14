/**
 * Decides whether system idle time should pause or resume the session.
 * Pure, so the rules can be tested without powerMonitor.
 */

/** Idle time (s) below which an auto-paused session resumes on its own. */
export const AUTO_RESUME_IDLE_SECONDS = 5;

export interface IdleInput {
  idleSeconds: number;
  idleTimeoutSeconds: number;
  isRecording: boolean;
  isPaused: boolean;
  /** The current pause came from idle/lock/sleep, not the user */
  autoPaused: boolean;
  screenLocked: boolean;
  systemSuspended: boolean;
}

export type IdleAction = "pause" | "resume" | null;

export function decideIdleAction(input: IdleInput): IdleAction {
  if (!input.isRecording) return null;

  if (!input.isPaused && input.idleSeconds >= input.idleTimeoutSeconds) {
    return "pause";
  }

  // Manual pauses are never resumed automatically, and never while the
  // machine is locked or asleep (input at the lock screen doesn't count).
  if (
    input.isPaused &&
    input.autoPaused &&
    !input.screenLocked &&
    !input.systemSuspended &&
    input.idleSeconds < AUTO_RESUME_IDLE_SECONDS
  ) {
    return "resume";
  }

  return null;
}
