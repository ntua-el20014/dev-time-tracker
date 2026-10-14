import { describe, it, expect } from "vitest";
import { SessionClock } from "../../src/tracking/sessionClock";

const t = (seconds: number) => new Date(Date.UTC(2026, 9, 14, 10, 0, seconds));

describe("SessionClock", () => {
  it("starts idle", () => {
    const clock = new SessionClock();
    expect(clock.state).toEqual({
      isRecording: false,
      isPaused: false,
      autoPaused: false,
    });
    expect(clock.stop(t(0))).toBeNull();
  });

  it("counts active time and excludes pauses", () => {
    const clock = new SessionClock();
    clock.startAt(t(0));
    expect(clock.pause(t(30), false)).toBe(true); // 30s active
    expect(clock.resume(t(50))).toBe(true); // 20s paused
    const snap = clock.stop(t(60)); // +10s active

    expect(snap).toEqual({ start: t(0), end: t(60), duration: 40 });
    expect(clock.isRecording).toBe(false);
  });

  it("stopping while paused uses the time accumulated before the pause", () => {
    const clock = new SessionClock();
    clock.startAt(t(0));
    clock.pause(t(15), false);
    expect(clock.stop(t(45))?.duration).toBe(15);
  });

  it("tracks whether a pause was automatic", () => {
    const clock = new SessionClock();
    clock.startAt(t(0));
    clock.pause(t(5), true);
    expect(clock.state).toEqual({
      isRecording: true,
      isPaused: true,
      autoPaused: true,
    });
    clock.resume(t(10));
    expect(clock.state.autoPaused).toBe(false);
  });

  it("ignores pause when not running and resume when not paused", () => {
    const clock = new SessionClock();
    expect(clock.pause(t(0), false)).toBe(false);
    clock.startAt(t(0));
    expect(clock.resume(t(1))).toBe(false);
    clock.pause(t(2), false);
    expect(clock.pause(t(3), true)).toBe(false);
    // A second pause must not turn a manual pause into an automatic one
    expect(clock.state.autoPaused).toBe(false);
  });

  it("never reports negative durations if the clock goes backwards", () => {
    const clock = new SessionClock();
    clock.startAt(t(30));
    expect(clock.activeSeconds(t(0))).toBe(0);
  });
});
