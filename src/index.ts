import {
  app,
  BrowserWindow,
  ipcMain,
  powerMonitor,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  type IpcMainEvent,
} from "electron";
import { activeWindow } from "@miniben90/x-win";
import os from "os";
import path from "path";
import "./utils/langMap";
import { matchApp } from "./utils/editors";
import {
  getLanguageDataFromTitle,
  loadUserLangMapFromDisk,
} from "./utils/extractData";
import { getIdleTimeoutSeconds } from "./utils/ipcHelp";
import { toLocalDateString } from "./utils/timeFormat";
import { logUsage } from "./supabase/usageLogs";
import { addSession } from "./supabase/timeTracking";
import {
  getUpcomingSessionNotifications,
  markNotificationSent,
} from "./supabase/scheduledSessions";
import { getCurrentUser } from "./supabase/api";
import { supabase } from "./supabase/config";
import { SUPABASE_CONFIG } from "./supabase/env";
import { logError, withRetry, classifyError } from "./utils/errorHandler";
import {
  initOfflineQueue,
  destroyOfflineQueue,
  enqueueUsageLog,
  enqueueSession,
  flush as flushOfflineQueue,
  getSyncStatus,
} from "./utils/offlineQueue";
import "./ipc/sessionHandlers";
import "./ipc/usageHandlers";
import "./ipc/tagHandlers";
import "./ipc/goalHandlers";
import "./ipc/scheduledSessionHandlers";
import "./ipc/preferencesHandlers";
import "./ipc/projectHandlers";
import "./ipc/userHandlers";
import "./ipc/organizationHandlers";
import "./ipc/analyticsHandlers";
import "./ipc/exportHandlers";
import "./ipc/standupHandlers";
import "./ipc/billableHoursHandlers";
import "./ipc/invoiceHandlers";
// @ts-ignore TS: editor/tsserver may not always resolve this side-effect handler path
import "./ipc/updaterHandlers";
import { DEFAULT_TRACKING_INTERVAL_SECONDS } from "../shared/constants";
import { initSentryMain, reportError } from "./sentryMain";
// @ts-ignore TS: editor/tsserver may not always resolve this module; runtime implementation exists
import { initUpdater, setUpdaterStateSink } from "./updater";

// ── Initialize error logging ──────────────────────────────────────
// Must be called early before any other Sentry calls
initSentryMain();

// ── Process-level error handlers ──────────────────────────────────
// Catch truly unhandled errors so the app doesn't crash silently.
// Network/fetch errors are expected when offline — log only a short line.
process.on("uncaughtException", (error) => {
  if (classifyError(error) === "network") {
    // eslint-disable-next-line no-console
    console.error(
      `[${new Date().toISOString()}] [NETWORK] uncaughtException: ${error.message}`,
    );
  } else {
    logError("uncaughtException", error);
    reportError(error, { type: "uncaughtException" });
  }
});

process.on("unhandledRejection", (reason) => {
  if (classifyError(reason) === "network") {
    const msg = reason instanceof Error ? reason.message : String(reason);
    // eslint-disable-next-line no-console
    console.error(
      `[${new Date().toISOString()}] [NETWORK] unhandledRejection: ${msg}`,
    );
  } else {
    logError("unhandledRejection", reason);
    const error = reason instanceof Error ? reason : new Error(String(reason));
    reportError(error, { type: "unhandledRejection" });
  }
});

// Sync auth session from renderer to main process
// The renderer has localStorage and holds the Supabase session;
// the main process needs the tokens to make authenticated API calls.
ipcMain.handle(
  "sync-auth-session",
  async (
    _event,
    tokens: { access_token: string; refresh_token: string } | null,
  ) => {
    if (tokens) {
      const { error } = await supabase.auth.setSession({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      });
      if (error) {
        return false;
      }
      return true;
    } else {
      // Sign out in main process
      await supabase.auth.signOut();
      return true;
    }
  },
);

let mainWindow: BrowserWindow;
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
let intervalSeconds = DEFAULT_TRACKING_INTERVAL_SECONDS;
let trackingInterval: ReturnType<typeof setInterval> | null = null;
let sessionStart: Date | null = null;
let sessionActiveDuration = 0; // in seconds
let lastActiveTimestamp: Date | null = null;
let isPaused = false;
/** True when the current pause came from idle/lock/sleep, not the user. */
let autoPaused = false;
/** System away states: never auto-resume while either is set. */
let screenLocked = false;
let systemSuspended = false;
let isIncognito = false;
let tray: Tray | null = null;

