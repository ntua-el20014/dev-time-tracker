/**
 * Tracking engine: owns the recording state (main process is the single
 * source of truth), samples the foreground window while recording, batches
 * usage writes, handles idle/lock/sleep, and saves sessions.
 *
 * The renderer and tray only *ask* for changes (IPC / function calls) and
 * render the state broadcast on "tracking-state".
 */
import {
  app,
  ipcMain,
  powerMonitor,
  type BrowserWindow,
  type IpcMainEvent,
} from "electron";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
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
import { decideIdleAction, type Activity } from "./idlePolicy";
import { createAgentHeartbeat } from "./agentHeartbeat";
import { createUsageSampler } from "./usageSampler";
import { UsageBatcher } from "./usageBatcher";
import { getWorkspaceHint } from "./workspaceHints";
import { createRepoResolver, type RepoInfo } from "./repoResolver";
import {
  ProjectAttribution,
  type DetectedRepo,
  type ProjectSource,
} from "./projectAttribution";
import {
  getRepoLinks,
  linkRepoToProject,
} from "../supabase/projectRepositories";
import {
  getOrganizationProjects,
  getPersonalProjects,
} from "../supabase/cloudProjects";

export interface TrackingState {
  isRecording: boolean;
  isPaused: boolean;
  /** Paused by idle/lock/sleep rather than by the user */
  autoPaused: boolean;
  isIncognito: boolean;
  /** Active seconds of the current session when this state was taken */
  activeSeconds: number;
  /** Wall-clock start of the current session (ISO), or null */
  startedAt: string | null;
  /**
   * Project the current (or next) session belongs to. Chosen before Start
   * and kept for the following sessions; the Stop dialog preselects it.
   */
  projectId: string | null;
  /**
   * "manual": the user picked projectId for this session, so detection
   * leaves it alone until the session ends. "auto": restored or detected,
   * and the detected repo's project may replace it before Start.
   */
  projectSource: ProjectSource;
  /** Repo of the focused editor/terminal (last seen), detected locally */
  detectedRepo: DetectedRepo | null;
  /** Active / Supervising (no input, agent working) / Away; also outside sessions */
  activity: Activity;
  /** Supervising seconds of the current session (part of activeSeconds) */
  supervisingSeconds: number;
  /** Its [start, end] ISO pairs; an open span ends when the state was taken */
  supervisingSpans: [string, string][];
  /** Last time an AI agent wrote to its transcript (ISO), or null */
  agentActiveAt: string | null;
}

export type { ProjectSource };

/** Sessions shorter than this (active seconds) are not saved. */
const MIN_SESSION_SECONDS = 10;
/** How long Stop waits for the session-info modal before auto-saving. */
const SESSION_INFO_TIMEOUT_MS = 10 * 60 * 1000;
/** How often buffered usage ticks are written to Supabase. */
const FLUSH_INTERVAL_MS = 60 * 1000;
const IDLE_POLL_MS = 2000;
/** How often the focused window's repo is detected (also outside sessions). */
const DETECT_MS = 5000;
/** How often agent transcripts are checked for activity. */
const HEARTBEAT_MS = 15_000;

// ── State ────────────────────────────────────────────────────────────

const clock = new SessionClock();
let getWindow: () => BrowserWindow | null = () => null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let intervalSeconds = DEFAULT_TRACKING_INTERVAL_SECONDS;
let idleTimeoutSeconds = DEFAULT_IDLE_TIMEOUT_SECONDS;
let isIncognito = false;
let selectedProjectId: string | null = null;
let projectSource: ProjectSource = "auto";
let activity: Activity = "active";
const attribution = new ProjectAttribution();
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
  return {
    ...clock.state,
    isIncognito,
    activeSeconds: clock.activeSeconds(new Date()),
    startedAt: clock.startedAt?.toISOString() ?? null,
    projectId: selectedProjectId,
    projectSource,
    detectedRepo: attribution.describe(),
    activity,
    supervisingSeconds: clock.supervisingSeconds(new Date()),
    supervisingSpans: clock.supervisingSpans(new Date()),
    agentActiveAt: agentActiveAt(),
  };
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
  // Projects belong to a user; the renderer restores the user's last one
  selectedProjectId = null;
  projectSource = "auto";
  attribution.reset();
  if (userId) {
    loadUserLangMapFromDisk(userId);
    void loadTrackingPreferences(userId);
    void reloadRepoLinks();
  }
}

/**
 * Load the user's repo → project links. Links to archived or deleted
 * projects are ignored, so they are never suggested. Call after linking,
 * unlinking, or archiving/restoring a project.
 */
