/**
 * Active / Supervising / Away, and what that means for the session.
 * Pure, so the rules can be tested without powerMonitor.
 *
 * - Active: input in the last minute, or a short pause without an agent.
 * - Supervising: no input for a minute or more, but an AI agent wrote to
 *   its transcript in the last 10 minutes (capped at an hour without input).
 *   It counts towards the session.
 * - Away: idle past the timeout with no agent (or locked/asleep). The
 *   session pauses, backdated to the last sign of work, so the idle stretch
 *   before the pause isn't counted.
 */

/** Idle time (s) below which an auto-paused session resumes on its own. */
export const AUTO_RESUME_IDLE_SECONDS = 5;
/** No input for this long while an agent works counts as supervising. */
export const SUPERVISING_AFTER_SECONDS = 60;
/** An agent counts as working if it wrote within this many seconds. */
export const AGENT_RECENT_SECONDS = 10 * 60;
/** Supervising without any input ends after this long. */
export const MAX_SUPERVISING_IDLE_SECONDS = 60 * 60;

export type Activity = "active" | "supervising" | "away";

export interface IdleInput {
  idleSeconds: number;
  idleTimeoutSeconds: number;
  /** Seconds since an agent last wrote to a transcript; null if never */
  secondsSinceAgent: number | null;
  isRecording: boolean;
  isPaused: boolean;
  /** The current pause came from idle/lock/sleep, not the user */
  autoPaused: boolean;
  screenLocked: boolean;
  systemSuspended: boolean;
}

export type IdleAction = "pause" | "resume" | null;

export interface IdleDecision {
  action: IdleAction;
  activity: Activity;
  /** For "pause": how far back (s) the session stopped counting */
  pauseSecondsAgo?: number;
}

const agentRecent = (input: IdleInput) =>
  input.secondsSinceAgent !== null &&
  input.secondsSinceAgent < AGENT_RECENT_SECONDS;

/** How long supervising may last without input (never below the timeout). */
const supervisingLimit = (input: IdleInput) =>
  Math.max(MAX_SUPERVISING_IDLE_SECONDS, input.idleTimeoutSeconds);

export function classifyActivity(input: IdleInput): Activity {
  if (input.screenLocked || input.systemSuspended) return "away";
  if (input.idleSeconds < SUPERVISING_AFTER_SECONDS) return "active";
  if (agentRecent(input) && input.idleSeconds < supervisingLimit(input)) {
    return "supervising";
  }
  return input.idleSeconds >= input.idleTimeoutSeconds ? "away" : "active";
}

export function decideIdleAction(input: IdleInput): IdleDecision {
  const activity = classifyActivity(input);
  if (!input.isRecording) return { action: null, activity };

  // Lock and sleep pause through their own events
  if (
    !input.isPaused &&
    activity === "away" &&
    !input.screenLocked &&
    !input.systemSuspended
  ) {
    // Count up to the last input, or the agent's last write if later; when
    // supervising ran out, keep the supervising allowance
    const pauseSecondsAgo = agentRecent(input)
      ? input.idleSeconds - supervisingLimit(input)
      : Math.min(input.idleSeconds, input.secondsSinceAgent ?? Infinity);
    return {
      action: "pause",
      activity,
      pauseSecondsAgo: Math.max(0, pauseSecondsAgo),
    };
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
    return { action: "resume", activity };
  }

  return { action: null, activity };
}