/** Idle time (s) below which an auto-paused session resumes on its own. */
const AUTO_RESUME_IDLE_SECONDS = 5;
/** How long Stop waits for the session-info modal before auto-saving. */
const SESSION_INFO_TIMEOUT_MS = 10 * 60 * 1000;
/** Global incognito toggle. Avoids Ctrl+Shift+I (DevTools / editor chat). */
const INCOGNITO_SHORTCUT = "CommandOrControl+Alt+Shift+I";
/** Cached user ID so tracking can continue when the network is down. */
let cachedUserId: string | null = null;
let idleTimeoutSeconds = getIdleTimeoutSeconds(); // Default, updated when user logs in

// Register custom protocol handler for OAuth
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("dev-time-tracker", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient("dev-time-tracker");
}

app.whenReady().then(() => {
  createWindow();

  setUpdaterStateSink((state: import("../shared/types").UpdaterState) => {
    mainWindow?.webContents.send("updater:state-changed", state);
  });
  void initUpdater();

  // Handle OAuth callback URL if app was launched via protocol URL (Windows)
  if (process.platform === "win32") {
    const url = process.argv.find((arg) =>
      arg.startsWith("dev-time-tracker://"),
    );
    if (url) {
      // Wait a bit for window to be ready
      setTimeout(() => {
        handleOAuthCallback(url);
      }, 1000);
    }
  }

  // Note: User initialization is handled by Supabase auth

  // Initialise the offline write queue (loads any persisted items from disk)
  initOfflineQueue();

  // Pause when the user is away (lock / sleep); resume happens via the idle
  // poll below once they are back and active.
  const pauseForAway = () => {
    if (!isPaused && trackingInterval) {
      ipcMain.emit("auto-pause");
      mainWindow?.webContents.send("auto-paused");
    }
  };
  powerMonitor.on("lock-screen", () => {
    screenLocked = true;
    pauseForAway();
  });
  powerMonitor.on("unlock-screen", () => {
    screenLocked = false;
  });
  powerMonitor.on("suspend", () => {
    systemSuspended = true;
    pauseForAway();
  });
  powerMonitor.on("resume", () => {
    systemSuspended = false;
  });

  // Poll for idle time every 2 seconds
  setInterval(() => {
    const idleSeconds = powerMonitor.getSystemIdleTime();
    if (idleSeconds >= idleTimeoutSeconds) {
      if (!isPaused && trackingInterval) {
        ipcMain.emit("auto-pause");
        mainWindow?.webContents.send("auto-paused");
        if (!isIncognito) {
          mainWindow?.webContents.send("notify", {
            message: `Tracking paused due to inactivity (${(
              idleTimeoutSeconds / 60
            ).toFixed(1)} minutes idle).`,
          });
        }
      }
    } else if (
      autoPaused &&
      isPaused &&
      sessionStart &&
      !screenLocked &&
      !systemSuspended &&
      idleSeconds < AUTO_RESUME_IDLE_SECONDS
    ) {
      // User is back: resume a session that was paused automatically.
      // Manual pauses are never resumed automatically.
      ipcMain.emit("auto-resume");
      mainWindow?.webContents.send("auto-resumed");
      if (!isIncognito) {
        mainWindow?.webContents.send("notify", {
          message: "Welcome back — tracking resumed.",
        });
      }
    }
  }, 2000);

  // Note: User creation is handled by Supabase auth signup

  // Check for scheduled session notifications every minute for real-time notifications
  setInterval(() => {
    checkScheduledSessionNotifications();
  }, 60 * 1000); // Every minute

  // ── System tray ──────────────────────────────────────────────────
  createTray();

  // ── Global shortcut: toggles incognito ───────────────────────────
  const registered = globalShortcut.register(INCOGNITO_SHORTCUT, () => {
    isIncognito = !isIncognito;
    mainWindow?.webContents.send("incognito-toggled", isIncognito);
    updateTrayMenu();
  });
  if (!registered) {
    logError(
      "globalShortcut",
      new Error(`${INCOGNITO_SHORTCUT} is already taken by another app`),
    );
  }
});

/** Cache process icons by exec name — icons don't change at runtime. */
const iconCache = new Map<string, string>();

/**
 * Summary rows (user/day/app/language) that already received their icon in
 * this run. The icon is a data URL of several KB, so it is sent once per row
 * rather than on every tick; the DB keeps the existing icon when sent null.
 */
const iconSentKeys = new Set<string>();
let iconSentDay = "";