export async function reloadRepoLinks() {
  const userId = currentUserId;
  if (!userId) return;
  try {
    const [links, orgProjects, personalProjects] = await Promise.all([
      getRepoLinks(userId),
      getOrganizationProjects(userId),
      getPersonalProjects(userId),
    ]);
    if (currentUserId !== userId) return;
    const active = new Set(
      [...orgProjects, ...personalProjects].map((p) => p.id),
    );
    attribution.setLinks(links.filter((l) => active.has(l.project_id)));
    if (!applyDetectedProject()) emitState();
  } catch (err) {
    if (classifyError(err) !== "network") logError("reloadRepoLinks", err);
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

// ── Project detection ────────────────────────────────────────────────

let resolveRepo: ReturnType<typeof createRepoResolver> | null = null;

/** Where editors keep their state (%APPDATA%, ~/Library/Application Support, ~/.config). */
function appDataDir(): string {
  try {
    return app.getPath("appData");
  } catch {
    // getPath can fail, e.g. with an unusual USERPROFILE
    if (process.platform === "win32" && process.env.APPDATA) {
      return process.env.APPDATA;
    }
    if (process.platform === "darwin") {
      return path.join(os.homedir(), "Library", "Application Support");
    }
    return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  }
}

/** Created on first use: app paths aren't needed until detection runs. */
const repoResolver = () =>
  (resolveRepo ??= createRepoResolver({
    fs: {
      readText(p) {
        try {
          return fs.readFileSync(p, "utf-8");
        } catch {
          return null;
        }
      },
      isDir(p) {
        try {
          return fs.statSync(p).isDirectory();
        } catch {
          return false;
        }
      },
      exists: (p) => fs.existsSync(p),
      listDir(p) {
        try {
          return fs.readdirSync(p);
        } catch {
          return [];
        }
      },
    },
    appDataDir: appDataDir(),
    homeDir: os.homedir(),
    platform: process.platform,
  }));

/** The repo of the focused window, or null if it isn't a dev window in one. */
function detectFocusedRepo(userId: string): RepoInfo | null {
  const win = activeWindow();
  const execName = win?.info?.execName?.toLowerCase() || "";
  if (!win || !execName) return null;
  const known = matchApp(execName, userId);
  if (!known) return null;
  return repoResolver()(
    getWorkspaceHint(execName, win.title ?? "", known.category),
  );
}

/**
 * Before Start, switch to the detected repo's project, unless the user
 * picked one. Never while recording: that would move the running session.
 * Returns true if it changed (and broadcast) the project.
 */
function applyDetectedProject(): boolean {
  const projectId = attribution.projectToSelect({
    isRecording: clock.isRecording,
    source: projectSource,
    selected: selectedProjectId,
  });
  if (!projectId) return false;
  selectedProjectId = projectId;
  emitState();
  return true;
}

function detectTick() {
  if (isIncognito || !currentUserId) return;
  let repo: RepoInfo | null = null;
  try {
    repo = detectFocusedRepo(currentUserId);
  } catch (err) {
    logError("detectFocusedRepo", err);
  }
  const changed = attribution.observe(repo);
  if (clock.isRecording && !clock.state.isPaused) {
    attribution.addSessionTime(DETECT_MS / 1000);
  }
  if (changed && !applyDetectedProject()) emitState();
}

export function getDetectedRepo(): RepoInfo | null {
  return attribution.currentRepo();
}

/** Link a repo to a project (or replace its link) for the signed-in user. */
export async function linkRepo(repo: RepoInfo, projectId: string) {
  const uid = currentUserId;
  if (!uid) throw new Error("Not signed in");
  await linkRepoToProject(uid, {
    repo_key: repo.key,
    repo_name: repo.name,
    project_id: projectId,
  });
  attribution.setLink(repo.key, projectId);
  if (!applyDetectedProject()) emitState();
}

// ── Session control ──────────────────────────────────────────────────

/** Accepts a project id from the renderer; anything else means "none". */
function normalizeProjectId(value: unknown): string | null {
  return typeof value === "string" && /^[\w-]{1,64}$/.test(value)
    ? value
    : null;
}

/**
 * Choose the project for the current session, or the next one. A "manual"
 * choice is kept until the session ends; "auto" (e.g. restoring the last
 * project) may be replaced by the detected repo's project.
 */
export function setSessionProject(
  projectId: unknown,
  source: unknown = "manual",
) {
  const next = normalizeProjectId(projectId);
  const nextSource: ProjectSource = source === "auto" ? "auto" : "manual";
  if (next === selectedProjectId && nextSource === projectSource) return;
  selectedProjectId = next;
  projectSource = nextSource;
  if (!applyDetectedProject()) emitState();
}

export function startTracking() {
  if (clock.isRecording) return;
  clock.startAt(new Date());
  attribution.resetSession();
  startTimers();
  emitState();
}

/** `at` may be in the past: an idle pause trims the idle stretch before it. */
export function pauseTracking(automatic = false, at: Date = new Date()) {
  if (!clock.pause(at, automatic)) return;
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
  /** Link the session's repo to the chosen project from now on */
  rememberRepo?: boolean;
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

/**
 * Ask the renderer for title/project/billing of a stopped session. The
 * session's project is preselected, and kept if the prompt times out. `repo`
 * (the repo worked in longest) lets the dialog offer to remember the link.
 */
function askSessionInfo(
  projectId: string | null,
  repo: DetectedRepo | null,
): Promise<SessionInfo> {
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
    const withProject = (info: SessionInfo): SessionInfo =>
      projectId ? { ...info, projectId } : info;
    const timeout = setTimeout(
      () => settleEarly(withProject(TIMED_OUT_SESSION_INFO)),
      SESSION_INFO_TIMEOUT_MS,
    );

    settleSessionInfo = (info) => settleEarly(withProject(info));
    ipcMain.on("session-info-reply", onReply);
    send("get-session-info", { projectId, repo });
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
  const supervising = {
    seconds: session.supervisingSeconds,
    spans: session.supervisingSpans,
  };
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
      supervising,
    );
    // Lets the renderer refresh session-based views
    send("session-saved");
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
        supervising,
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
  const repo = attribution.dominantRepo();
  const projectId = attribution.projectForStoppedSession(
    selectedProjectId,
    projectSource,
  );
  // The user's pick was for this session; the next one may be detected
  projectSource = "auto";
  attribution.resetSession();
  stopTimers();
  void flushTrackedUsage();
  if (!applyDetectedProject()) emitState();
  if (!session || session.duration < MIN_SESSION_SECONDS) return;

  const uid = currentUserId;
  if (!uid) return;

  // A previous stop is still waiting on its prompt — auto-save it first
  settleSessionInfo?.(TIMED_OUT_SESSION_INFO);

  const save = (async () => {
    const info = await askSessionInfo(projectId, attribution.describe(repo));
    // An empty title means the user chose "Discard"
    if (info.title && info.title.trim() !== "") {
      await saveSession(uid, session, info);
    }
    const chosen = normalizeProjectId(info.projectId);
    if (info.rememberRepo === true && repo && chosen && currentUserId === uid) {
      await linkRepo(repo, chosen).catch((err) => logError("linkRepo", err));
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
    const projectId = attribution.projectForStoppedSession(
      selectedProjectId,
      projectSource,
    );
    await saveSession(
      currentUserId,
      session,
      projectId
        ? { ...APP_CLOSED_SESSION_INFO, projectId }
        : APP_CLOSED_SESSION_INFO,
      { queueOnAnyError: true },
    );
  }
}

// ── Agent heartbeat ──────────────────────────────────────────────────

const heartbeat = createAgentHeartbeat({
  fs: {
    async readDir(p) {
      try {
        const entries = await fs.promises.readdir(p, { withFileTypes: true });
        return entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
      } catch {
        return [];
      }
    },
    async mtimeMs(p) {
      try {
        return (await fs.promises.stat(p)).mtimeMs;
      } catch {
        return null;
      }
    },
  },
  claudeDir:
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
  codexDir: process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  platform: process.platform,
});

function agentActiveAt(): string | null {
  const last = heartbeat.lastActivity();
  return last === null ? null : new Date(last).toISOString();
}

async function pollHeartbeat() {
  const before = heartbeat.lastActivity();
  try {
    await heartbeat.poll();
  } catch (err) {
    logError("agentHeartbeat", err);
  }
  if (heartbeat.lastActivity() !== before) pollIdle();
}

// ── Idle / power ─────────────────────────────────────────────────────

const clockTime = (d: Date) =>
  d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function pollIdle() {
  const now = new Date();
  const lastAgent = heartbeat.lastActivity();
  const decision = decideIdleAction({
    idleSeconds: powerMonitor.getSystemIdleTime(),
    idleTimeoutSeconds,
    secondsSinceAgent:
      lastAgent === null
        ? null
        : Math.max(0, (now.getTime() - lastAgent) / 1000),
    ...clock.state,
    screenLocked,
    systemSuspended,
  });
  const { action } = decision;
  const wasSupervising = clock.isSupervising;
  clock.setSupervising(now, decision.activity === "supervising");
  const changed =
    decision.activity !== activity || clock.isSupervising !== wasSupervising;
  activity = decision.activity;

  if (action === "pause") {
    const at = new Date(now.getTime() - (decision.pauseSecondsAgo ?? 0) * 1000);
    pauseTracking(true, at);
    notify(
      `Tracking paused — no activity since ${clockTime(at)}, so the time after that wasn't counted.`,
    );
  } else if (action === "resume") {
    resumeTracking();
    notify("Welcome back — tracking resumed.");
  } else if (changed) {
    emitState();
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
  setInterval(detectTick, DETECT_MS);
  void pollHeartbeat();
  setInterval(() => void pollHeartbeat(), HEARTBEAT_MS);
}

// ── IPC ──────────────────────────────────────────────────────────────

ipcMain.handle("get-tracking-state", () => getTrackingState());
ipcMain.handle("start-tracking", () => {
  startTracking();
  return getTrackingState();
});
ipcMain.handle(
  "set-session-project",
  (_event, projectId: unknown, source?: unknown) => {
    setSessionProject(projectId, source);
    return getTrackingState();
  },
);
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
