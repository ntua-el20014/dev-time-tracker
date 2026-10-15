import { describe, expect, it } from "vitest";
import {
  FORGET_AFTER_MS,
  LiveAgents,
  SHOW_FOR_MS,
  WORKING_STALE_MS,
  parseHookEvent,
  type HookEvent,
} from "../../src/tracking/agentLive";

const T0 = new Date(2026, 9, 15, 12, 0, 0).getTime();
const MIN = 60_000;

const ev = (event: HookEvent["event"], at: number, extra: Partial<HookEvent> = {}): HookEvent => ({
  event,
  sessionId: "s1",
  cwd: "/home/me/repo",
  notificationType: null,
  at,
  ...extra,
});

describe("parseHookEvent", () => {
  it("keeps the metadata and nothing else", () => {
    const parsed = parseHookEvent(
      {
        session_id: "6f1c-ab",
        transcript_path: "/home/me/.claude/projects/x/6f1c-ab.jsonl",
        cwd: "C:\\Users\\me\\repo",
        hook_event_name: "UserPromptSubmit",
        prompt: "my secret prompt",
        permission_mode: "default",
      },
      T0,
    );
    expect(parsed).toEqual({
      event: "UserPromptSubmit",
      sessionId: "6f1c-ab",
      cwd: "C:\\Users\\me\\repo",
      notificationType: null,
      at: T0,
    });
    expect(JSON.stringify(parsed)).not.toContain("secret");
  });

  it("rejects unknown events and odd ids, and drops relative or huge paths", () => {
    expect(parseHookEvent({ session_id: "s", hook_event_name: "PreToolUse" }, T0)).toBeNull();
    expect(parseHookEvent({ session_id: "../x y", hook_event_name: "Stop" }, T0)).toBeNull();
    expect(parseHookEvent({ hook_event_name: "Stop" }, T0)).toBeNull();
    expect(parseHookEvent("Stop", T0)).toBeNull();
    expect(parseHookEvent({ session_id: "s", hook_event_name: "Stop", cwd: "relative/dir" }, T0)?.cwd).toBeNull();
    expect(parseHookEvent({ session_id: "s", hook_event_name: "Stop", cwd: "/" + "a".repeat(5000) }, T0)?.cwd).toBeNull();
  });

  it("takes the notification type only for notifications", () => {
    expect(
      parseHookEvent({ session_id: "s", hook_event_name: "Notification", notification_type: "permission_prompt", message: "hi" }, T0)
        ?.notificationType,
    ).toBe("permission_prompt");
    expect(
      parseHookEvent({ session_id: "s", hook_event_name: "Stop", notification_type: "permission_prompt" }, T0)
        ?.notificationType,
    ).toBeNull();
  });
});

describe("LiveAgents", () => {
  it("follows a turn: working → waiting → working → idle → gone", () => {
    const live = new LiveAgents();
    expect(live.apply(ev("UserPromptSubmit", T0))).toBe(true);
    expect(live.view(T0)[0]).toMatchObject({ status: "working", prompts: 1, cwd: "/home/me/repo" });
    expect(live.apply(ev("PostToolUse", T0 + 1000))).toBe(false); // still working
    expect(live.apply(ev("Notification", T0 + 2000, { notificationType: "permission_prompt" }))).toBe(true);
    expect(live.view(T0 + 2000)[0].status).toBe("waiting");
    live.apply(ev("PostToolUse", T0 + 3000));
    expect(live.view(T0 + 3000)[0]).toMatchObject({ status: "working", toolCalls: 2 });
    live.apply(ev("Stop", T0 + 4000));
    expect(live.view(T0 + 4000)[0]).toMatchObject({ status: "idle", since: new Date(T0 + 4000).toISOString() });
    expect(live.apply(ev("SessionEnd", T0 + 5000))).toBe(true);
    expect(live.view(T0 + 5000)).toEqual([]);
    expect(live.stats()).toEqual({ lastEventAt: T0 + 5000, eventsReceived: 6 });
  });

  it("beats 'now' while working, even through a long silent tool run", () => {
    const live = new LiveAgents();
    expect(live.heartbeatMs(T0)).toBeNull();
    live.apply(ev("UserPromptSubmit", T0));
    expect(live.heartbeatMs(T0 + 12 * MIN)).toBe(T0 + 12 * MIN);
    // No Stop after an interrupt: stale after WORKING_STALE_MS, then the last event counts
    expect(live.heartbeatMs(T0 + WORKING_STALE_MS)).toBe(T0);
    expect(live.view(T0 + WORKING_STALE_MS)[0].status).toBe("idle");
  });

  it("waiting or idle report the last event, not now", () => {
    const live = new LiveAgents();
    live.apply(ev("UserPromptSubmit", T0));
    live.apply(ev("Notification", T0 + MIN, { notificationType: "idle_prompt" }));
    expect(live.heartbeatMs(T0 + 20 * MIN)).toBe(T0 + MIN);
    live.apply(ev("Notification", T0 + 2 * MIN, { notificationType: "elicitation_dialog" }));
    expect(live.heartbeatMs(T0 + 20 * MIN)).toBe(T0 + 2 * MIN);
  });

  it("ignores notifications that aren't agent work", () => {
    const live = new LiveAgents();
    live.apply(ev("Stop", T0));
    expect(live.apply(ev("Notification", T0 + 10 * MIN, { notificationType: "auth_success" }))).toBe(false);
    expect(live.heartbeatMs(T0 + 10 * MIN)).toBe(T0);
  });

  it("hides idle sessions after a while and forgets old ones", () => {
    const live = new LiveAgents();
    live.apply(ev("Stop", T0));
    live.apply(ev("Notification", T0, { sessionId: "s2", notificationType: "permission_prompt" }));
    expect(live.view(T0 + SHOW_FOR_MS).map((s) => s.sessionId)).toEqual(["s2"]); // waiting stays shown
    expect(live.prune(T0 + FORGET_AFTER_MS - 1)).toBe(false);
    expect(live.prune(T0 + FORGET_AFTER_MS)).toBe(true);
    expect(live.view(T0 + FORGET_AFTER_MS)).toEqual([]);
  });

  it("lists the latest first and knows which repo was busy recently", () => {
    const live = new LiveAgents();
    live.apply(ev("UserPromptSubmit", T0, { sessionId: "a", cwd: "/r/a" }));
    live.apply(ev("UserPromptSubmit", T0 + MIN, { sessionId: "b", cwd: "/r/b" }));
    expect(live.view(T0 + MIN).map((s) => s.sessionId)).toEqual(["b", "a"]);
    expect(live.recentCwd(T0 + MIN, 10 * MIN)).toBe("/r/b");
    live.apply(ev("PostToolUse", T0 + 2 * MIN, { sessionId: "a", cwd: null }));
    expect(live.recentCwd(T0 + 2 * MIN, 10 * MIN)).toBe("/r/a"); // cwd kept from earlier
    expect(live.recentCwd(T0 + 13 * MIN, 10 * MIN)).toBeNull();
  });
});