function iconForSummary(
  uid: string,
  day: string,
  appName: string,
  language: string | null,
  icon: string,
): { icon: string | null; key: string } {
  if (day !== iconSentDay) {
    iconSentKeys.clear();
    iconSentDay = day;
  }
  const key = `${uid}|${day}|${appName}|${language ?? ""}`;
  return { icon: iconSentKeys.has(key) || !icon ? null : icon, key };
}

async function trackActiveWindow() {
  // Skip logging when incognito mode is active
  if (isIncognito) return;

  try {
    // Try to get the authenticated user; fall back to cached ID when offline
    let userId: string | null = null;
    try {
      const user = await getCurrentUser();
      if (user) {
        userId = user.id;
        // Reload user's custom language map when user changes
        if (cachedUserId !== user.id) {
          loadUserLangMapFromDisk(user.id);
        }
        cachedUserId = user.id; // keep cache fresh
      }
    } catch {
      userId = cachedUserId; // network may be down — use last known ID
    }
    if (!userId) return;

    // At this point userId is guaranteed non-null
    const uid = userId;

    const window = activeWindow(); // Synchronous
    const execName = window?.info?.execName?.toLowerCase() || "";
    const title = window?.title || "";

    if (!execName) return;

    // Look up cached icon or fetch + cache it
    let icon = iconCache.get(execName);
    if (icon === undefined) {
      try {
        icon = window.getIcon().data;
      } catch {
        icon = "";
      }
      iconCache.set(execName, icon);
    }

    // Match the executable against known apps (editors, dev tools, browsers)
    const appMatch = matchApp(execName, uid);

    // Determine the display name for the app
    let appName: string;
    if (appMatch) {
      appName = appMatch.name;
    } else {
      // Unrecognized app — skip tracking entirely.
      // Only editors, dev tools, and browsers are tracked.
      return;
    }

    // Extract language info from the window title (useful for editors & terminals)
    const langData = getLanguageDataFromTitle(title);
    const language =
      langData?.language || (appMatch.category === "editor" ? "Unknown" : null);
    const langExt = langData?.extension || null;

    // Pass langExt to logUsage (Supabase version)
    const logTimestamp = new Date().toISOString();
    const summaryIcon = iconForSummary(
      uid,
      toLocalDateString(logTimestamp),
      appName,
      language,
      icon,
    );
    try {
      await withRetry(
        () =>
          logUsage(
            uid,
            appName,
            title,
            language,
            langExt,
            summaryIcon.icon,
            intervalSeconds,
            logTimestamp,
          ),
        { maxAttempts: 2, retryOn: ["network"] },
      );
      iconSentKeys.add(summaryIcon.key);
    } catch (retryErr) {
      // All retries exhausted — queue locally so data is never lost
      if (classifyError(retryErr) === "network") {
        enqueueUsageLog(
          uid,
          appName,
          title,
          language,
          langExt,
          summaryIcon.icon,
          intervalSeconds,
          logTimestamp,
        );
        iconSentKeys.add(summaryIcon.key); // the queue will deliver it
      } else {
        // Non-network error — log and move on
        logError("trackActiveWindow (non-network)", retryErr);
      }
    }

    mainWindow?.webContents.send("window-tracked");
  } catch (err) {
    logError("trackActiveWindow", err);
  }
}

async function checkScheduledSessionNotifications() {
  try {
    // Skip entirely when offline — no point hammering the network
    const user = await getCurrentUser().catch(() => null);
    if (!user) return;

    const notifications = await getUpcomingSessionNotifications(user.id);

    for (const notification of notifications) {
      let message = "";
      let title = "";

      switch (notification.type) {
        case "day_before":
          title = "Scheduled Session Tomorrow";
          message = `Don't forget: "${notification.title}" is scheduled for tomorrow`;
          if (notification.estimated_duration_minutes) {
            message += ` (${notification.estimated_duration_minutes} minutes)`;
          }
          break;
        case "same_day": {
          title = "Session Today";
          message = `Reminder: "${notification.title}" is scheduled for today`;
          const sessionTime = new Date(notification.scheduled_datetime);
          message += ` at ${sessionTime.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}`;
          break;
        }
        case "time_to_start":
          title = "Time to Start Session";
          message = `It's time to start: "${notification.title}"`;
          break;
      } // Send notification to renderer
      mainWindow?.webContents.send("scheduled-session-notification", {
        title,
        message,
        sessionId: notification.id,
        type: notification.type,
      });

      // For "time to start" notifications, bring the window to front
      if (notification.type === "time_to_start" && mainWindow) {
        // Show the window if it's minimized or hidden
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }

        // Bring the window to front and focus it
        mainWindow.show();
        mainWindow.focus();

        // On Windows, you might need to use setAlwaysOnTop temporarily
        if (process.platform === "win32") {
          mainWindow.setAlwaysOnTop(true);
          mainWindow.setAlwaysOnTop(false);
        }
      }

      // Mark notification as sent for all notification types to prevent duplicates
      try {
        await markNotificationSent(notification.id);
      } catch (markErr) {
        logError("markNotificationSent", markErr);
        // Continue to next notification even if marking fails
      }
    }
  } catch (err) {
    // Silently skip network errors — no need to spam the log every 60s
    if (classifyError(err) !== "network") {
      logError("checkScheduledSessionNotifications", err);
    }
  }
}

