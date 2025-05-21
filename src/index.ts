import { app, BrowserWindow, ipcMain } from 'electron';
import { logWindow, getLogs } from './logger';
import { activeWindow } from '@miniben90/x-win';

let mainWindow: BrowserWindow;
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;

function trackActiveWindow() {
  try {
    const window = activeWindow(); // Synchronous API
    const execName = window?.info?.execName?.toLowerCase();

    if (execName?.includes('code')) {
      console.log('Tracking:', window.title);
      logWindow(window.info.name || 'Unknown', window.title || 'Untitled');
      mainWindow?.webContents.send('window-tracked'); // <--- Notify renderer
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
