/**
 * Home's timer card: pick the project, then Start. The project lives in
 * main (TrackingState.projectId), so the rail button, Ctrl+R and the tray
 * start into the same project, and changing it mid-session moves the
 * running session.
 *
 * Below the picker, the repo main detected in the focused editor/terminal:
 * a linked repo's project is selected automatically before Start (unless
 * the user picked one); an unlinked repo can be linked in one click.
 *
 * Then the Claude Code sessions that report through hooks (Settings →
 * Integrations → Connect Claude Code): working, waiting for you, or done.
 */
import { escapeHtml } from "../utils/domUtils";
import { safeIpcInvoke } from "../utils/ipcHelpers";
import { showInAppNotification } from "./Notifications";
import {
  getTrackingState,
  onTrackingState,
  toggleRecording,
  togglePause,
  type LiveAgent,
  type TrackingState,
} from "../trackingControls";
import { currentSeconds, formatClock, onClockTick } from "../liveClock";
import { chooseProject, clearStaleProject } from "../sessionProject";
import { markTabsDirty, navigateTo } from "../navigation";
import { draftsLabel, getDraftCount, onDraftCount } from "../draftCount";
import { DEFAULT_CURRENCY, formatRate } from "../../shared/currency";

interface PickerProject {
  id: string;
  name: string;
  color?: string | null;
  hourly_rate?: number | null;
  currency?: string;
  scope?: string;
}

let projects: PickerProject[] = [];

const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Outside a session with always-on: the segment being recorded as a draft. */
function alwaysOnText(state: TrackingState): string {
  const segment = state.autoSegment;
  if (!segment) return "Ready · Always-on, waiting for activity";
  return segment.isPaused
    ? `Ready · Always-on, paused (you were away) · draft since ${clockTime(segment.startedAt)}`
    : `Ready · Always-on, recording a draft since ${clockTime(segment.startedAt)}`;
}

function statusText(state: TrackingState): string {
  if (!state.isRecording) return state.alwaysOn ? alwaysOnText(state) : "Ready";
  if (state.isPaused) return state.autoPaused ? "Paused — you were away" : "Paused";
  return state.activity === "supervising" ? "Supervising an agent" : "Recording";
}

function projectLabel(id: string | null): string {
  const p = projects.find((x) => x.id === id);
  return p ? p.name : "No project";
}

/** The detected-repo line: what's linked, and a one-click fix if needed. */
function repoHintHtml(state: TrackingState): string {
  const repo = state.detectedRepo;
  if (!repo) return "";
  const name = `<strong>${escapeHtml(repo.name)}</strong>`;
  const linked = repo.projectId ? projects.find((p) => p.id === repo.projectId) : null;
  const selected = projects.find((p) => p.id === state.projectId);
  const button = (action: string, projectId: string, label: string) =>
    `<button type="button" class="home-repo-action" data-action="${action}" data-project="${escapeHtml(projectId)}">${escapeHtml(label)}</button>`;

  if (linked) {
    if (linked.id === state.projectId) {
      return `<span>Repo ${name} · linked to this project</span>`;
    }
    return `<span>Repo ${name} is linked to <strong>${escapeHtml(linked.name)}</strong></span>${button("use", linked.id, `Use ${linked.name}`)}`;
  }
  if (selected) {
    return `<span>Repo ${name} isn't linked to a project</span>${button("link", selected.id, `Always use ${selected.name}`)}`;
  }
  return `<span>Repo ${name} isn't linked — pick its project to link it</span>`;
}

const AGENT_STATUS: Record<LiveAgent["status"], string> = {
  working: "working",
  waiting: "waiting for you",
  idle: "done",
};