// ── System Tray helpers ──────────────────────────────────────────────
function createTray() {
  // Create a 16x16 simple tray icon using nativeImage
  const trayIcon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA" +
      "RklEQVQ4y2NkYPj/n4EBCJgYKASMDCSCUQ1DM4CBkeH/fxA4D8RqhBSfB2I1IL4A" +
      "xGcZGRl2MDIynAdKnAfi80B8AYgBG7ARCX6u/HQAAAAASUVORK5CYII=",
  );
  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
  tray.setToolTip("Dev Time Tracker");
  updateTrayMenu();

  tray.on("click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

/**
 * Tray recording commands go through the renderer's record/pause buttons so
 * the UI and the session-info modal stay in sync with the main process.
 */
function sendTrayCommand(command: "toggle-recording" | "toggle-pause") {
  if (!mainWindow) return;
  // Stopping opens the session-info modal, so make sure it's visible
  if (command === "toggle-recording" && sessionStart) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  mainWindow.webContents.send("tray-command", command);
}

function updateTrayMenu() {
  if (!tray) return;
  const isRecording = sessionStart !== null;
  const contextMenu = Menu.buildFromTemplate([
    {
      label: isRecording ? "Stop Tracking" : "Start Tracking",
      click: () => sendTrayCommand("toggle-recording"),
    },
    {
      label: isPaused ? "Resume" : "Pause",
      enabled: isRecording,
      click: () => sendTrayCommand("toggle-pause"),
    },
    { type: "separator" },
    {
      label: isIncognito ? "✔ Incognito Mode" : "  Incognito Mode",
      click: () => {
        isIncognito = !isIncognito;
        mainWindow?.webContents.send("incognito-toggled", isIncognito);
        updateTrayMenu();
      },
    },
    { type: "separator" },
    {
      label: "Show Window",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(contextMenu);
  tray.setToolTip(
    isIncognito ? "Dev Time Tracker (Incognito)" : "Dev Time Tracker",
  );
}

/**
 * CSP for the renderer, built from the configured Supabase URL so a custom
 * SUPABASE_URL works. public/index.html carries a matching <meta> CSP (needed
 * for the packaged file:// page) that allows any *.supabase.co project; a
 * self-hosted Supabase on another domain must be added there as well.
 */
function buildContentSecurityPolicy(): string {
  let supabaseOrigin = "";
  try {
    supabaseOrigin = new URL(SUPABASE_CONFIG.URL).origin;
  } catch {
    // Invalid URL — the *.supabase.co wildcard below still applies
  }
  const connectSrc = [
    "'self'",
    "https://*.supabase.co",
    supabaseOrigin,
    "http://localhost:3000",
  ].filter((src, i, all) => src && all.indexOf(src) === i);

  return (
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-eval' http://localhost:3000; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; " +
    `connect-src ${connectSrc.join(" ")};`
  );
}

const CONTENT_SECURITY_POLICY = buildContentSecurityPolicy();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1150,
    height: 800,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: true, // Re-enable web security to allow CSP
    },
  });

  // Remove the default application menu (File/View/Help) for a cleaner window
  try {
    Menu.setApplicationMenu(null);
    // Also hide the menu bar on Windows/Linux so Alt doesn't reveal it
    mainWindow.setMenuBarVisibility(false);
    mainWindow.setAutoHideMenuBar(true);
  } catch (e) {
    // Ignore if Menu APIs aren't available in some environments
  }

  // Set CSP via session headers (more reliable than meta tag in Electron)
  mainWindow.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [CONTENT_SECURITY_POLICY],
        },
      });
    },
  );

  // Open DevTools in development mode
  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.send("os-info", { os: os.platform() });
  });

  // Check for notifications when window gains focus
  mainWindow.on("focus", () => {
    checkScheduledSessionNotifications();
  });

  // Check for notifications when window is shown (e.g., from minimized state)
  mainWindow.on("show", () => {
    checkScheduledSessionNotifications();
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
}

// ── Session state helpers ────────────────────────────────────────────

function startTickInterval() {
  if (!trackingInterval) {
    trackingInterval = setInterval(
      () => trackActiveWindow(),
      intervalSeconds * 1000,
    );
  }
}

function stopTickInterval() {
  if (trackingInterval) {
    clearInterval(trackingInterval);
    trackingInterval = null;
  }
}

/** Active (unpaused) seconds of the current session up to `now`. */
function currentActiveDuration(now = new Date()): number {
  let duration = sessionActiveDuration;
  if (!isPaused && lastActiveTimestamp) {
    duration += Math.round(
      (now.getTime() - lastActiveTimestamp.getTime()) / 1000,
    );
  }
  return duration;
}

function resetSessionState() {
  stopTickInterval();
  sessionStart = null;
  sessionActiveDuration = 0;
  lastActiveTimestamp = null;
  isPaused = false;
  autoPaused = false;
  updateTrayMenu();
}

/** Resolve the user, falling back to the cached ID when offline. */
async function resolveUserId(): Promise<string | null> {
  try {
    const user = await getCurrentUser();
    if (user) cachedUserId = user.id;
    return user?.id ?? null;
  } catch {
    return cachedUserId;
  }
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
    const onReply = (_event: IpcMainEvent, data: SessionInfo) =>
      finish(data);
    // Closing the renderer's modal is what tells the user it was auto-saved
    const settleEarly = (info: SessionInfo) => {
      mainWindow?.webContents.send("session-info-timeout");
      finish(info);
    };
    const timeout = setTimeout(
      () => settleEarly(TIMED_OUT_SESSION_INFO),
      SESSION_INFO_TIMEOUT_MS,
    );

    settleSessionInfo = settleEarly;
    ipcMain.on("session-info-reply", onReply);
    mainWindow?.webContents.send("get-session-info");
  });
}

