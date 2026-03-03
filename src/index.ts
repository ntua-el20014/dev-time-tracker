import { app, BrowserWindow, ipcMain, powerMonitor } from "electron";
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
import { logUsage } from "./supabase/usageLogs";
import { addSession } from "./supabase/timeTracking";
import {
  getUpcomingSessionNotifications,
  markNotificationSent,
} from "./supabase/scheduledSessions";
import { getCurrentUser } from "./supabase/api";
import { supabase } from "./supabase/config";
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
import "./ipc/exportHandlers";
import { DEFAULT_TRACKING_INTERVAL_SECONDS } from "@shared/constants";

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
let sessionEnd: Date | null = null;
let sessionActiveDuration = 0; // in seconds
let lastActiveTimestamp: Date | null = null;
let isPaused = false;
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

  // Listen for system idle (lock/unlock)
  powerMonitor.on("lock-screen", () => {
    if (!isPaused && trackingInterval) {
      ipcMain.emit("auto-pause");
      mainWindow?.webContents.send("auto-paused");
    }
  });

  // Poll for idle time every 2 seconds
  setInterval(() => {
    const idleSeconds = powerMonitor.getSystemIdleTime();
    if (idleSeconds >= idleTimeoutSeconds) {
      if (!isPaused && trackingInterval) {
        ipcMain.emit("auto-pause");
        mainWindow?.webContents.send("auto-paused");
        mainWindow?.webContents.send("notify", {
          message: `Tracking paused due to inactivity (${(
            idleTimeoutSeconds / 60
          ).toFixed(1)} minutes idle).`,
        });
      }
    }
  }, 2000);

  // Note: User creation is handled by Supabase auth signup

  // Check for scheduled session notifications every minute for real-time notifications
  setInterval(() => {
    checkScheduledSessionNotifications();
  }, 60 * 1000); // Every minute
});

/** Cache process icons by exec name — icons don't change at runtime. */
const iconCache = new Map<string, string>();

async function trackActiveWindow() {
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
    try {
      await withRetry(
        () =>
          logUsage(
            uid,
            appName,
            title,
            language,
            langExt,
            icon,
            intervalSeconds,
            logTimestamp,
          ),
        { maxAttempts: 2, retryOn: ["network"] },
      );
    } catch (retryErr) {
      // All retries exhausted — queue locally so data is never lost
      if (classifyError(retryErr) === "network") {
        enqueueUsageLog(
          uid,
          appName,
          title,
          language,
          langExt,
          icon,
          intervalSeconds,
          logTimestamp,
        );
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: true, // Re-enable web security to allow CSP
    },
  });

  // Set CSP via session headers (more reliable than meta tag in Electron)
  mainWindow.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; " +
              "script-src 'self' 'unsafe-eval' http://localhost:3000; " +
              "style-src 'self' 'unsafe-inline'; " +
              "img-src 'self' data:; " +
              "connect-src 'self' https://bgrqsrpvznsdjpzhyhov.supabase.co http://localhost:3000;",
          ],
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

ipcMain.handle("start-tracking", (_event) => {
  if (!trackingInterval) {
    trackingInterval = setInterval(
      () => trackActiveWindow(),
      intervalSeconds * 1000,
    );
  }
  sessionStart = new Date();
  sessionActiveDuration = 0;
  lastActiveTimestamp = new Date();
  isPaused = false;
});

ipcMain.handle("pause-tracking", () => {
  if (!isPaused && lastActiveTimestamp) {
    const now = new Date();
    sessionActiveDuration += Math.round(
      (now.getTime() - lastActiveTimestamp.getTime()) / 1000,
    );
    isPaused = true;
    if (trackingInterval) {
      clearInterval(trackingInterval);
      trackingInterval = null;
    }
  }
});

ipcMain.handle("resume-tracking", (_event) => {
  if (isPaused) {
    lastActiveTimestamp = new Date();
    trackingInterval = setInterval(
      () => trackActiveWindow(),
      intervalSeconds * 1000,
    );
    isPaused = false;
  }
});

