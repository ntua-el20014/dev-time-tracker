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
import { execFile } from "child_process";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { activeWindow } from "@miniben90/x-win";
import { matchApp } from "../utils/editors";
import {
  getLanguageDataFromTitle,
  loadUserLangMapFromDisk,
} from "../utils/extractData";
import {
  addSession,
  saveDraftSession,
  type DraftSessionData,
} from "../supabase/timeTracking";
import { addUsageToDailySummary } from "../supabase/usageLogs";
import {
  getIdleTimeout,
  getTrackingInterval,
} from "../supabase/userPreferences";
import { logError, classifyError, withRetry } from "../utils/errorHandler";
import {
  enqueueDraftSession,
  enqueueSession,
  enqueueUsageSummary,
  hasQueuedDraftSession,
} from "../utils/offlineQueue";
import {
  DEFAULT_IDLE_TIMEOUT_SECONDS,
  DEFAULT_TRACKING_INTERVAL_SECONDS,
} from "../../shared/constants";
import { SessionClock, type SessionSnapshot } from "./sessionClock";
import { decideIdleAction, type Activity } from "./idlePolicy";
import { createAgentHeartbeat } from "./agentHeartbeat";
import { LiveAgents, type HookEvent, type LiveStatus } from "./agentLive";
import { createCodeStats, type CodeStatsDeps } from "./codeStats";
import type { RepoCodeStats } from "../../shared/codeStats";
import { addAppUsage, type AppUsageEntry } from "../../shared/appUsage";
import {
  Segmenter,
  type SegmentEvent,
  type SegmentSnapshot,
} from "./segmenter";
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
  /** Last sign of AI agent work (transcript write or hook event, ISO), or null */
  agentActiveAt: string | null;
  /** Claude Code sessions reporting through hooks (Connect Claude Code), latest first */
  liveAgents: LiveAgentSummary[];
  /** Always-on mode (Phase D): activity outside sessions is cut into segments */
  alwaysOn: boolean;
  /** The open always-on segment, or null */
  autoSegment: AutoSegmentSummary | null;
}

export interface AutoSegmentSummary {
  /** ISO */
  startedAt: string;
  activeSeconds: number;
  isPaused: boolean;
  repoKey: string | null;
  /** The repo's linked project, if any */
  projectId: string | null;
}

export interface LiveAgentSummary {
  source: "claude-code";
  status: LiveStatus;
  /** When the status started (ISO) */
  since: string;
  /** Repo of the agent's working directory, else the folder's name */
  repoName: string | null;
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
/** A terminal without a path in its title gets the repo of an agent busy this recently. */
const TERMINAL_AGENT_MS = 10 * 60_000;

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
/** Always-on mode for the signed-in user (per device, off by default) */
let alwaysOn = false;
const segmenter = new Segmenter({
  newId: randomUUID,
  projectOf: (repoKey) => attribution.projectFor(repoKey),
});
/** System away states: never auto-resume while either is set. */
let screenLocked = false;
let systemSuspended = false;
/**
 * Signed-in user, taken from the session the renderer syncs to main. Using
 * it (instead of getCurrentUser(), a network call) keeps ticks offline-safe.
 */
let currentUserId: string | null = null;
const stateListeners = new Set<(state: TrackingState) => void>();

export function send(channel: string, payload?: unknown) {
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
    liveAgents: liveAgentSummaries(),
    alwaysOn,
    autoSegment: autoSegmentSummary(),
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

export function getTrackingUserId(): string | null {
  return currentUserId;
}

/** Called whenever the renderer syncs (or clears) the auth session. */
export function setTrackingUser(userId: string | null) {
  if (userId === currentUserId) return;
  // The open segment belongs to the previous user
  dispatchSegmentEvents(segmenter.end(new Date()), currentUserId);
  segmenter.reset();
  repoNames.clear();
  alwaysOn = false;
  currentUserId = userId;
  // Projects belong to a user; the renderer restores the user's last one
  selectedProjectId = null;
  projectSource = "auto";
  attribution.reset();
  if (userId) {
    loadUserLangMapFromDisk(userId);
    void loadTrackingPreferences(userId);
    void loadAlwaysOn(userId);
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
    for (const listener of repoLinkListeners) listener();
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
      getUrl: () => win.url,
    };
  },
  matchApp,
  getLanguageFromTitle: getLanguageDataFromTitle,
});

