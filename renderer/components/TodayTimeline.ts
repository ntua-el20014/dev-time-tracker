/**
 * Home's "Today" timeline: today's sessions as bars on the day, colored by
 * project, with the running session growing live.
 */
import { escapeHtml } from "../utils/domUtils";
import { safeIpcInvoke } from "../utils/ipcHelpers";
import { getLocalDateString } from "../../src/utils/timeFormat";
import { getTrackingState, onTrackingState } from "../trackingControls";
import { currentSeconds, onClockTick } from "../liveClock";
import {
  layoutTimeline,
  type TimelineSession,
} from "../utils/timelineLayout";
import type { SessionRow } from "../../shared/types";

type SessionWithEnd = SessionRow & { end_time?: string | null };

let todaysSessions: TimelineSession[] = [];
let projectNames = new Map<string, { name: string; color?: string | null }>();

function hm(seconds: number): string {
  if (seconds > 0 && seconds < 60) return "<1m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

function clock(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Short hour label for the axis ("8 AM" or "08", per locale). */
function hourLabel(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric" });
}

function toTimeline(s: SessionWithEnd): TimelineSession {
  const start = new Date(s.start_time);
  const end = s.end_time
    ? new Date(s.end_time)
    : new Date(start.getTime() + (s.duration || 0) * 1000);
  return {
    id: String(s.id),
    title: s.title,
    start,
    end,
    duration: s.duration || 0,
    projectName: s.project_name ?? null,
    color: s.project_color ?? null,
    billable: s.is_billable,
  };
}

function runningSession(): TimelineSession | null {
  const state = getTrackingState();
  if (!state.isRecording || !state.startedAt) return null;
  const project = state.projectId ? projectNames.get(state.projectId) : undefined;
  return {
    id: "running",
    title: "Current session",
    start: new Date(state.startedAt),
    end: null,
    duration: currentSeconds(),
    projectName: project?.name ?? null,
    color: project?.color ?? null,
    running: true,
  };
}

/** "2h 05m tracked · 1h 30m billable", counting the running session live. */
function drawTotals() {
  const totals = document.querySelector("#homeTimeline .timeline-totals");
  if (!totals) return;
  const state = getTrackingState();
  const running = state.isRecording ? currentSeconds() : 0;
  const tracked = todaysSessions.reduce((sum, s) => sum + s.duration, 0) + running;
  const billable = todaysSessions.reduce(
    (sum, s) => sum + (s.billable ? s.duration : 0),
    0,
  );
  totals.textContent = tracked
    ? `${hm(tracked)} tracked · ${hm(billable)} billable`
    : "Nothing tracked yet today";
}

/** Redraw from the loaded sessions plus the running one (if on screen). */
function draw() {
  const box = document.getElementById("homeTimeline");
  if (!box) return;
  const running = runningSession();
  const layout = layoutTimeline(
    running ? [...todaysSessions, running] : todaysSessions,
    new Date(),
  );

  drawTotals();

  const track = box.querySelector(".today-track");
  if (!track) return;
  track.innerHTML = `
    ${layout.ticks
      .map(
        (t) =>
          `<span class="today-tick" style="left:${t.left}%">${escapeHtml(hourLabel(t.at))}</span>`,
      )
      .join("")}
    <div class="today-bars" role="list" aria-label="Today's sessions">
      ${layout.bars
        .map(({ session: s, start, end, left, width }) => {
          const label = [
            s.running ? "Recording now" : s.title,
            s.projectName || "No project",
            `${clock(start)}–${s.running ? "now" : clock(end)}`,
            hm(s.duration),
            s.billable ? "billable" : "",
          ]
            .filter(Boolean)
            .join(" · ");
          return `<div role="listitem" class="today-bar${s.running ? " running" : ""}${s.billable ? " billable" : ""}"
            style="left:${left}%;width:${width}%;${s.color ? `background:${escapeHtml(s.color)};` : ""}"
            title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"></div>`;
        })
        .join("")}
    </div>
  `;
}

onTrackingState(() => draw());
// Grow the running bar about once a minute
onClockTick((seconds, state) => {
  if (state.isRecording && !state.isPaused && seconds % 60 === 0) draw();
  else drawTotals();
});

export async function renderTodayTimeline(container: HTMLElement) {
  const today = getLocalDateString();
  const [sessions, projects] = await Promise.all([
    safeIpcInvoke<SessionWithEnd[]>(
      "get-sessions",
      [{ startDate: today, endDate: today }],
      { fallback: [], showNotification: false },
    ),
    safeIpcInvoke<{ id: string; name: string; color?: string | null }[]>(
      "get-projects-for-user",
      [],
      { fallback: [], showNotification: false },
    ),
  ]);
  todaysSessions = (sessions ?? []).map(toTimeline);
  projectNames = new Map((projects ?? []).map((p) => [p.id, p]));

  container.innerHTML = `
    <section id="homeTimeline" class="today-timeline" aria-label="Today">
      <div class="today-timeline-header">
        <h2>Today</h2>
        <span class="timeline-totals"></span>
      </div>
      <div class="today-track"></div>
    </section>
  `;
  draw();
}
