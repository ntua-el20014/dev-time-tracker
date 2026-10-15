import {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  shell,
} from "electron";
import os from "os";
import path from "path";
import "./utils/langMap";
import {
  getUpcomingSessionNotifications,
  markNotificationSent,
} from "./supabase/scheduledSessions";
import { getCurrentUser } from "./supabase/api";
import { supabase } from "./supabase/config";
import { SUPABASE_CONFIG } from "./supabase/env";
import { logError, classifyError } from "./utils/errorHandler";
import {
  initOfflineQueue,
  destroyOfflineQueue,
  flush as flushOfflineQueue,
  getSyncStatus,
} from "./utils/offlineQueue";
import {
  initTracking,
  getTrackingState,
  onTrackingStateChange,
  setTrackingUser,
  hasTrackingUser,
  startTracking,
  stopTracking,
  pauseTracking,
  resumeTracking,
  toggleIncognito,
  flushTrackedUsage,
  hasUnsavedTrackingWork,
  finalizeTrackingForQuit,
} from "./tracking/tracker";
import "./ipc/sessionHandlers";
import "./ipc/usageHandlers";
import "./ipc/tagHandlers";
import "./ipc/goalHandlers";
import "./ipc/scheduledSessionHandlers";
import "./ipc/preferencesHandlers";
import "./ipc/projectHandlers";
import "./ipc/repoHandlers";
import "./ipc/userHandlers";
import "./ipc/organizationHandlers";
import "./ipc/analyticsHandlers";
import "./ipc/exportHandlers";
import "./ipc/standupHandlers";
import "./ipc/billableHoursHandlers";
import "./ipc/invoiceHandlers";
import "./ipc/updaterHandlers";
import { initSentryMain, reportError } from "./sentryMain";
import { initUpdater, setUpdaterStateSink } from "./updater";

// ── Windows installer events ──────────────────────────────────────
// Squirrel runs the app with --squirrel-install/--squirrel-updated/
// --squirrel-uninstall to create or remove shortcuts; handle and exit.
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (require("electron-squirrel-startup")) {
  app.quit();
}

// ── Separate profile for development / smoke tests ────────────────
// DTT_USER_DATA_DIR runs the app with its own userData dir (auth session,
// custom apps, single-instance lock) and leaves the OS protocol handler
// alone, so a test build can't touch the real installation.
const isolatedProfileDir = process.env.DTT_USER_DATA_DIR;
if (isolatedProfileDir) {
  app.setPath("userData", isolatedProfileDir);
}

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
      const { data, error } = await supabase.auth.setSession({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      });
      if (error) {
        return false;
      }
      setTrackingUser(data.user?.id ?? data.session?.user.id ?? null);
      return true;
    } else {
      // Write buffered usage while still authenticated, then sign out
      await flushTrackedUsage();
      setTrackingUser(null);
      await supabase.auth.signOut();
      return true;
    }
  },
);

let mainWindow: BrowserWindow | null = null;
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
let tray: Tray | null = null;

/** Global incognito toggle. Avoids Ctrl+Shift+I (DevTools / editor chat). */
const INCOGNITO_SHORTCUT = "CommandOrControl+Alt+Shift+I";

// Register custom protocol handler for OAuth
if (isolatedProfileDir) {
  // Isolated profile: don't re-point the OS handler at this build
} else if (process.defaultApp) {
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

  // Initialise the offline write queue (loads any persisted items from disk)
  initOfflineQueue();

  // Tracking engine: idle/lock/sleep handling, state broadcasts
  initTracking({ getWindow: () => mainWindow });
  onTrackingStateChange(() => updateTrayMenu());

  // Check for scheduled session notifications every minute for real-time notifications
  setInterval(() => {
    checkScheduledSessionNotifications();
  }, 60 * 1000); // Every minute

  // ── System tray ──────────────────────────────────────────────────
  createTray();

  // ── Global shortcut: toggles incognito ───────────────────────────
  const registered = globalShortcut.register(INCOGNITO_SHORTCUT, () => {
    toggleIncognito();
  });
  if (!registered) {
    logError(
      "globalShortcut",
      new Error(`${INCOGNITO_SHORTCUT} is already taken by another app`),
    );
  }
});

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
function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

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

  tray.on("click", showMainWindow);
}