const batcher = new UsageBatcher({
  writer: {
    addToSummary: (increment) =>
      withRetry(() => addUsageToDailySummary(increment), {
        maxAttempts: 2,
        retryOn: ["network"],
      }),
  },
  isNetworkError: (err) => classifyError(err) === "network",
  enqueueOffline: (inc) =>
    enqueueUsageSummary({
      userId: inc.userId,
      date: inc.date,
      appName: inc.appName,
      language: inc.language,
      languageExtension: inc.languageExtension,
      category: inc.category,
      iconUrl: inc.icon,
      seconds: inc.seconds,
    }),
  logError,
});

/** Foreground time of the running session (saved with it as app_usage) */
let sessionAppUsage: AppUsageEntry[] = [];

function tick() {
  if (isIncognito || !currentUserId) return;
  try {
    const sample = sampleUsage(currentUserId);
    if (!sample) return;
    const usage = clock.isRecording ? sessionAppUsage : openDraft?.appUsage;
    if (usage) {
      addAppUsage(
        usage,
        { app: sample.appName, language: sample.language, category: sample.category },
        intervalSeconds,
      );
    }
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
  const hint = getWorkspaceHint(execName, win.title ?? "", known.category);
  // A terminal title without a path (e.g. running `claude`): the repo of
  // the Claude Code session that was busy most recently, if hooks are on
  if (!hint && known.name === "Terminal") {
    const cwd = liveAgents.recentCwd(Date.now(), TERMINAL_AGENT_MS);
    return cwd ? resolveRepoForDir(cwd) : null;
  }
  return repoResolver()(hint);
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
    if (repo) codeStats.noteRepo(repo);
  }
  if (repo) repoNames.set(repo.key, repo.name);
  // Also during a manual session: the segment after it starts in this repo
  if (alwaysOn) {
    dispatchSegmentEvents(
      segmenter.observeRepo(new Date(), attribution.currentRepo()?.key ?? null),
    );
  }
  if (repo && openDraft && !segmenter.isPaused) openDraft.code.noteRepo(repo);
  if (changed && !applyDetectedProject()) emitState();
}

export function getDetectedRepo(): RepoInfo | null {
  return attribution.currentRepo();
}

/** The repo containing a folder (e.g. an agent's working directory). */
export function resolveRepoForDir(dir: string): RepoInfo | null {
  return repoResolver()({ kind: "path", path: dir });
}

/** The (active) project a repo is linked to, if any. */
export function linkedProjectFor(repoKey: string): string | null {
  return attribution.projectFor(repoKey);
}

type RepoLinksListener = (link?: { repoKey: string; projectId: string }) => void;
const repoLinkListeners = new Set<RepoLinksListener>();

/**
 * Called when the repo links change: after the user links a repo (with the
 * link), and after the links are (re)loaded (without).
 */
export function onRepoLinksChanged(listener: RepoLinksListener) {
  repoLinkListeners.add(listener);
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
  for (const listener of repoLinkListeners) {
    listener({ repoKey: repo.key, projectId });
  }
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
  const now = new Date();
  // A manual session takes over from always-on
  dispatchSegmentEvents(segmenter.end(now));
  clock.startAt(now);
  attribution.resetSession();
  codeStats.startSession();
  sessionAppUsage = [];
  const repo = attribution.currentRepo();
  if (repo && !isIncognito) codeStats.noteRepo(repo);
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
  codeStatsOfSession: RepoCodeStats[] = [],
  appUsage: AppUsageEntry[] = [],
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
      codeStatsOfSession,
      appUsage,
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
        codeStatsOfSession,
        appUsage,
      );
    } else {
      logError("saveSession", err);
    }
  }
}

