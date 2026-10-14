import { describe, it, expect } from "vitest";
import { decideIdleAction, type IdleInput } from "../../src/tracking/idlePolicy";

const base: IdleInput = {
  idleSeconds: 0,
  idleTimeoutSeconds: 300,
  isRecording: true,
  isPaused: false,
  autoPaused: false,
  screenLocked: false,
  systemSuspended: false,
};

describe("decideIdleAction", () => {
  it("does nothing when not recording", () => {
    expect(
      decideIdleAction({ ...base, isRecording: false, idleSeconds: 999 }),
    ).toBeNull();
  });

  it("pauses a running session once idle reaches the timeout", () => {
    expect(decideIdleAction({ ...base, idleSeconds: 299 })).toBeNull();
    expect(decideIdleAction({ ...base, idleSeconds: 300 })).toBe("pause");
  });

  it("resumes an auto-paused session when the user is back", () => {
    const paused = { ...base, isPaused: true, autoPaused: true };
    expect(decideIdleAction({ ...paused, idleSeconds: 2 })).toBe("resume");
    expect(decideIdleAction({ ...paused, idleSeconds: 60 })).toBeNull();
  });

  it("never resumes a manual pause", () => {
    expect(
      decideIdleAction({ ...base, isPaused: true, idleSeconds: 0 }),
    ).toBeNull();
  });

  it("never resumes while locked or asleep", () => {
    const paused = { ...base, isPaused: true, autoPaused: true };
    expect(decideIdleAction({ ...paused, screenLocked: true })).toBeNull();
    expect(decideIdleAction({ ...paused, systemSuspended: true })).toBeNull();
  });
});
