/**
 * Renderer-side view of the tracking state. The main process owns the state
 * (src/tracking/tracker.ts); this module mirrors what it broadcasts on
 * "tracking-state" and sends requests. Never flip the state locally — ask
 * main and render what it reports back.
 */
import { ipcRenderer } from "./ipc";

export interface TrackingState {
  isRecording: boolean;
  isPaused: boolean;
  autoPaused: boolean;
  isIncognito: boolean;
  /** Active seconds of the current session when main sent this state */
  activeSeconds: number;
  /** Wall-clock start of the current session (ISO), or null */
  startedAt: string | null;
  /** Project of the current (or next) session, chosen before Start */
  projectId: string | null;
}

let state: TrackingState = {
  isRecording: false,
  isPaused: false,
  autoPaused: false,
  isIncognito: false,
  activeSeconds: 0,
  startedAt: null,
  projectId: null,
};
const listeners = new Set<(state: TrackingState) => void>();

function apply(next: TrackingState | null | undefined) {
  if (!next) return;
  state = next;
  for (const listener of listeners) listener(state);
}

ipcRenderer.on("tracking-state", (_event: unknown, next: TrackingState) =>
  apply(next),
);

export function getTrackingState(): TrackingState {
  return state;
}

/** Calls `listener` now and on every change. */
export function onTrackingState(listener: (state: TrackingState) => void) {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

/** Re-read the state from main (e.g. after a window reload). */
export async function refreshTrackingState() {
  apply(await ipcRenderer.invoke("get-tracking-state"));
}

export async function startTracking() {
  apply(await ipcRenderer.invoke("start-tracking"));
}

/** Resolves once the session-info prompt has been answered (or timed out). */
export async function stopTracking() {
  apply(await ipcRenderer.invoke("stop-tracking"));
}

export async function pauseTracking() {
  apply(await ipcRenderer.invoke("pause-tracking"));
}

export async function resumeTracking() {
  apply(await ipcRenderer.invoke("resume-tracking"));
}

/** Choose the project for the current session, or the next one. */
export async function setSessionProject(projectId: string | null) {
  apply(await ipcRenderer.invoke("set-session-project", projectId));
}

export async function toggleRecording() {
  if (state.isRecording) await stopTracking();
  else await startTracking();
}

export async function togglePause() {
  if (!state.isRecording) return;
  if (state.isPaused) await resumeTracking();
  else await pauseTracking();
}