async function saveSession(
  uid: string,
  start: Date,
  end: Date,
  duration: number,
  info: SessionInfo,
  { queueOnAnyError = false } = {},
) {
  const startTime = start.toISOString();
  const endTime = end.toISOString();
  const projectId = info.projectId ? String(info.projectId) : undefined;
  const isBillable = info.isBillable || false;
  try {
    await addSession(
      uid,
      startTime,
      duration,
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
        duration,
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

// ── Tracking IPC ─────────────────────────────────────────────────────

ipcMain.handle("start-tracking", (_event) => {
  startTickInterval();
  sessionStart = new Date();
  sessionActiveDuration = 0;
  lastActiveTimestamp = new Date();
  isPaused = false;
  autoPaused = false;
  updateTrayMenu();
});

function pauseSession(automatic: boolean) {
  if (!isPaused && lastActiveTimestamp) {
    sessionActiveDuration = currentActiveDuration();
    isPaused = true;
    autoPaused = automatic;
    stopTickInterval();
    updateTrayMenu();
  }
}

function resumeSession() {
  if (isPaused) {
    lastActiveTimestamp = new Date();
    startTickInterval();
    isPaused = false;
    autoPaused = false;
    updateTrayMenu();
  }
}

ipcMain.handle("pause-tracking", () => pauseSession(false));
ipcMain.handle("resume-tracking", () => resumeSession());
ipcMain.on("auto-pause", () => pauseSession(true));
ipcMain.on("auto-resume", () => resumeSession());

ipcMain.handle("stop-tracking", async (_event) => {
  if (!sessionStart) {
    stopTickInterval();
    return;
  }

  const start = sessionStart;
  const end = new Date();
  const duration = currentActiveDuration(end);
  // Free the tracker right away: the prompt below can stay open for minutes
  // and the user may start a new session in the meantime.
  resetSessionState();

  if (duration < 10) return; // Only record if >= 10 seconds

  const uid = await resolveUserId();
  if (!uid) return;

  // A previous stop is still waiting on its prompt — auto-save it first
  settleSessionInfo?.(TIMED_OUT_SESSION_INFO);

  const save = (async () => {
    const info = await askSessionInfo();
    // An empty title means the user chose "Discard"
    if (info.title && info.title.trim() !== "") {
      await saveSession(uid, start, end, duration, info);
    }
  })();
  pendingStopSave = save;
  try {
    await save;
  } finally {
    if (pendingStopSave === save) pendingStopSave = null;
  }
});

// ── Incognito Mode ───────────────────────────────────────────────────
ipcMain.handle("toggle-incognito", () => {
  isIncognito = !isIncognito;
  mainWindow?.webContents.send("incognito-toggled", isIncognito);
  updateTrayMenu();
  return isIncognito;
});

ipcMain.handle("get-incognito-status", () => isIncognito);

// Handle manual notification check trigger (e.g., when user logs in)
ipcMain.handle("check-notifications", async () => {
  await checkScheduledSessionNotifications();
});

// ── Offline queue IPC ────────────────────────────────────────────────
ipcMain.handle("get-sync-status", () => getSyncStatus());

ipcMain.handle("flush-offline-queue", async () => {
  const flushed = await flushOfflineQueue();
  return { flushed, status: getSyncStatus() };
});

// Handle OAuth redirect to open external browser
ipcMain.handle("open-oauth-url", async (_event, url: string) => {
  const { shell } = require("electron");
  await shell.openExternal(url);
});

// Handle app close with an active (running or paused) session, or a stopped
// session still waiting on its session-info prompt
let quitInProgress = false;
app.on("before-quit", async (event) => {
  if (quitInProgress) return;
  if (!sessionStart && !pendingStopSave) return; // normal quit

  event.preventDefault(); // Prevent immediate quit
  quitInProgress = true;

  try {
    if (pendingStopSave) {
      settleSessionInfo?.(APP_CLOSED_SESSION_INFO);
      await pendingStopSave;
    }

    if (sessionStart) {
      const start = sessionStart;
      const end = new Date();
      const duration = currentActiveDuration(end);
      resetSessionState();

      // Only save if session has meaningful duration (>= 10 seconds)
      if (duration >= 10) {
        const uid = await resolveUserId();
        if (uid) {
          await saveSession(uid, start, end, duration, APP_CLOSED_SESSION_INFO, {
            queueOnAnyError: true,
          });
        }
      }
    }
  } catch (err) {
    logError("before-quit", err);
  } finally {
    // Persist the offline queue to disk before exiting
    destroyOfflineQueue();
    // Allow app to quit now
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Unregister global shortcuts when the app is about to quit
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// Handle OAuth callback URLs (for deep linking)
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine, _workingDirectory) => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();

      // Handle OAuth callback URL
      const url = commandLine.find((arg) =>
        arg.startsWith("dev-time-tracker://"),
      );
      if (url) {
        handleOAuthCallback(url);
      }
    }
  });

  // Handle OAuth callback on macOS
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleOAuthCallback(url);
  });
}

