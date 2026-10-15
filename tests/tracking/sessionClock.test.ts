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

    expect(snap).toEqual({
      start: t(0),
      end: t(60),
      duration: 40,
      supervisingSeconds: 0,
      supervisingSpans: [],
    });
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

  it("keeps supervising spans as part of the active time", () => {
    const clock = new SessionClock();
    clock.startAt(t(0));
    clock.setSupervising(t(60), true);
    expect(clock.isSupervising).toBe(true);
    expect(clock.supervisingSeconds(t(90))).toBe(30);
    clock.setSupervising(t(100), false);
    clock.setSupervising(t(110), false); // no-op
    const snap = clock.stop(t(120));
    expect(snap?.duration).toBe(120);
    expect(snap?.supervisingSeconds).toBe(40);
    expect(snap?.supervisingSpans).toEqual([
      [t(60).toISOString(), t(100).toISOString()],
    ]);
  });

  it("a backdated pause trims active time and clips supervising after it", () => {
    const clock = new SessionClock();
    clock.startAt(t(0));
    clock.setSupervising(t(100), true);
    // At t(400) we learn nothing happened after t(200)
    clock.setSupervising(t(400), false);
    expect(clock.pause(t(200), true)).toBe(true);
    expect(clock.activeSeconds(t(400))).toBe(200);
    expect(clock.supervisingSeconds(t(400))).toBe(100);
    clock.resume(t(500));
    const snap = clock.stop(t(510));
    expect(snap?.duration).toBe(210);
    expect(snap?.supervisingSpans).toEqual([
      [t(100).toISOString(), t(200).toISOString()],
    ]);
  });

  it("drops spans that start after a backdated pause and never pauses before the stretch", () => {
    const clock = new SessionClock();
    clock.startAt(t(100));
    clock.setSupervising(t(160), true);
    clock.pause(t(50), true); // before the start: clamps to it
    expect(clock.activeSeconds(t(300))).toBe(0);
    expect(clock.stop(t(300))?.supervisingSpans).toEqual([]);
  });

  it("ignores supervising while paused or idle", () => {
    const clock = new SessionClock();
    clock.setSupervising(t(0), true);
    clock.startAt(t(0));
    clock.pause(t(10), false);
    clock.setSupervising(t(20), true);
    expect(clock.isSupervising).toBe(false);
  });

  it("never reports negative durations if the clock goes backwards", () => {
    const clock = new SessionClock();
    clock.startAt(t(30));
    expect(clock.activeSeconds(t(0))).toBe(0);
  });
});
