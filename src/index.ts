import { app, BrowserWindow, ipcMain } from 'electron';
import { logWindow, getSummary, getEditorUsage, getDailySummary, getLanguageUsage } from './logger';
import { getEditorByExecutable } from './utils/editors';
import { getLanguageDataFromTitle } from './utils/extractData';
import { activeWindow } from '@miniben90/x-win';
import { loadEditorColors, saveEditorColors } from './config';
import os from 'os';

let mainWindow: BrowserWindow;
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
const intervalSeconds = 10;
let trackingInterval: NodeJS.Timeout | null = null;

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
});

ipcMain.handle('stop-tracking', () => {
  if (trackingInterval) {
    clearInterval(trackingInterval);
    trackingInterval = null;
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
