import { app, BrowserWindow, ipcMain } from 'electron';
import { logWindow, getSummary, getEditorUsage, getDailySummary, getLoggedDaysOfMonth, getLanguageUsage, addSession, getSessions } from './logger';
import { getEditorByExecutable } from './utils/editors';
import { getLanguageDataFromTitle } from './utils/extractData';
import { activeWindow } from '@miniben90/x-win';
import { loadEditorColors, saveEditorColors } from './config';
import os from 'os';

let mainWindow: BrowserWindow;
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
const intervalSeconds = 10;
let trackingInterval: NodeJS.Timeout | null = null;
let sessionStart: Date | null = null;
let sessionEnd: Date | null = null;

function trackActiveWindow() {
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

    // logWindow now logs language and icon
    logWindow(editor.name || 'Unknown', title, language, icon, intervalSeconds);

    mainWindow?.webContents.send('window-tracked');
    //}
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
  // Open DevTools in development mode
  /*if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }*/
  mainWindow.webContents.on('did-finish-load', () => {
  mainWindow.webContents.send('os-info', { os: os.platform() });
});

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
}

ipcMain.handle('get-logs', async (event, date: string) => {
  try {
    return getSummary(date);
  } catch (err) {
    console.error('[Get Logs Error]', err);
    return [];
  }
});

ipcMain.handle('get-logged-days-of-month', async (_event, year: number, month: number) => {
  try {
    return getLoggedDaysOfMonth(year, month);
  } catch (err) {
    console.error('[Get Logged Days Of Month Error]', err);
    return [];
  }
});

ipcMain.handle('get-editor-usage', async () => {
  try {
    return getEditorUsage();
  } catch (err) {
    console.error('[Get Editor Usage Error]', err);
    return [];
  }
});

ipcMain.handle('get-daily-summary', async () => {
  try {
    return getDailySummary();
  } catch (err) {
    console.error('[Get Daily Summary Error]', err);
    return [];
  }
});

ipcMain.handle('get-editor-colors', () => {
  return loadEditorColors();
});

ipcMain.handle('set-editor-color', (event, app: string, color: string) => {
  const config = loadEditorColors();
  config[app] = color;
  saveEditorColors(config);
});

ipcMain.handle('get-language-usage', async () => {
  try {
    return getLanguageUsage();
  } catch (err) {
    console.error('[Get Language Usage Error]', err);
    return [];
  }
});

ipcMain.handle('start-tracking', () => {
  if (!trackingInterval) {
    trackingInterval = setInterval(trackActiveWindow, intervalSeconds * 1000);
  }
  sessionStart = new Date();
});

ipcMain.handle('stop-tracking', async () => {
  if (trackingInterval) {
    clearInterval(trackingInterval);
    trackingInterval = null;
  }
  sessionEnd = new Date();
  if (sessionStart && sessionEnd) {
    const duration = (sessionEnd.getTime() - sessionStart.getTime()) / 1000;
    if (duration >= 60) { // Only record if >= 1 minute
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
        const end_time = sessionEnd.toISOString();
        addSession(date, start_time, end_time, title, description);
      }
    }
  }
  sessionStart = null;
  sessionEnd = null;
});

ipcMain.handle('get-sessions', async () => {
  try {
    return getSessions();
  } catch (err) {
    console.error('[Get Sessions Error]', err);
    return [];
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