// Function to handle OAuth callback
function handleOAuthCallback(url: string) {
  // eslint-disable-next-line no-console
  console.log("OAuth callback URL received:", url);

  // Extract hash fragment (#) or query params (?)
  const hashIndex = url.indexOf("#");
  const queryIndex = url.indexOf("?");

  let params = "";
  if (hashIndex !== -1) {
    params = url.substring(hashIndex + 1);
    // eslint-disable-next-line no-console
    console.log("Extracted hash params:", params);
  } else if (queryIndex !== -1) {
    params = url.substring(queryIndex + 1);
    // eslint-disable-next-line no-console
    console.log("Extracted query params:", params);
  }

  // Send to renderer process to handle auth
  if (mainWindow && params) {
    // eslint-disable-next-line no-console
    console.log("Sending oauth-callback to renderer");
    mainWindow.webContents.send("oauth-callback", params);
  } else {
    // eslint-disable-next-line no-console
    console.error("No params found or mainWindow not available");
  }
}

/**
 * Update the idle timeout setting (called when user changes preference)
 */
export function updateIdleTimeout(seconds: number) {
  idleTimeoutSeconds = seconds;
}

/**
 * Update the tracking interval setting (called when user changes preference).
 * If tracking is currently active (not paused), the running interval is
 * restarted with the new cadence immediately.
 */
export function updateTrackingInterval(seconds: number) {
  intervalSeconds = seconds;
  // If tracking is running, restart the setInterval with the new duration
  if (trackingInterval && !isPaused) {
    clearInterval(trackingInterval);
    trackingInterval = setInterval(
      () => trackActiveWindow(),
      intervalSeconds * 1000,
    );
  }
}