function toggleRecordingFromTray() {
  if (getTrackingState().isRecording) {
    // Stopping opens the session-info modal, so make sure it's visible
    showMainWindow();
    void stopTracking();
  } else if (hasTrackingUser()) {
    startTracking();
  } else {
    showMainWindow(); // not signed in yet
  }
}

function updateTrayMenu() {
  if (!tray) return;
  const { isRecording, isPaused, isIncognito } = getTrackingState();
  const contextMenu = Menu.buildFromTemplate([
    {
      label: isRecording ? "Stop Tracking" : "Start Tracking",
      click: toggleRecordingFromTray,
    },
    {
      label: isPaused ? "Resume" : "Pause",
      enabled: isRecording,
      click: () => (isPaused ? resumeTracking() : pauseTracking()),
    },
    { type: "separator" },
    {
      label: isIncognito ? "✔ Incognito Mode" : "  Incognito Mode",
      click: () => toggleIncognito(),
    },
    { type: "separator" },
    {
      label: "Show Window",
      click: showMainWindow,
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
  const win = new BrowserWindow({
    width: 1150,
    height: 800,
    webPreferences: {
      // The renderer has no Node access; it talks to main only through the
      // IPC bridge in src/preload.ts (window.electronAPI).
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Remove the default application menu (File/View/Help) for a cleaner window
  try {
    Menu.setApplicationMenu(null);
    // Also hide the menu bar on Windows/Linux so Alt doesn't reveal it
    win.setMenuBarVisibility(false);
    win.setAutoHideMenuBar(true);
  } catch (e) {
    // Ignore if Menu APIs aren't available in some environments
  }

  // Set CSP via session headers (more reliable than meta tag in Electron)
  win.webContents.session.webRequest.onHeadersReceived(
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
    win.webContents.openDevTools();
  }

  win.webContents.on("did-finish-load", () => {
    win.webContents.send("os-info", { os: os.platform() });
  });

  // Check for notifications when window gains focus
  win.on("focus", () => {
    checkScheduledSessionNotifications();
  });

  // Check for notifications when window is shown (e.g., from minimized state)
  win.on("show", () => {
    checkScheduledSessionNotifications();
  });

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  mainWindow = win;
  win.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
}

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
// Only http(s): openExternal on file:// or custom schemes could launch
// local programs if a compromised renderer called this.
ipcMain.handle("open-oauth-url", async (_event, url: string) => {
  let protocol = "";
  try {
    protocol = new URL(url).protocol;
  } catch {
    // invalid URL
  }
  if (protocol !== "https:" && protocol !== "http:") {
    throw new Error("open-oauth-url only opens http(s) URLs");
  }
  await shell.openExternal(url);
});

// Before quitting, save a running/paused session, settle an open
// session-info prompt and flush buffered usage
let quitInProgress = false;
app.on("before-quit", async (event) => {
  if (quitInProgress || !hasUnsavedTrackingWork()) return; // normal quit

  event.preventDefault(); // Prevent immediate quit
  quitInProgress = true;

  try {
    await finalizeTrackingForQuit();
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

// Function to handle OAuth callback.
// Never log the URL or params — they carry auth tokens/codes.
function handleOAuthCallback(url: string) {
  // Extract hash fragment (#) or query params (?)
  const hashIndex = url.indexOf("#");
  const queryIndex = url.indexOf("?");

  let params = "";
  if (hashIndex !== -1) {
    params = url.substring(hashIndex + 1);
  } else if (queryIndex !== -1) {
    params = url.substring(queryIndex + 1);
  }

  // Send to renderer process to handle auth
  if (mainWindow && params) {
    mainWindow.webContents.send("oauth-callback", params);
  } else {
    logError(
      "handleOAuthCallback",
      new Error("No params found or mainWindow not available"),
    );
  }
}