/** The stopped session's app usage; the next session starts empty. */
function takeSessionAppUsage(): AppUsageEntry[] {
  const usage = sessionAppUsage;
  sessionAppUsage = [];
  return usage;
}

/**
 * Ends the session, then asks for its details and saves it. The tracker is
 * free immediately, so a new session can start while the prompt is open.
 */
export async function stopTracking() {
  const session = clock.stop(new Date());
  const appUsage = takeSessionAppUsage();
  // git runs while the user fills in the prompt
  const code = session ? collectCodeStats(session) : Promise.resolve([]);
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
      await saveSession(uid, session, info, {}, await code, appUsage);
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
    clock.isRecording ||
    pendingStopSave !== null ||
    batcher.pendingCount > 0 ||
    segmenter.isOpen ||
    draftSaves.size > 0
  );
}

/**
 * Saves everything before quit: settles an open prompt, auto-saves a running
 * or paused session, and flushes buffered usage (offline queue on failure).
 */
export async function finalizeTrackingForQuit() {
  quitting = true;
  dispatchSegmentEvents(segmenter.end(new Date()));
  if (pendingStopSave) {
    settleSessionInfo?.(APP_CLOSED_SESSION_INFO);
    await pendingStopSave;
  }

  const session = clock.stop(new Date());
  stopTimers();
  const appUsage = takeSessionAppUsage();
  const code = session
    ? collectCodeStats(session, QUIT_CODE_STATS_MS)
    : Promise.resolve([]);
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
      await code,
      appUsage,
    );
  }
  await Promise.all([...draftSaves]);
}

// ── Code stats (C2) ──────────────────────────────────────────────────

/** git gets this long per command; a huge or broken repo is skipped. */
const GIT_TIMEOUT_MS = 15_000;
/** Collecting stats on Stop gives up after this long (on quit, sooner). */
const CODE_STATS_MS = 60_000;
const QUIT_CODE_STATS_MS = 5_000;
/** New files larger than this aren't counted line by line. */
const MAX_COUNT_BYTES = 1024 * 1024;