ipcMain.handle("stop-tracking", async (_event) => {
  if (trackingInterval) {
    clearInterval(trackingInterval);
    trackingInterval = null;
  }

  // Check if there's an active session to stop
  if (!sessionStart) {
    // No active session to stop
    return;
  }

  let duration = sessionActiveDuration;
  if (!isPaused && lastActiveTimestamp) {
    const now = new Date();
    duration += Math.round(
      (now.getTime() - lastActiveTimestamp.getTime()) / 1000,
    );
  }
  sessionEnd = new Date();

  if (sessionStart && sessionEnd) {
    if (duration >= 10) {
      // Only record if >= 10 seconds
      let uid: string | null = null;
      try {
        const user = await getCurrentUser();
        if (user) {
          uid = user.id;
          cachedUserId = user.id;
        }
      } catch {
        uid = cachedUserId;
      }
      if (!uid) return;

      // Ask renderer for session title/description
      const getSessionInfo = () =>
        new Promise<{
          title: string;
          description: string;
          projectId?: number | string;
          isBillable?: boolean;
        }>((resolve) => {
          const timeout = setTimeout(() => {
            // Timeout after 30 seconds — auto-save with default title
            ipcMain.removeAllListeners("session-info-reply");
            resolve({
              title: "Untitled Session",
              description: "Session info dialog timed out — auto-saved.",
            });
          }, 30_000);

          ipcMain.once("session-info-reply", (_event, data) => {
            clearTimeout(timeout);
            resolve(data);
          });
          mainWindow?.webContents.send("get-session-info");
        });

      const { title, description, projectId, isBillable } =
        await getSessionInfo();
      if (title && title.trim() !== "") {
        const start_time = sessionStart.toISOString();
        try {
          await addSession(
            uid,
            start_time,
            duration,
            title,
            description,
            undefined, // tags
            projectId ? String(projectId) : undefined,
            isBillable || false,
          );
        } catch (sessionErr) {
          if (classifyError(sessionErr) === "network") {
            enqueueSession(
              uid,
              start_time,
              duration,
              title,
              description,
              undefined,
              projectId ? String(projectId) : undefined,
              isBillable || false,
            );
          } else {
            logError("stop-tracking addSession", sessionErr);
          }
        }
      }
    }
  }
  sessionStart = null;
  sessionEnd = null;
  sessionActiveDuration = 0;
  lastActiveTimestamp = null;
  isPaused = false;
});

ipcMain.on("auto-pause", () => {
  if (!isPaused && lastActiveTimestamp) {
    const now = new Date();
    sessionActiveDuration += Math.round(
      (now.getTime() - lastActiveTimestamp.getTime()) / 1000,
    );
    isPaused = true;
    if (trackingInterval) {
      clearInterval(trackingInterval);
      trackingInterval = null;
    }
  }
});

ipcMain.on("auto-resume", (_event) => {
  if (isPaused) {
    lastActiveTimestamp = new Date();
    trackingInterval = setInterval(
      () => trackActiveWindow(),
      intervalSeconds * 1000,
    );
    isPaused = false;
  }
});

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

// Handle app close with active session
app.on("before-quit", async (event) => {
  // Check if there's an active tracking session
  if (sessionStart && trackingInterval) {
    event.preventDefault(); // Prevent immediate quit

    try {
      // Get current user (fall back to cached ID when offline)
      let quitUserId: string | null = null;
      try {
        const user = await getCurrentUser();
        if (user) {
          quitUserId = user.id;
          cachedUserId = user.id;
        }
      } catch {
        quitUserId = cachedUserId;
      }

      if (quitUserId) {
        // Calculate final duration
        let duration = sessionActiveDuration;
        if (!isPaused && lastActiveTimestamp) {
          const now = new Date();
          duration += Math.round(
            (now.getTime() - lastActiveTimestamp.getTime()) / 1000,
          );
        }

        // Only save if session has meaningful duration (>= 10 seconds)
        if (duration >= 10 && sessionStart) {
          const startTime = sessionStart.toISOString();

          // Auto-save session with default title
          try {
            await addSession(
              quitUserId,
              startTime,
              duration,
              "Auto-saved session (app closed)",
              "Session was automatically saved when the application closed",
              undefined, // tags
              undefined, // projectId
              false, // isBillable
            );
          } catch (saveErr) {
            // Queue locally so the session is not lost
            enqueueSession(
              quitUserId,
              startTime,
              duration,
              "Auto-saved session (app closed)",
              "Session was automatically saved when the application closed",
              undefined,
              undefined,
              false,
            );
          }
        }

        // Clean up tracking state
        if (trackingInterval) {
          clearInterval(trackingInterval);
          trackingInterval = null;
        }
        sessionStart = null;
        sessionEnd = null;
        sessionActiveDuration = 0;
        lastActiveTimestamp = null;
        isPaused = false;
      }
    } catch (err) {
      logError("before-quit", err);
    } finally {
      // Persist the offline queue to disk before exiting
      destroyOfflineQueue();
      // Allow app to quit now
      app.quit();
    }
  }
  // If no active session, allow normal quit
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
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