function minutesSince(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Live Claude Code sessions, one chip each (at most three). */
function agentsHtml(state: TrackingState): string {
  const agents = state.liveAgents ?? [];
  if (agents.length === 0) return "";
  const chips = agents
    .slice(0, 3)
    .map(
      (a) =>
        `<span class="home-agent ${a.status}" title="Claude Code, ${escapeHtml(AGENT_STATUS[a.status])} since ${escapeHtml(new Date(a.since).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}"><span class="home-agent-dot" aria-hidden="true"></span>Claude Code${a.repoName ? ` · <strong>${escapeHtml(a.repoName)}</strong>` : ""} · ${escapeHtml(AGENT_STATUS[a.status])} <span class="home-agent-since">${escapeHtml(minutesSince(a.since))}</span></span>`,
    )
    .join("");
  const more = agents.length > 3 ? `<span class="home-agent-more">+${agents.length - 3} more</span>` : "";
  return chips + more;
}

/** Reflect main's state into the card, if it's on screen. */
function sync(state: TrackingState) {
  const card = document.getElementById("homeTimer");
  if (!card) return;
  card.classList.toggle("recording", state.isRecording && !state.isPaused);
  card.classList.toggle("paused", state.isRecording && state.isPaused);

  const startBtn = card.querySelector<HTMLButtonElement>("#homeStartBtn");
  if (startBtn) {
    startBtn.textContent = state.isRecording ? "■ Stop" : "▶ Start";
    startBtn.classList.toggle("is-stop", state.isRecording);
    startBtn.title = state.isRecording
      ? "Stop and save this session (Ctrl+R)"
      : "Start recording (Ctrl+R)";
  }
  const pauseBtn = card.querySelector<HTMLButtonElement>("#homePauseBtn");
  if (pauseBtn) {
    pauseBtn.hidden = !state.isRecording;
    pauseBtn.textContent = state.isPaused ? "▶ Resume" : "❚❚ Pause";
  }
  const select = card.querySelector<HTMLSelectElement>("#homeProjectSelect");
  if (select && select.value !== (state.projectId ?? "")) {
    select.value = state.projectId ?? "";
  }
  const hint = card.querySelector<HTMLElement>("#homeRepoHint");
  if (hint) {
    const html = repoHintHtml(state);
    if (hint.innerHTML !== html) hint.innerHTML = html;
    hint.hidden = html === "";
  }
  const agents = card.querySelector<HTMLElement>("#homeAgents");
  if (agents) {
    const html = agentsHtml(state);
    if (agents.innerHTML !== html) agents.innerHTML = html;
    agents.hidden = html === "";
  }
  const status = card.querySelector("#homeTimerStatus");
  if (status) {
    status.textContent = state.isRecording
      ? `${statusText(state)} · ${projectLabel(state.projectId)}`
      : statusText(state);
  }
}

onTrackingState(sync);

/** "3 drafts to review →" (always-on), linking to the inbox. */
function showDraftCount(n: number) {
  const btn = document.getElementById("homeDrafts");
  if (!btn) return;
  btn.textContent = `📥 ${draftsLabel(n)} →`;
  btn.hidden = n === 0;
}
onDraftCount(showDraftCount);
// Keep the agents' "for 5m" fresh between state broadcasts
setInterval(() => {
  const state = getTrackingState();
  if (state.liveAgents?.length) sync(state);
}, 30_000);
onClockTick((seconds) => {
  const el = document.getElementById("homeTimerClock");
  if (el) el.textContent = formatClock(seconds);
});

export async function renderHomeTimer(container: HTMLElement) {
  const loaded = await safeIpcInvoke<PickerProject[] | null>(
    "get-projects-for-user",
    [],
    { fallback: null, showNotification: false },
  );
  projects = loaded ?? [];

  const state = getTrackingState();
  // The remembered project was archived or deleted: forget it. Only when
  // the list actually loaded, so a network error doesn't clear the choice.
  if (loaded && state.projectId && !projects.some((p) => p.id === state.projectId)) {
    void clearStaleProject();
  }

  container.innerHTML = `
    <section id="homeTimer" class="home-timer" aria-label="Session timer">
      <div class="home-timer-main">
        <label class="home-project-picker">
          <span class="home-project-label">Project</span>
          <select id="homeProjectSelect">
            <option value="">No project</option>
            ${projects
              .map(
                (p) =>
                  `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}${
                    p.hourly_rate != null
                      ? escapeHtml(` · ${formatRate(Number(p.hourly_rate), p.currency ?? DEFAULT_CURRENCY)}`)
                      : ""
                  }</option>`,
              )
              .join("")}
          </select>
        </label>
        <div class="home-timer-readout">
          <span id="homeTimerClock" class="home-timer-clock">${formatClock(currentSeconds())}</span>
          <span id="homeTimerStatus" class="home-timer-status" aria-live="polite"></span>
        </div>
        <div class="home-timer-actions">
          <button type="button" id="homeStartBtn" class="home-start-btn">▶ Start</button>
          <button type="button" id="homePauseBtn" class="home-pause-btn" hidden>❚❚ Pause</button>
        </div>
      </div>
      <div id="homeRepoHint" class="home-repo-hint" aria-live="polite" hidden></div>
      <div id="homeAgents" class="home-agents" aria-live="polite" hidden></div>
      <button type="button" id="homeDrafts" class="home-drafts" hidden></button>
      ${
        projects.length === 0
          ? `<p class="home-timer-hint">Create a project on the Projects page to bill your time per project.</p>`
          : ""
      }
    </section>
  `;

  container
    .querySelector<HTMLSelectElement>("#homeProjectSelect")
    ?.addEventListener("change", async (e) => {
      const value = (e.target as HTMLSelectElement).value;
      try {
        await chooseProject(value || null);
      } catch {
        showInAppNotification("Could not change the project.", 3500, "error");
      }
    });

  container
    .querySelector("#homeDrafts")
    ?.addEventListener("click", () => navigateTo("sessions", "list"));
  showDraftCount(getDraftCount());

  container.querySelector("#homeRepoHint")?.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".home-repo-action");
    const projectId = btn?.dataset.project;
    if (!btn || !projectId) return;
    btn.disabled = true;
    if (btn.dataset.action === "use") {
      try {
        await chooseProject(projectId);
      } catch {
        showInAppNotification("Could not change the project.", 3500, "error");
      }
    } else {
      const ok = await safeIpcInvoke<boolean>("link-detected-repo", [projectId], {
        fallback: false,
      });
      if (ok) markTabsDirty("projects");
      else showInAppNotification("Could not link the repo.", 3500, "error");
    }
    btn.disabled = false;
  });

  container.querySelector("#homeStartBtn")?.addEventListener("click", async () => {
    try {
      await toggleRecording();
    } catch {
      showInAppNotification("Failed to toggle tracking. Please try again.", 3500, "error");
    }
  });

  container.querySelector("#homePauseBtn")?.addEventListener("click", async () => {
    try {
      await togglePause();
    } catch {
      showInAppNotification("Failed to toggle pause. Please try again.", 3500, "error");
    }
  });

  sync(getTrackingState());
}
