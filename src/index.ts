import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron';
import * as config from './config';
import { getEditorByExecutable } from './utils/editors';
import { getLanguageDataFromTitle } from './utils/extractData';
import './utils/langMap';
import { activeWindow } from '@miniben90/x-win';
import os from 'os';
import * as usage from './backend/usage';
import * as sessions from './backend/sessions';
import * as users from './backend/users';
import './ipc/usageHandlers';
import './ipc/sessionHandlers';
import './ipc/userHandlers';
import './ipc/dbHandler';

let mainWindow: BrowserWindow;
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
const intervalSeconds = 10;
let trackingInterval: NodeJS.Timeout | null = null;
let sessionStart: Date | null = null;
let sessionEnd: Date | null = null;
let sessionActiveDuration = 0; // in seconds
let lastActiveTimestamp: Date | null = null;
let isPaused = false;

let idleTimeoutSeconds = 60;
try {
  const cfg = config.loadConfig();
  if (cfg && typeof cfg.idleTimeoutSeconds === 'number') {
    idleTimeoutSeconds = cfg.idleTimeoutSeconds;
  }
} catch {
  // Fallback to default if config loading fails
  idleTimeoutSeconds = 60;
}

app.whenReady().then(() => {
  createWindow();

  // Listen for system idle (lock/unlock)
  powerMonitor.on('lock-screen', () => {
    if (!isPaused && trackingInterval) {
      ipcMain.emit('auto-pause');
      mainWindow?.webContents.send('auto-paused');
    }
  });

  // Poll for idle time every 2 seconds
  setInterval(() => {
    const idleSeconds = powerMonitor.getSystemIdleTime();
    if (idleSeconds >= idleTimeoutSeconds) {
      if (!isPaused && trackingInterval) {
        ipcMain.emit('auto-pause');
        mainWindow?.webContents.send('auto-paused');
        mainWindow?.webContents.send('notify', {
          message: `Tracking paused due to inactivity (${(idleTimeoutSeconds / 60).toFixed(1)} minutes idle).`
        });
      }
    }
  }, 2000);

  if (users.getAllUsers().length === 0) {
    console.log('No users found, creating default user');
    users.createUser('Default');
  }
});

function trackActiveWindow(userId: number) {
  try {
    const window = activeWindow(); // Synchronous
    const icon = window.getIcon().data;
    const execName = window?.info?.execName?.toLowerCase();
    const title = window?.title || '';
    const editor = getEditorByExecutable(execName);

    if (!editor) return;

    console.log('Tracking:', title);

    const langData = getLanguageDataFromTitle(title);
    const language = langData?.language || 'Unknown';
    const langExt = langData?.extension || null;

    // Pass langExt to logWindow
    usage.logWindow(userId, editor.name || 'Unknown', title, language, icon, intervalSeconds, langExt);

    mainWindow?.webContents.send('window-tracked');
  } catch (err) {
    console.error('[Tracker Error]', err);
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
  })
  
  /*
  // Open DevTools in development mode
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }*/
  
  mainWindow.webContents.on('did-finish-load', () => {
  mainWindow.webContents.send('os-info', { os: os.platform() });
});

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
}

ipcMain.handle('get-editor-colors', (_event, userId: number) => {
  return config.loadEditorColors(userId);
});

ipcMain.handle('set-editor-color', (event, appName: string, color: string, userId: number) => {
  const editorColors = config.loadEditorColors(userId);
  editorColors[appName] = color;
  config.saveEditorColors(editorColors, userId);
});

ipcMain.handle('get-accent-color', (_event, theme: 'dark' | 'light', userId: number) => {
  return config.getAccentColor(theme, userId);
});

ipcMain.handle('set-accent-color', (_event, color: string, theme: 'dark' | 'light', userId: number) => {
  config.setAccentColor(color, theme, userId);
  return true;
});

ipcMain.handle('get-user-theme', (_event, userId: number) => {
  return config.getUserTheme(userId);
});

ipcMain.handle('set-user-theme', (_event, theme: 'light' | 'dark', userId: number) => {
  config.setUserTheme(theme, userId);
  return true;
});

ipcMain.handle('get-idle-timeout', () => {
  return idleTimeoutSeconds;
});

ipcMain.handle('set-idle-timeout', (_event, seconds: number) => {
  idleTimeoutSeconds = seconds;
  const cfg = config.loadConfig();
  cfg.idleTimeoutSeconds = seconds;
  config.saveConfig(cfg);
  return true;
});

ipcMain.handle('start-tracking', (_event, userId:number) => {
  if (!trackingInterval) {
    trackingInterval = setInterval(() => trackActiveWindow(userId), intervalSeconds * 1000);

  }
  sessionStart = new Date();
  sessionActiveDuration = 0;
  lastActiveTimestamp = new Date();
  isPaused = false;
});

ipcMain.handle('pause-tracking', () => {
  if (!isPaused && lastActiveTimestamp) {
    const now = new Date();
    sessionActiveDuration += Math.round((now.getTime() - lastActiveTimestamp.getTime()) / 1000);
    isPaused = true;
    if (trackingInterval) {
      clearInterval(trackingInterval);
      trackingInterval = null;
    }
  }
});

ipcMain.handle('resume-tracking', (_event, userId: number) => {
  if (isPaused) {
    lastActiveTimestamp = new Date();
    trackingInterval = setInterval(() => trackActiveWindow(userId), intervalSeconds * 1000);
    isPaused = false;
  }
});

ipcMain.handle('stop-tracking', async (_event, userId: number) => {
  if (trackingInterval) {
    clearInterval(trackingInterval);
    trackingInterval = null;
  }
  let duration = sessionActiveDuration;
  if (!isPaused && lastActiveTimestamp) {
    const now = new Date();
    duration += Math.round((now.getTime() - lastActiveTimestamp.getTime()) / 1000);
  }
  sessionEnd = new Date();
  if (sessionStart && sessionEnd) {
    if (duration >= 10) { // Only record if >= 10 seconds
      // Ask renderer for session title/description
      const getSessionInfo = () =>
        new Promise<{ title: string; description: string }>((resolve) => {
          ipcMain.once('session-info-reply', (event, data) => {
            resolve(data);
          });
          mainWindow?.webContents.send('get-session-info');
        });

      const { title, description } = await getSessionInfo();
      if (title && title.trim() !== '') {
        const date = sessionStart.toLocaleDateString('en-CA');
        const start_time = sessionStart.toISOString();
        sessions.addSession(userId, date, start_time, duration, title, description);
      }
    }
  }
  sessionStart = null;
  sessionEnd = null;
  sessionActiveDuration = 0;
  lastActiveTimestamp = null;
  isPaused = false;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('auto-pause', () => {
  if (!isPaused && lastActiveTimestamp) {
    const now = new Date();
    sessionActiveDuration += Math.round((now.getTime() - lastActiveTimestamp.getTime()) / 1000);
    isPaused = true;
    if (trackingInterval) {
      clearInterval(trackingInterval);
      trackingInterval = null;
    }
  }
});

ipcMain.on('auto-resume', (_event, userId) => {
  if (isPaused) {
    lastActiveTimestamp = new Date();
    trackingInterval = setInterval(() => trackActiveWindow(userId), intervalSeconds * 1000);
    isPaused = false;
  }
});