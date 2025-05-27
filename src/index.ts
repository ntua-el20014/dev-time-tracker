import { app, BrowserWindow, ipcMain } from 'electron';
import { logWindow, getLogs } from './logger';
import { activeWindow} from '@miniben90/x-win';
import linguistLanguages from 'linguist-languages';
import path from 'path';
import os from 'os';


let mainWindow: BrowserWindow;
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;

function getLanguageDataFromTitle(title: string) {
  const filename = title.split(' - ')[0].trim();
  const ext = path.extname(filename).toLowerCase();
  if (!ext) return null;

  const lang = Object.values(linguistLanguages).find(lang =>
    lang.extensions?.includes(ext)
  );

  if (!lang) return null;

  return {
    language: lang.name,
  };
}

function trackActiveWindow() {
  try {
    const window = activeWindow(); // Synchronous
    const icon = window.getIcon().data;
    const execName = window?.info?.execName?.toLowerCase();
    const title = window?.title || '';

    if (execName?.includes('code')) {
      console.log('Tracking:', title);

      const langData = getLanguageDataFromTitle(title);
      const language = langData?.language || 'Unknown';

      // logWindow now logs language and icon
      logWindow(window.info.name || 'Unknown', title, language, icon);

      mainWindow?.webContents.send('window-tracked');
    }
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
  setInterval(trackActiveWindow, 5000);
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
