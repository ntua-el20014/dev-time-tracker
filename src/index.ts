import { app, BrowserWindow, ipcMain, powerMonitor } from "electron";
import { activeWindow } from "@miniben90/x-win";
import os from "os";
import "./utils/langMap";
import { getEditorByExecutable } from "./utils/editors";
import { getLanguageDataFromTitle } from "./utils/extractData";
import { getIdleTimeoutSeconds } from "./utils/ipcHelp";
import * as usage from "./backend/usage";
import * as sessions from "./backend/sessions";
import * as scheduledSessions from "./backend/scheduledSessions";
import * as users from "./backend/users";
import "./ipc/usageHandlers";
import "./ipc/sessionHandlers";
import "./ipc/scheduledSessionHandlers";
import "./ipc/userHandlers";
import "./ipc/dbHandler";
import "./ipc/appHandlers";
import { DEFAULT_TRACKING_INTERVAL_SECONDS } from "@shared/constants";

let mainWindow: BrowserWindow;
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
const intervalSeconds = DEFAULT_TRACKING_INTERVAL_SECONDS;
let trackingInterval: ReturnType<typeof setInterval> | null = null;
let sessionStart: Date | null = null;
let sessionEnd: Date | null = null;
let sessionActiveDuration = 0; // in seconds
let lastActiveTimestamp: Date | null = null;
let isPaused = false;
const idleTimeoutSeconds = getIdleTimeoutSeconds();

app.whenReady().then(() => {
  createWindow();

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

  if (users.getAllUsers().length === 0) {
    // Create default user if none exists
    users.createUser("Default");
  }

  // Check for scheduled session notifications every minute for real-time notifications
  setInterval(() => {
    checkScheduledSessionNotifications();
  }, 60 * 1000); // Every minute
});

function trackActiveWindow(userId: number) {
  try {
    const window = activeWindow(); // Synchronous
    const icon = window.getIcon().data;
    const execName = window?.info?.execName?.toLowerCase();
    const title = window?.title || "";
    const editor = getEditorByExecutable(execName);

    if (!editor) return;

    // Track current window activity
    const langData = getLanguageDataFromTitle(title);
    const language = langData?.language || "Unknown";
    const langExt = langData?.extension || null;

    // Pass langExt to logWindow
    usage.logWindow(
      userId,
      editor.name || "Unknown",
      title,
      language,
      icon,
      intervalSeconds,
      langExt
    );

    mainWindow?.webContents.send("window-tracked");
  } catch (err) {
    // Handle tracking errors silently or log to a file if needed
    // Error details: ${err}
  }
}

async function checkScheduledSessionNotifications() {
  try {
    const notifications =
      scheduledSessions.getUpcomingSessionsForNotification();

    for (const notification of notifications) {
      let message = "";
      let title = "";

      switch (notification.type) {
        case "day_before":
          title = "Scheduled Session Tomorrow";
          message = `Don't forget: "${notification.title}" is scheduled for tomorrow`;
          if (notification.estimated_duration) {
            message += ` (${notification.estimated_duration} minutes)`;
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
      scheduledSessions.markNotificationSent(notification.id);
    }
  } catch (err) {
    // Handle notification error silently
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
    },
  });

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

ipcMain.handle("start-tracking", (_event, userId: number) => {
  if (!trackingInterval) {
    trackingInterval = setInterval(
      () => trackActiveWindow(userId),
      intervalSeconds * 1000
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
      (now.getTime() - lastActiveTimestamp.getTime()) / 1000
    );
    isPaused = true;
    if (trackingInterval) {
      clearInterval(trackingInterval);
      trackingInterval = null;
    }
  }
});

ipcMain.handle("resume-tracking", (_event, userId: number) => {
  if (isPaused) {
    lastActiveTimestamp = new Date();
    trackingInterval = setInterval(
      () => trackActiveWindow(userId),
      intervalSeconds * 1000
    );
    isPaused = false;
  }
});

ipcMain.handle("stop-tracking", async (_event, userId: number) => {
  if (trackingInterval) {
    clearInterval(trackingInterval);
    trackingInterval = null;
  }
  let duration = sessionActiveDuration;
  if (!isPaused && lastActiveTimestamp) {
    const now = new Date();
    duration += Math.round(
      (now.getTime() - lastActiveTimestamp.getTime()) / 1000
    );
  }
  sessionEnd = new Date();
  if (sessionStart && sessionEnd) {
    if (duration >= 10) {
      // Only record if >= 10 seconds
      // Ask renderer for session title/description
      const getSessionInfo = () =>
        new Promise<{ title: string; description: string }>((resolve) => {
          ipcMain.once("session-info-reply", (_event, data) => {
            resolve(data);
          });
          mainWindow?.webContents.send("get-session-info");
        });

      const { title, description } = await getSessionInfo();
      if (title && title.trim() !== "") {
        const date = sessionStart.toLocaleDateString("en-CA");
        const start_time = sessionStart.toISOString();
        sessions.addSession(
          userId,
          date,
          start_time,
          duration,
          title,
          description
        );
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
      (now.getTime() - lastActiveTimestamp.getTime()) / 1000
    );
    isPaused = true;
    if (trackingInterval) {
      clearInterval(trackingInterval);
      trackingInterval = null;
    }
  }
});

ipcMain.on("auto-resume", (_event, userId) => {
  if (isPaused) {
    lastActiveTimestamp = new Date();
    trackingInterval = setInterval(
      () => trackActiveWindow(userId),
      intervalSeconds * 1000
    );
    isPaused = false;
  }
});

// Handle manual notification check trigger (e.g., when user logs in)
ipcMain.handle("check-notifications", async () => {
  await checkScheduledSessionNotifications();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
