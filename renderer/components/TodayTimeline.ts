/**
 * Home's "Today" timeline: today's sessions as bars on the day, colored by
 * project, with the running session growing live. Time spent supervising an
 * AI agent is hatched over the bars.
 *
 * Always-on drafts (Phase D) are drawn as dashed, unfilled bars and counted
 * apart ("40m unconfirmed"), never as tracked or billable time; clicking one
 * opens the review inbox. The open segment is drawn live from the tracking
 * state instead of its last saved row.
 */
import { escapeHtml } from "../utils/domUtils";
import { safeIpcInvoke } from "../utils/ipcHelpers";
import { getLocalDateString } from "../../src/utils/timeFormat";
import { getTrackingState, onTrackingState } from "../trackingControls";
import {
  currentSeconds,
  currentSupervisingSeconds,
  onClockTick,
} from "../liveClock";
import { navigateTo } from "../navigation";
import { onDraftCount, onDraftSaved } from "../draftCount";
import { billableSecondsOf } from "../../shared/billing";
import {
  layoutTimeline,
  type TimelineSession,
} from "../utils/timelineLayout";
import type { SessionRow } from "../../shared/types";

type SessionWithEnd = SessionRow & { end_time?: string | null };
type DraftWithEnd = SessionWithEnd & { client_id?: string | null };
type TimelineDraft = TimelineSession & { clientId: string | null };

const toSpans = (spans: [string, string][] | null | undefined) =>
  (spans ?? []).map(([a, b]) => ({ start: new Date(a), end: new Date(b) }));

let todaysSessions: TimelineSession[] = [];
let todaysDrafts: TimelineDraft[] = [];
let projectNames = new Map<string, { name: string; color?: string | null }>();
/** When the last tracking state arrived (the open segment counts up from it) */
let stateAt = Date.now();

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
    billedSeconds: billableSecondsOf(s, s.project_bill_supervising),
    supervisingSeconds: s.supervising_seconds || 0,
    supervisingSpans: toSpans(s.supervising_spans),
  };
}

function toDraft(s: DraftWithEnd): TimelineDraft {
  return {
    ...toTimeline(s),
    title: s.title || "Untitled",
    billable: false,
    billedSeconds: 0,
    draft: true,
    clientId: s.client_id ?? null,
  };
}

/** The always-on segment being recorded now, if any. */
function liveSegment(): TimelineSession | null {
  const state = getTrackingState();
  const segment = state.autoSegment;
  if (!segment) return null;
  const project = segment.projectId ? projectNames.get(segment.projectId) : undefined;
  const spans = toSpans(segment.supervisingSpans);
  // The open span keeps growing until main reports otherwise
  const last = spans[spans.length - 1];
  if (last && state.activity === "supervising" && !segment.isPaused) last.end = new Date();
  const extra = segment.isPaused ? 0 : Math.floor((Date.now() - stateAt) / 1000);
  return {
    id: "segment",
    title: "Always-on draft",
    start: new Date(segment.startedAt),
    end: null,
    duration: segment.activeSeconds + extra,
    projectName: project?.name ?? null,
    color: project?.color ?? null,
    supervisingSeconds: segment.supervisingSeconds,
    supervisingSpans: spans,
    running: true,
    draft: true,
  };
}

/** Today's drafts, with the open segment live in place of its saved row. */
function drafts(): TimelineSession[] {
  const live = liveSegment();
  const openId = getTrackingState().autoSegment?.clientId;
  const saved = todaysDrafts.filter((d) => !openId || d.clientId !== openId);
  return live ? [...saved, live] : saved;
}

function runningSession(): TimelineSession | null {
  const state = getTrackingState();
  if (!state.isRecording || !state.startedAt) return null;
  const project = state.projectId ? projectNames.get(state.projectId) : undefined;
  const spans = toSpans(state.supervisingSpans);
  // The open span keeps growing until main reports otherwise
  const last = spans[spans.length - 1];
  if (last && state.activity === "supervising" && !state.isPaused) last.end = new Date();
  return {
    id: "running",
    title: "Current session",
    start: new Date(state.startedAt),
    end: null,
    duration: currentSeconds(),
    projectName: project?.name ?? null,
    color: project?.color ?? null,
    supervisingSeconds: currentSupervisingSeconds(),
    supervisingSpans: spans,
    running: true,
  };
}

/**
 * "2h 05m tracked · 1h 30m billable · 25m supervising · 40m unconfirmed",
 * counting the running session and the open segment live.
 */
