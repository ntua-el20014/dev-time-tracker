import { app, BrowserWindow, ipcMain } from 'electron';
import { logWindow, getLogs } from './logger';
import { activeWindow } from '@miniben90/x-win';

let mainWindow: BrowserWindow;
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;

async function trackActiveWindow() {
  const window = activeWindow(); // synchronous API
  if (
    window &&
    window.info?.execName?.toLowerCase().includes('code')
  ) {
    console.log('Tracking:', window.title);
    logWindow(window.info.name, window.title);
  }
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
    },
  });

  // Use this for Electron Forge + Webpack plugin:
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  setInterval(trackActiveWindow, 5000);
};

ipcMain.handle('get-logs', () => getLogs());

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
