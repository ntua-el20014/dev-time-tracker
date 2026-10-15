/**
 * Pure: live state of Claude Code sessions from its hook events (received
 * by claudeHooks.ts). Only metadata is kept: the event name, session id,
 * working directory and notification type. The prompt, tool input/output
 * and assistant messages in the payload are never read.
 *
 * - UserPromptSubmit / PostToolUse → working
 * - Notification "needs you" (permission, question) → waiting
 * - Stop / StopFailure / Notification idle_prompt → idle
 * - SessionEnd → gone
 *
 * Claude Code sends no Stop when the user interrupts a turn, so "working"
 * without any event for WORKING_STALE_MS counts as idle.
 */
import type { HookEventName } from "./claudeHooksConfig";
import { HOOK_EVENTS } from "./claudeHooksConfig";

/** "Working" with no event for this long is treated as idle (a missed Stop). */
export const WORKING_STALE_MS = 15 * 60_000;
/** Sessions are shown for this long after their last event. */
export const SHOW_FOR_MS = 30 * 60_000;
/** Sessions with no event for this long are forgotten. */
export const FORGET_AFTER_MS = 6 * 3600_000;

export type LiveStatus = "working" | "waiting" | "idle";

export interface HookEvent {
  event: HookEventName;
  sessionId: string;
  cwd: string | null;
  notificationType: string | null;
  /** When it was received (ms) */
  at: number;
}

const WAITING_NOTIFICATIONS = new Set([
  "permission_prompt",
  "elicitation_dialog",
  "elicitation_url_dialog",
  "agent_needs_input",
]);
const IDLE_NOTIFICATIONS = new Set(["idle_prompt", "agent_completed"]);

const str = (v: unknown, re: RegExp, max: number) =>
  typeof v === "string" && v.length <= max && re.test(v) ? v : null;

/**
 * The metadata of a hook payload, or null if it isn't one we understand.
 * Nothing else of the payload is looked at.
 */
export function parseHookEvent(body: unknown, at: number): HookEvent | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const event = (HOOK_EVENTS as readonly string[]).includes(b.hook_event_name as string)
    ? (b.hook_event_name as HookEventName)
    : null;
  const sessionId = str(b.session_id, /^[\w.-]+$/, 128);
  if (!event || !sessionId) return null;
  return {
    event,
    sessionId,
    // Absolute path only (POSIX or Windows); used locally to find the repo
    cwd: str(b.cwd, /^(?:\/|[A-Za-z]:[\\/]|\\\\)/, 4096),
    notificationType: event === "Notification" ? str(b.notification_type, /^[a-z_]+$/, 64) : null,
    at,
  };
}

interface LiveSession {
  sessionId: string;
  cwd: string | null;
  status: LiveStatus;
  /** When the status last changed (ms) */
  statusSince: number;
  /** Last event that shows the agent at work (ms) */
  lastActivityAt: number;
  firstSeenAt: number;
  prompts: number;
  toolCalls: number;
}

export interface LiveAgentView {
  source: "claude-code";
  sessionId: string;
  cwd: string | null;
  status: LiveStatus;
  /** ISO time the status started */
  since: string;
  lastActivityAt: string;
  prompts: number;
  toolCalls: number;
}

export class LiveAgents {
  private sessions = new Map<string, LiveSession>();
  private lastEvent: number | null = null;
  private count = 0;

  /** Apply one event; true if what's shown (sessions or statuses) changed. */
  apply(e: HookEvent): boolean {
    this.lastEvent = e.at;
    this.count++;
    if (e.event === "SessionEnd") return this.sessions.delete(e.sessionId);

    let s = this.sessions.get(e.sessionId);
    const isNew = !s;
    if (!s) {
      s = {
        sessionId: e.sessionId,
        cwd: e.cwd,
        status: "idle",
        statusSince: e.at,
        lastActivityAt: e.at,
        firstSeenAt: e.at,
        prompts: 0,
        toolCalls: 0,
      };
      this.sessions.set(e.sessionId, s);
    }
    const cwdChanged = e.cwd !== null && e.cwd !== s.cwd;
    if (e.cwd) s.cwd = e.cwd;

    let next: LiveStatus | null = null;
    switch (e.event) {
      case "UserPromptSubmit":
        s.prompts++;
        next = "working";
        break;
      case "PostToolUse":
        s.toolCalls++;
        next = "working";
        break;
      case "Stop":
      case "StopFailure":
        next = "idle";
        break;
      case "Notification":
        if (e.notificationType && WAITING_NOTIFICATIONS.has(e.notificationType)) next = "waiting";
        else if (e.notificationType && IDLE_NOTIFICATIONS.has(e.notificationType)) next = "idle";
        break;
    }
    // Other notifications (e.g. auth_success) aren't agent work
    if (next === null) return isNew || cwdChanged;
    s.lastActivityAt = e.at;
    const statusChanged = next !== s.status;
    if (statusChanged) {
      s.status = next;
      s.statusSince = e.at;
    }
    return isNew || cwdChanged || statusChanged;
  }

  private effective(s: LiveSession, now: number): LiveStatus {
    return s.status === "working" && now - s.lastActivityAt >= WORKING_STALE_MS
      ? "idle"
      : s.status;
  }

  /**
   * For the idle policy: "now" while a session is working (a long tool run
   * sends nothing until it ends), else the last sign of agent work.
   */
  heartbeatMs(now: number): number | null {
    let latest: number | null = null;
    for (const s of this.sessions.values()) {
      const t = this.effective(s, now) === "working" ? now : s.lastActivityAt;
      if (latest === null || t > latest) latest = t;
    }
    return latest;
  }

  /** Forget old sessions; true if any was dropped. */
  prune(now: number): boolean {
    let changed = false;
    for (const [id, s] of this.sessions) {
      if (now - s.lastActivityAt >= FORGET_AFTER_MS) {
        this.sessions.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  /** Sessions worth showing: busy, or active in the last half hour. Latest first. */
  view(now: number): LiveAgentView[] {
    return [...this.sessions.values()]
      .map((s) => ({ s, status: this.effective(s, now) }))
      .filter(({ s, status }) => status !== "idle" || now - s.lastActivityAt < SHOW_FOR_MS)
      .sort((x, y) => y.s.lastActivityAt - x.s.lastActivityAt)
      .map(({ s, status }) => ({
        source: "claude-code" as const,
        sessionId: s.sessionId,
        cwd: s.cwd,
        status,
        since: new Date(status === s.status ? s.statusSince : s.lastActivityAt + WORKING_STALE_MS).toISOString(),
        lastActivityAt: new Date(s.lastActivityAt).toISOString(),
        prompts: s.prompts,
        toolCalls: s.toolCalls,
      }));
  }

  /** Working directory of the session that worked most recently within `withinMs`. */
  recentCwd(now: number, withinMs: number): string | null {
    let best: LiveSession | null = null;
    for (const s of this.sessions.values()) {
      if (!s.cwd || now - s.lastActivityAt >= withinMs) continue;
      if (!best || s.lastActivityAt > best.lastActivityAt) best = s;
    }
    return best?.cwd ?? null;
  }

  stats() {
    return { lastEventAt: this.lastEvent, eventsReceived: this.count };
  }

  clear() {
    this.sessions.clear();
  }
}