function drawTotals() {
  const totals = document.querySelector("#homeTimeline .timeline-totals");
  if (!totals) return;
  const state = getTrackingState();
  const running = state.isRecording ? currentSeconds() : 0;
  const tracked = todaysSessions.reduce((sum, s) => sum + s.duration, 0) + running;
  const billable = todaysSessions.reduce(
    (sum, s) => sum + (s.billable ? (s.billedSeconds ?? s.duration) : 0),
    0,
  );
  const supervising =
    todaysSessions.reduce((sum, s) => sum + (s.supervisingSeconds || 0), 0) +
    (state.isRecording ? currentSupervisingSeconds() : 0);
  const unconfirmed = drafts().reduce((sum, s) => sum + s.duration, 0);

  const parts: string[] = [];
  if (tracked) {
    parts.push(
      `${hm(tracked)} tracked · ${hm(billable)} billable${
        supervising ? ` · ${hm(supervising)} supervising` : ""
      }`,
    );
  }
  if (unconfirmed) parts.push(`${hm(unconfirmed)} unconfirmed`);
  totals.textContent = parts.join(" · ") || "Nothing tracked yet today";
  totals.setAttribute(
    "title",
    unconfirmed ? "Unconfirmed: always-on drafts, counted once you confirm them" : "",
  );
}

/** Redraw from the loaded sessions and drafts plus the live ones (if on screen). */
function draw() {
  const box = document.getElementById("homeTimeline");
  if (!box) return;
  const running = runningSession();
  const layout = layoutTimeline(
    [...todaysSessions, ...(running ? [running] : []), ...drafts()],
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
            s.draft ? "Unconfirmed draft (always-on)" : "",
            s.running ? "Recording now" : s.title,
            s.projectName || "No project",
            `${clock(start)}–${s.running ? "now" : clock(end)}`,
            hm(s.duration),
            s.supervisingSeconds ? `${hm(s.supervisingSeconds)} supervising an agent` : "",
            s.billable ? "billable" : "",
            s.draft ? "click to review" : "",
          ]
            .filter(Boolean)
            .join(" · ");
          // Drafts take the project color as a dashed outline, not a fill
          const color = s.color
            ? s.draft
              ? `--bar-color:${escapeHtml(s.color)};`
              : `background:${escapeHtml(s.color)};`
            : "";
          return `<div role="listitem" class="today-bar${s.running ? " running" : ""}${s.billable ? " billable" : ""}${s.draft ? " draft" : ""}"
            style="left:${left}%;width:${width}%;${color}"
            ${s.draft ? `tabindex="0" data-action="review-drafts"` : ""}
            title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"></div>`;
        })
        .join("")}
      ${layout.supervising
        .map(
          (sv) =>
            `<div class="today-supervising" style="left:${sv.left}%;width:${sv.width}%" aria-hidden="true"></div>`,
        )
        .join("")}
    </div>
  `;
}

let lastSegmentId: string | null = null;
onTrackingState((state) => {
  stateAt = Date.now();
  const segmentId = state.autoSegment?.clientId ?? null;
  // A segment ended or split: show its saved row (its final save sends
  // "drafts-changed" again when it lands)
  if (lastSegmentId && segmentId !== lastSegmentId) void reloadDrafts();
  lastSegmentId = segmentId;
  draw();
});
// Grow the running bar about once a minute
onClockTick((seconds, state) => {
  if (state.isRecording && !state.isPaused && seconds % 60 === 0) draw();
  else drawTotals();
});
// The open always-on segment has no clock tick: grow it once a minute
setInterval(() => {
  const segment = getTrackingState().autoSegment;
  if (segment && !segment.isPaused) draw();
}, 60_000);

let draftsLoad = 0;
async function loadTodaysDrafts(): Promise<void> {
  const load = ++draftsLoad;
  const today = getLocalDateString();
  const rows = await safeIpcInvoke<DraftWithEnd[] | null>(
    "get-draft-sessions",
    [{ startDate: today, endDate: today }],
    { fallback: null, showNotification: false },
  );
  // A newer load started meanwhile; on errors keep what is shown
  if (load !== draftsLoad || !rows) return;
  todaysDrafts = rows.map(toDraft);
}

/** Drafts were saved, confirmed, merged or discarded: redraw if Home is rendered. */
async function reloadDrafts() {
  if (!document.getElementById("homeTimeline")) return;
  await loadTodaysDrafts();
  draw();
}
onDraftSaved(() => void reloadDrafts());
onDraftCount(() => void reloadDrafts());

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
    loadTodaysDrafts(),
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
  // Draft bars open the review inbox
  const track = container.querySelector<HTMLElement>(".today-track");
  const review = (e: Event) => {
    if ((e.target as HTMLElement).closest('[data-action="review-drafts"]')) {
      e.preventDefault();
      navigateTo("sessions", "list");
    }
  };
  track?.addEventListener("click", review);
  track?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") review(e);
  });
  draw();
}
