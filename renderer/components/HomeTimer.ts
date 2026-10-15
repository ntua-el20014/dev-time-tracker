/**
 * Home's timer card: pick the project, then Start. The project lives in
 * main (TrackingState.projectId), so the rail button, Ctrl+R and the tray
 * start into the same project, and changing it mid-session moves the
 * running session.
 */
import { escapeHtml } from "../utils/domUtils";
import { safeIpcInvoke } from "../utils/ipcHelpers";
import { showInAppNotification } from "./Notifications";
import {
  getTrackingState,
  onTrackingState,
  toggleRecording,
  togglePause,
  type TrackingState,
} from "../trackingControls";
import { currentSeconds, formatClock, onClockTick } from "../liveClock";
import { chooseProject } from "../sessionProject";

interface PickerProject {
  id: string;
  name: string;
  color?: string | null;
  hourly_rate?: number | null;
  scope?: string;
}

let projects: PickerProject[] = [];

function statusText(state: TrackingState): string {
  if (!state.isRecording) return "Ready";
  if (state.isPaused) return state.autoPaused ? "Paused — you were idle" : "Paused";
  return "Recording";
}

function projectLabel(id: string | null): string {
  const p = projects.find((x) => x.id === id);
  return p ? p.name : "No project";
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
  const status = card.querySelector("#homeTimerStatus");
  if (status) {
    status.textContent = state.isRecording
      ? `${statusText(state)} · ${projectLabel(state.projectId)}`
      : statusText(state);
  }
}

onTrackingState(sync);
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
    void chooseProject(null);
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
                    p.hourly_rate != null ? ` · $${Number(p.hourly_rate).toFixed(0)}/h` : ""
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
