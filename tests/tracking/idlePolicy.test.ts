import { describe, it, expect } from "vitest";
import {
  classifyActivity,
  decideIdleAction,
  type IdleInput,
} from "../../src/tracking/idlePolicy";

const base: IdleInput = {
  idleSeconds: 0,
  idleTimeoutSeconds: 300,
  secondsSinceAgent: null,
  isRecording: true,
  isPaused: false,
  autoPaused: false,
  screenLocked: false,
  systemSuspended: false,
};

const action = (input: Partial<IdleInput>) =>
  decideIdleAction({ ...base, ...input }).action;

describe("classifyActivity", () => {
  it("is active with recent input, or a short pause without an agent", () => {
    expect(classifyActivity({ ...base, idleSeconds: 10 })).toBe("active");
    expect(classifyActivity({ ...base, idleSeconds: 200 })).toBe("active");
  });

  it("is supervising after a minute without input while an agent works", () => {
    expect(classifyActivity({ ...base, idleSeconds: 59, secondsSinceAgent: 5 })).toBe("active");
    expect(classifyActivity({ ...base, idleSeconds: 60, secondsSinceAgent: 5 })).toBe("supervising");
    // Agent activity counts for ten minutes
    expect(classifyActivity({ ...base, idleSeconds: 900, secondsSinceAgent: 599 })).toBe("supervising");
    expect(classifyActivity({ ...base, idleSeconds: 900, secondsSinceAgent: 600 })).toBe("away");
  });

  it("stops supervising after an hour without any input", () => {
    expect(classifyActivity({ ...base, idleSeconds: 3599, secondsSinceAgent: 1 })).toBe("supervising");
    expect(classifyActivity({ ...base, idleSeconds: 3600, secondsSinceAgent: 1 })).toBe("away");
  });

  it("is away when idle past the timeout, locked or asleep", () => {
    expect(classifyActivity({ ...base, idleSeconds: 300 })).toBe("away");
    expect(classifyActivity({ ...base, screenLocked: true })).toBe("away");
    expect(classifyActivity({ ...base, systemSuspended: true, secondsSinceAgent: 1 })).toBe("away");
  });

  it("works outside a session too", () => {
    expect(
      decideIdleAction({ ...base, isRecording: false, idleSeconds: 120, secondsSinceAgent: 3 }),
    ).toEqual({ action: null, activity: "supervising" });
  });
});

describe("decideIdleAction", () => {
  it("does nothing when not recording", () => {
    expect(action({ isRecording: false, idleSeconds: 999 })).toBeNull();
  });

  it("pauses at the timeout and trims the idle stretch", () => {
    expect(action({ idleSeconds: 299 })).toBeNull();
    expect(decideIdleAction({ ...base, idleSeconds: 300 })).toEqual({
      action: "pause",
      activity: "away",
      pauseSecondsAgo: 300,
    });
  });

  it("keeps supervising running instead of pausing", () => {
    expect(action({ idleSeconds: 1200, secondsSinceAgent: 30 })).toBeNull();
  });

  it("when the agent stops, pauses back at its last write", () => {
    // Last input 20 min ago, agent last wrote 10 min ago
    expect(decideIdleAction({ ...base, idleSeconds: 1200, secondsSinceAgent: 600 })).toMatchObject({
      action: "pause",
      pauseSecondsAgo: 600,
    });
    // Agent's last write was before the last input: back to the input
    expect(decideIdleAction({ ...base, idleSeconds: 700, secondsSinceAgent: 900 })).toMatchObject({
      action: "pause",
      pauseSecondsAgo: 700,
    });
  });

  it("after an hour of supervising without input, keeps that hour", () => {
    expect(decideIdleAction({ ...base, idleSeconds: 3700, secondsSinceAgent: 5 })).toMatchObject({
      action: "pause",
      pauseSecondsAgo: 100,
    });
  });

  it("leaves lock and sleep to their own events", () => {
    expect(action({ screenLocked: true, idleSeconds: 999 })).toBeNull();
    expect(action({ systemSuspended: true, idleSeconds: 999 })).toBeNull();
  });

  it("resumes an auto-paused session when the user is back", () => {
    const paused = { isPaused: true, autoPaused: true };
    expect(action({ ...paused, idleSeconds: 2 })).toBe("resume");
    expect(action({ ...paused, idleSeconds: 60 })).toBeNull();
  });

  it("never resumes a manual pause", () => {
    expect(action({ isPaused: true, idleSeconds: 0 })).toBeNull();
  });

  it("never resumes while locked or asleep", () => {
    const paused = { isPaused: true, autoPaused: true };
    expect(action({ ...paused, screenLocked: true })).toBeNull();
    expect(action({ ...paused, systemSuspended: true })).toBeNull();
  });
});