const codeStatsDeps: CodeStatsDeps = {
  git: (cwd, args) =>
    new Promise((resolve) => {
      execFile(
        "git",
        args,
        { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
        (err, stdout) => resolve(err ? null : stdout),
      );
    }),
  async mtimeMs(root, file) {
    try {
      return (await fs.promises.stat(path.join(root, file))).mtimeMs;
    } catch {
      return null;
    }
  },
  async countLines(root, file) {
    try {
      const full = path.join(root, file);
      if ((await fs.promises.stat(full)).size > MAX_COUNT_BYTES) return null;
      const buf = await fs.promises.readFile(full);
      if (buf.subarray(0, 8000).includes(0)) return null; // binary
      if (buf.length === 0) return 0;
      let lines = 0;
      for (const byte of buf) if (byte === 0x0a) lines++;
      return buf[buf.length - 1] === 0x0a ? lines : lines + 1;
    } catch {
      return null;
    }
  },
  languageOf: (file) =>
    getLanguageDataFromTitle(path.basename(file))?.language ?? null,
};
/** The manual session's; each always-on segment has its own */
const codeStats = createCodeStats(codeStatsDeps);

/** Where agents worked during a session, from their transcripts (agents.ts). */
let agentDirsBetween: (start: number, end: number) => Promise<string[]> =
  async () => [];
export function setAgentDirsProvider(
  provider: (start: number, end: number) => Promise<string[]>,
) {
  agentDirsBetween = provider;
}

/**
 * What the session produced: repos focused during it, plus repos AI agents
 * worked in meanwhile (transcripts and live hooks). Never fails; gives up
 * after `limitMs` with no stats.
 */
async function collectCodeStats(
  session: { start: Date; end: Date },
  limitMs = CODE_STATS_MS,
  stats = codeStats,
): Promise<RepoCodeStats[]> {
  const start = session.start.getTime();
  const end = session.end.getTime();
  const work = (async () => {
    const dirs = new Set(await agentDirsBetween(start, end).catch(() => []));
    for (const a of liveAgents.view(end)) {
      if (a.cwd && Date.parse(a.lastActivityAt) >= start) dirs.add(a.cwd);
    }
    const extra: RepoInfo[] = [];
    for (const dir of dirs) {
      const repo = resolveRepoForDir(dir);
      if (repo) extra.push(repo);
    }
    return stats.finish(start, end, extra);
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<RepoCodeStats[]>((resolve) => {
    timer = setTimeout(() => resolve([]), limitMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } catch (err) {
    logError("collectCodeStats", err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ── Agent heartbeat ──────────────────────────────────────────────────

/** Claude Code's config folder (~/.claude, or CLAUDE_CONFIG_DIR). */
export const CLAUDE_DIR =
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");

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
  claudeDir: CLAUDE_DIR,
  codexDir: process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  platform: process.platform,
});

/** Agent session transcripts the heartbeat knows about. */
export function getAgentTranscripts() {
  return heartbeat.transcripts();
}

/** Claude Code sessions as reported by its hooks (claudeHooks.ts). */
const liveAgents = new LiveAgents();
let liveAgentsShown = "";

/** Last sign of agent work: a transcript write or a hook event (ms). */
function lastAgentActivity(now: number): number | null {
  const a = heartbeat.lastActivity();
  const b = liveAgents.heartbeatMs(now);
  if (a === null) return b;
  return b === null ? a : Math.max(a, b);
}

function agentActiveAt(): string | null {
  const last = lastAgentActivity(Date.now());
  return last === null ? null : new Date(last).toISOString();
}

function liveAgentSummaries(): LiveAgentSummary[] {
  return liveAgents.view(Date.now()).map((s) => ({
    source: s.source,
    status: s.status,
    since: s.since,
    repoName: s.cwd
      ? (resolveRepoForDir(s.cwd)?.name ?? path.basename(s.cwd))
      : null,
  }));
}

/** Broadcast if the shown agents changed on their own (gone stale or old). */
function refreshLiveAgents() {
  const now = Date.now();
  liveAgents.prune(now);
  const shown = liveAgents
    .view(now)
    .map((s) => `${s.sessionId}:${s.status}`)
    .join();
  if (shown !== liveAgentsShown) {
    liveAgentsShown = shown;
    emitState();
  }
}

/** A Claude Code hook event arrived (already reduced to metadata). */
export function applyAgentHookEvent(event: HookEvent) {
  liveAgents.apply(event);
  const stats = clock.isRecording ? codeStats : openDraft?.code;
  if (event.cwd && stats && !isIncognito) {
    const repo = resolveRepoForDir(event.cwd);
    if (repo) stats.noteRepo(repo);
  }
  refreshLiveAgents();
  pollIdle();
}

/** Hooks were disconnected: forget the live sessions. */
export function clearLiveAgents() {
  liveAgents.clear();
  refreshLiveAgents();
}

export function getLiveAgentStats() {
  return liveAgents.stats();
}

async function pollHeartbeat() {
  const before = heartbeat.lastActivity();
  try {
    await heartbeat.poll();
  } catch (err) {
    logError("agentHeartbeat", err);
  }
  refreshLiveAgents();
  if (heartbeat.lastActivity() !== before) pollIdle();
}

// ── Always-on segments (Phase D) ─────────────────────────────────────

/** Segments are cut only outside manual sessions, while enabled and signed in. */
const segmentsWanted = () =>
  alwaysOn && currentUserId !== null && !clock.isRecording;

type SegmentListener = (event: SegmentEvent, userId: string) => void;
const segmentListeners = new Set<SegmentListener>();

/** Segments opening and closing (with the user they belong to). */
export function onSegmentEvent(listener: SegmentListener) {
  segmentListeners.add(listener);
}

function dispatchSegmentEvents(
  events: SegmentEvent[],
  userId: string | null = currentUserId,
) {
  if (events.length === 0) return;
  if (userId) {
    for (const event of events) {
      handleDraft(event, userId);
      for (const listener of segmentListeners) {
        try {
          listener(event, userId);
        } catch (err) {
          logError("segmentListener", err);
        }
      }
    }
  }
  syncSegmentTimers();
  emitState();
}

function observeSegmentActivity(
  now: Date,
  idleSeconds: number,
  secondsSinceAgent: number | null,
) {
  if (!segmentsWanted()) return;
  const wasPaused = segmenter.isPaused;
  const events = segmenter.observeActivity({
    now,
    idleSeconds,
    idleTimeoutSeconds,
    secondsSinceAgent,
    screenLocked,
    systemSuspended,
  });
  if (events.length > 0) dispatchSegmentEvents(events);
  else if (segmenter.isPaused !== wasPaused) {
    syncSegmentTimers();
    emitState();
  }
}

/** Outside a session, usage is sampled while a segment runs. */
function syncSegmentTimers() {
  if (clock.isRecording) return; // the session owns the timers
  if (segmenter.isOpen && !segmenter.isPaused) startTimers();
  else if (tickTimer) {
    stopTimers();
    void flushTrackedUsage();
  }
}

// ── Drafts (D2) ──────────────────────────────────────────────────────

/** Shorter segments aren't saved (e.g. a stray mouse move at night). */
const MIN_SEGMENT_SECONDS = 120;
/** How often the open segment's draft is saved while it grows. */
const DRAFT_SAVE_MS = 5 * 60_000;

interface OpenDraft {
  clientId: string;
  userId: string;
  /** Foreground time while the segment ran (saved as app_usage) */
  appUsage: AppUsageEntry[];
  /** Repos worked in during the segment, for its code stats at the end */
  code: ReturnType<typeof createCodeStats>;
  /** Saved (or queued) at least once: then it's kept even if a split shortens it */
  saved: boolean;
  /** Saves of one draft run one after another (update-or-insert isn't atomic) */
  chain: Promise<void>;
}

let openDraft: OpenDraft | null = null;
/** Saves not finished yet; quit waits for them */
const draftSaves = new Set<Promise<void>>();
/** Repo names by key, for draft titles */
const repoNames = new Map<string, string>();
let quitting = false;

function handleDraft(event: SegmentEvent, userId: string) {
  if (event.type === "opened") {
    openDraft = {
      clientId: event.clientId,
      userId,
      appUsage: [],
      code: createCodeStats(codeStatsDeps),
      saved: false,
      chain: Promise.resolve(),
    };
    const repo = attribution.currentRepo();
    if (repo && !isIncognito) openDraft.code.noteRepo(repo);
    return;
  }
  const draft = openDraft;
  if (!draft || draft.clientId !== event.segment.clientId) return;
  openDraft = null;
  if (event.segment.duration < MIN_SEGMENT_SECONDS && !draft.saved) return;
  // Taken now: links and names may be gone (sign-out) by the time git is done
  const data = draftData(draft, event.segment);
  const segment = event.segment;
  const limit = quitting ? QUIT_CODE_STATS_MS : CODE_STATS_MS;
  queueDraftSave(draft, async () => ({
    ...data,
    codeStats: await collectCodeStats(segment, limit, draft.code),
  }));
}

function draftData(draft: OpenDraft, segment: SegmentSnapshot): DraftSessionData {
  return {
    clientId: draft.clientId,
    startTime: segment.start.toISOString(),
    endTime: segment.end.toISOString(),
    duration: segment.duration,
    title: segment.repoKey ? (repoNames.get(segment.repoKey) ?? null) : null,
    projectId: segment.repoKey ? attribution.projectFor(segment.repoKey) : null,
    supervising: {
      seconds: segment.supervisingSeconds,
      spans: segment.supervisingSpans,
    },
    appUsage: draft.appUsage.map((entry) => ({ ...entry })),
  };
}

/** Save the open segment as it is now (it keeps growing). */
function saveGrowingDraft() {
  const draft = openDraft;
  const segment = segmenter.current(new Date());
  if (!draft || !segment || segment.duration < MIN_SEGMENT_SECONDS) return;
  const data = draftData(draft, segment);
  queueDraftSave(draft, async () => data);
}

function queueDraftSave(
  draft: OpenDraft,
  build: () => Promise<DraftSessionData>,
) {
  draft.saved = true;
  const save = draft.chain.then(async () => {
    const data = await build();
    await writeDraft(draft.userId, data, quitting);
  });
  draft.chain = save.catch(() => undefined);
  const tracked = save.catch((err) => logError("saveDraft", err));
  draftSaves.add(tracked);
  void tracked.finally(() => draftSaves.delete(tracked));
}

async function writeDraft(
  userId: string,
  data: DraftSessionData,
  queueOnAnyError: boolean,
) {
  // An older version is waiting offline: queue behind it, never overtake it
  if (hasQueuedDraftSession(userId, data.clientId)) {
    enqueueDraftSession(userId, data);
    return;
  }
  try {
    await saveDraftSession(userId, data);
  } catch (err) {
    const kind = classifyError(err);
    // "auth": e.g. the segment ended because the user signed out
    if (queueOnAnyError || kind === "network" || kind === "auth") {
      enqueueDraftSession(userId, data);
    } else {
      logError("saveDraftSession", err);
    }
  }
}

function autoSegmentSummary(): AutoSegmentSummary | null {
  const segment = segmenter.current(new Date());
  if (!segment) return null;
  return {
    startedAt: segment.start.toISOString(),
    activeSeconds: segment.duration,
    isPaused: segment.isPaused,
    repoKey: segment.repoKey,
    projectId: segment.repoKey ? attribution.projectFor(segment.repoKey) : null,
  };
}

const trackingSettingsFile = (uid: string) =>
  path.join(app.getPath("userData"), `tracking-${uid}.json`);

async function readTrackingSettings(
  uid: string,
): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.promises.readFile(trackingSettingsFile(uid), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function loadAlwaysOn(uid: string) {
  const settings = await readTrackingSettings(uid);
  if (currentUserId !== uid) return;
  alwaysOn = settings.alwaysOn === true;
  emitState();
}

export function isAlwaysOn(): boolean {
  return alwaysOn;
}

/** Turn always-on mode on or off for the signed-in user (kept on this device). */
export async function setAlwaysOn(enabled: boolean) {
  const uid = currentUserId;
  if (!uid) throw new Error("Not signed in");
  if (!enabled) dispatchSegmentEvents(segmenter.end(new Date()));
  alwaysOn = enabled;
  emitState();
  const file = trackingSettingsFile(uid);
  const settings = await readTrackingSettings(uid);
  const tmp = `${file}.tmp`;
  await fs.promises.writeFile(
    tmp,
    JSON.stringify({ ...settings, alwaysOn: enabled }),
    "utf-8",
  );
  await fs.promises.rename(tmp, file);
}

// ── Idle / power ─────────────────────────────────────────────────────

const clockTime = (d: Date) =>
  d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function pollIdle() {
  const now = new Date();
  const lastAgent = lastAgentActivity(now.getTime());
  const idleSeconds = powerMonitor.getSystemIdleTime();
  const secondsSinceAgent =
    lastAgent === null ? null : Math.max(0, (now.getTime() - lastAgent) / 1000);
  observeSegmentActivity(now, idleSeconds, secondsSinceAgent);
  const decision = decideIdleAction({
    idleSeconds,
    idleTimeoutSeconds,
    secondsSinceAgent,
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
    pollIdle(); // pauses an always-on segment
  });
  powerMonitor.on("unlock-screen", () => {
    screenLocked = false;
  });
  powerMonitor.on("suspend", () => {
    systemSuspended = true;
    pauseTracking(true);
    pollIdle();
  });
  powerMonitor.on("resume", () => {
    systemSuspended = false;
  });

  setInterval(pollIdle, IDLE_POLL_MS);
  setInterval(saveGrowingDraft, DRAFT_SAVE_MS);
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
ipcMain.handle("get-always-on", () => isAlwaysOn());
ipcMain.handle("set-always-on", async (_event, enabled: unknown) => {
  await setAlwaysOn(enabled === true);
  return isAlwaysOn();
});
ipcMain.handle("get-incognito-status", () => isIncognito);
