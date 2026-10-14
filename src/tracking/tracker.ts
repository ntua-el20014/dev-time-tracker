/**
 * Tracking engine: owns the recording state (main process is the single
 * source of truth), samples the foreground window while recording, batches
 * usage writes, handles idle/lock/sleep, and saves sessions.
 *
 * The renderer and tray only *ask* for changes (IPC / function calls) and
 * render the state broadcast on "tracking-state".
 */
import {
  ipcMain,
  powerMonitor,
  type BrowserWindow,
  type IpcMainEvent,
} from "electron";
import { activeWindow } from "@miniben90/x-win";
import { matchApp } from "../utils/editors";
import {
  getLanguageDataFromTitle,
  loadUserLangMapFromDisk,
} from "../utils/extractData";
import { addSession } from "../supabase/timeTracking";
import {
  insertUsageLogs,
  addUsageToDailySummary,
} from "../supabase/usageLogs";
import {
  getIdleTimeout,
  getTrackingInterval,
} from "../supabase/userPreferences";
import { logError, classifyError, withRetry } from "../utils/errorHandler";
import { enqueueUsageLog, enqueueSession } from "../utils/offlineQueue";
import {
  DEFAULT_IDLE_TIMEOUT_SECONDS,
  DEFAULT_TRACKING_INTERVAL_SECONDS,
} from "../../shared/constants";
import { SessionClock, type SessionSnapshot } from "./sessionClock";
import { decideIdleAction } from "./idlePolicy";
import { createUsageSampler } from "./usageSampler";
import { UsageBatcher } from "./usageBatcher";

export interface TrackingState {
  isRecording: boolean;
  isPaused: boolean;
  /** Paused by idle/lock/sleep rather than by the user */
  autoPaused: boolean;
  isIncognito: boolean;
}

/** Sessions shorter than this (active seconds) are not saved. */
const MIN_SESSION_SECONDS = 10;
/** How long Stop waits for the session-info modal before auto-saving. */
const SESSION_INFO_TIMEOUT_MS = 10 * 60 * 1000;
/** How often buffered usage ticks are written to Supabase. */
const FLUSH_INTERVAL_MS = 60 * 1000;
const IDLE_POLL_MS = 2000;

// ── State ────────────────────────────────────────────────────────────

const clock = new SessionClock();
let getWindow: () => BrowserWindow | null = () => null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let intervalSeconds = DEFAULT_TRACKING_INTERVAL_SECONDS;
let idleTimeoutSeconds = DEFAULT_IDLE_TIMEOUT_SECONDS;
let isIncognito = false;
/** System away states: never auto-resume while either is set. */
let screenLocked = false;
let systemSuspended = false;
/**
 * Signed-in user, taken from the session the renderer syncs to main. Using
 * it (instead of getCurrentUser(), a network call) keeps ticks offline-safe.
 */
let currentUserId: string | null = null;
const stateListeners = new Set<(state: TrackingState) => void>();

function send(channel: string, payload?: unknown) {
  const win = getWindow();
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function notify(message: string) {
  if (!isIncognito) send("notify", { message });
}

export function getTrackingState(): TrackingState {
  return { ...clock.state, isIncognito };
}

function emitState() {
  const state = getTrackingState();
  send("tracking-state", state);
  for (const listener of stateListeners) listener(state);
}

export function onTrackingStateChange(
  listener: (state: TrackingState) => void,
) {
  stateListeners.add(listener);
}

// ── User & preferences ───────────────────────────────────────────────

export function hasTrackingUser(): boolean {
  return currentUserId !== null;
}

/** Called whenever the renderer syncs (or clears) the auth session. */
export function setTrackingUser(userId: string | null) {
  if (userId === currentUserId) return;
  currentUserId = userId;
  if (userId) {
    loadUserLangMapFromDisk(userId);
    void loadTrackingPreferences(userId);
  }
}

/** Apply the user's saved idle timeout and tracking interval. */
async function loadTrackingPreferences(userId: string) {
  try {
    const [idle, interval] = await Promise.all([
      getIdleTimeout(userId),
      getTrackingInterval(userId),
    ]);
    if (currentUserId !== userId) return; // user changed meanwhile
    if (typeof idle === "number" && idle > 0) updateIdleTimeout(idle);
    if (typeof interval === "number" && interval > 0) {
      updateTrackingInterval(interval);
    }
  } catch (err) {
    if (classifyError(err) !== "network") {
      logError("loadTrackingPreferences", err);
    }
  }
}

export function updateIdleTimeout(seconds: number) {
  idleTimeoutSeconds = seconds;
}

/** Restarts the running tick timer with the new cadence. */
export function updateTrackingInterval(seconds: number) {
  intervalSeconds = seconds;
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = setInterval(tick, intervalSeconds * 1000);
  }
}

