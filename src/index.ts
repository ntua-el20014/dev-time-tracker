import { app, BrowserWindow, ipcMain } from 'electron';
import { logWindow, getLogs } from './logger';
import { getEditorByExecutable } from './utils/editors';
import { getLanguageDataFromTitle } from './utils/extractData';
import { activeWindow} from '@miniben90/x-win';
import os from 'os';


let mainWindow: BrowserWindow;
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;

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
    logWindow(editor.name || 'Unknown', title, language, icon);

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
  mainWindow.webContents.on('did-finish-load', () => {
  mainWindow.webContents.send('os-info', { os: os.platform() });
});

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  setInterval(trackActiveWindow, 10000);
}

ipcMain.handle('get-logs', async () => {
  try {
    return getLogs();
  } catch (err) {
    console.error('[Get Logs Error]', err);
    return [];
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