// ── Usage sampling & batching ────────────────────────────────────────

const sampleUsage = createUsageSampler({
  getForegroundWindow() {
    const win = activeWindow(); // synchronous
    if (!win) return null;
    return {
      execName: win.info?.execName ?? "",
      title: win.title ?? "",
      getIconData: () => win.getIcon().data,
    };
  },
  matchApp,
  getLanguageFromTitle: getLanguageDataFromTitle,
});

const batcher = new UsageBatcher({
  writer: {
    insertLogs: (records) =>
      withRetry(() => insertUsageLogs(records), {
        maxAttempts: 2,
        retryOn: ["network"],
      }),
    addToSummary: addUsageToDailySummary,
  },
  isNetworkError: (err) => classifyError(err) === "network",
  enqueueOffline: (r, icon) =>
    enqueueUsageLog(
      r.userId,
      r.appName,
      r.windowTitle,
      r.language,
      r.languageExtension,
      icon,
      r.intervalSeconds,
      r.timestamp,
    ),
  logError,
});

function tick() {
  if (isIncognito || !currentUserId) return;
  try {
    const sample = sampleUsage(currentUserId);
    if (!sample) return;
    batcher.add({
      userId: currentUserId,
      ...sample,
      intervalSeconds,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logError("trackActiveWindow", err);
  }
}

/** Write buffered usage now. Safe to call at any time. */
export async function flushTrackedUsage() {
  try {
    const written = await batcher.flush();
    if (written > 0) send("window-tracked");
  } catch (err) {
    logError("flushTrackedUsage", err);
  }
}

function startTimers() {
  if (!tickTimer) tickTimer = setInterval(tick, intervalSeconds * 1000);
  if (!flushTimer) {
    flushTimer = setInterval(() => void flushTrackedUsage(), FLUSH_INTERVAL_MS);
  }
}

function stopTimers() {
  if (tickTimer) clearInterval(tickTimer);
  if (flushTimer) clearInterval(flushTimer);
  tickTimer = null;
  flushTimer = null;
}

// ── Session control ──────────────────────────────────────────────────

export function startTracking() {
  if (clock.isRecording) return;
  clock.startAt(new Date());
  startTimers();
  emitState();
}

export function pauseTracking(automatic = false) {
  if (!clock.pause(new Date(), automatic)) return;
  stopTimers();
  void flushTrackedUsage();
  emitState();
}

export function resumeTracking() {
  if (!clock.resume(new Date())) return;
  startTimers();
  emitState();
}

type SessionInfo = {
  title: string;
  description: string;
  projectId?: number | string;
  isBillable?: boolean;
};

const TIMED_OUT_SESSION_INFO: SessionInfo = {
  title: "Untitled Session",
  description: "Session info dialog timed out — auto-saved.",
};

const APP_CLOSED_SESSION_INFO: SessionInfo = {
  title: "Auto-saved session (app closed)",
  description: "Session was automatically saved when the application closed",
  isBillable: false,
};

/** Settles the open session-info prompt early (another stop, or quit). */
let settleSessionInfo: ((info: SessionInfo) => void) | null = null;
/** Save of a stopped session that is still waiting on its session-info prompt. */
let pendingStopSave: Promise<void> | null = null;

/** Ask the renderer for title/project/billing of a stopped session. */
function askSessionInfo(): Promise<SessionInfo> {
  return new Promise((resolve) => {
    const finish = (info: SessionInfo) => {
      clearTimeout(timeout);
      ipcMain.removeListener("session-info-reply", onReply);
      settleSessionInfo = null;
      resolve(info);
    };
    const onReply = (_event: IpcMainEvent, data: SessionInfo) => finish(data);
    // Closing the renderer's modal is what tells the user it was auto-saved
    const settleEarly = (info: SessionInfo) => {
      send("session-info-timeout");
      finish(info);
    };
    const timeout = setTimeout(
      () => settleEarly(TIMED_OUT_SESSION_INFO),
      SESSION_INFO_TIMEOUT_MS,
    );

    settleSessionInfo = settleEarly;
    ipcMain.on("session-info-reply", onReply);
    send("get-session-info");
  });
}

async function saveSession(
  uid: string,
  session: SessionSnapshot,
  info: SessionInfo,
  { queueOnAnyError = false } = {},
) {
  const startTime = session.start.toISOString();
  const endTime = session.end.toISOString();
  const projectId = info.projectId ? String(info.projectId) : undefined;
  const isBillable = info.isBillable || false;
  try {
    await addSession(
      uid,
      startTime,
      session.duration,
      info.title,
      info.description,
      undefined, // tags
      projectId,
      isBillable,
      endTime,
    );
  } catch (err) {
    if (queueOnAnyError || classifyError(err) === "network") {
      // Queue locally so the session is not lost
      enqueueSession(
        uid,
        startTime,
        session.duration,
        info.title,
        info.description,
        undefined,
        projectId,
        isBillable,
        endTime,
      );
    } else {
      logError("saveSession", err);
    }
  }
}

/**
 * Ends the session, then asks for its details and saves it. The tracker is
 * free immediately, so a new session can start while the prompt is open.
 */
export async function stopTracking() {
  const session = clock.stop(new Date());
  stopTimers();
  void flushTrackedUsage();
  emitState();
  if (!session || session.duration < MIN_SESSION_SECONDS) return;

  const uid = currentUserId;
  if (!uid) return;

  // A previous stop is still waiting on its prompt — auto-save it first
  settleSessionInfo?.(TIMED_OUT_SESSION_INFO);

  const save = (async () => {
    const info = await askSessionInfo();
    // An empty title means the user chose "Discard"
    if (info.title && info.title.trim() !== "") {
      await saveSession(uid, session, info);
    }
  })();
  pendingStopSave = save;
  try {
    await save;
  } finally {
    if (pendingStopSave === save) pendingStopSave = null;
  }
}

// ── Incognito ────────────────────────────────────────────────────────

export function toggleIncognito(): boolean {
  isIncognito = !isIncognito;
  send("incognito-toggled", isIncognito);
  emitState();
  return isIncognito;
}

// ── Quit ─────────────────────────────────────────────────────────────

/** True if quitting now would lose a session or buffered usage. */
export function hasUnsavedTrackingWork(): boolean {
  return (
    clock.isRecording || pendingStopSave !== null || batcher.pendingCount > 0
  );
}

/**
 * Saves everything before quit: settles an open prompt, auto-saves a running
 * or paused session, and flushes buffered usage (offline queue on failure).
 */
export async function finalizeTrackingForQuit() {
  if (pendingStopSave) {
    settleSessionInfo?.(APP_CLOSED_SESSION_INFO);
    await pendingStopSave;
  }

  const session = clock.stop(new Date());
  stopTimers();
  await flushTrackedUsage();

  if (session && session.duration >= MIN_SESSION_SECONDS && currentUserId) {
    await saveSession(currentUserId, session, APP_CLOSED_SESSION_INFO, {
      queueOnAnyError: true,
    });
  }
}

// ── Idle / power ─────────────────────────────────────────────────────

function pollIdle() {
  const action = decideIdleAction({
    idleSeconds: powerMonitor.getSystemIdleTime(),
    idleTimeoutSeconds,
    ...clock.state,
    screenLocked,
    systemSuspended,
  });
  if (action === "pause") {
    pauseTracking(true);
    notify(
      `Tracking paused due to inactivity (${(idleTimeoutSeconds / 60).toFixed(
        1,
      )} minutes idle).`,
    );
  } else if (action === "resume") {
    resumeTracking();
    notify("Welcome back — tracking resumed.");
  }
}

/** Call once the app is ready (powerMonitor needs it). */
export function initTracking(options: {
  getWindow: () => BrowserWindow | null;
}) {
  getWindow = options.getWindow;

  // Pause when the user is away; the idle poll resumes once they're back
  powerMonitor.on("lock-screen", () => {
    screenLocked = true;
    pauseTracking(true);
  });
  powerMonitor.on("unlock-screen", () => {
    screenLocked = false;
  });
  powerMonitor.on("suspend", () => {
    systemSuspended = true;
    pauseTracking(true);
  });
  powerMonitor.on("resume", () => {
    systemSuspended = false;
  });

  setInterval(pollIdle, IDLE_POLL_MS);
}

// ── IPC ──────────────────────────────────────────────────────────────

ipcMain.handle("get-tracking-state", () => getTrackingState());
ipcMain.handle("start-tracking", () => {
  startTracking();
  return getTrackingState();
});
ipcMain.handle("pause-tracking", () => {
  pauseTracking(false);
  return getTrackingState();
});
ipcMain.handle("resume-tracking", () => {
  resumeTracking();
  return getTrackingState();
});
ipcMain.handle("stop-tracking", async () => {
  await stopTracking();
  return getTrackingState();
});
ipcMain.handle("toggle-incognito", () => toggleIncognito());
ipcMain.handle("get-incognito-status", () => isIncognito);
