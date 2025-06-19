import { BrowserWindow } from 'electron';
import * as config from '../config';

export function notifyRenderer(message: string, durationMs = 3500) {
  // Find the main window and send the notification
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send('notify', { message, durationMs });
  }
}

export function getIdleTimeoutSeconds(): number {
    let idleTimeoutSeconds = 60;
    try {
        const cfg = config.loadConfig();
        if (cfg && typeof cfg.idleTimeoutSeconds === 'number') {
            idleTimeoutSeconds = cfg.idleTimeoutSeconds;
        }
    } catch {
        idleTimeoutSeconds = 60;
    }
    return idleTimeoutSeconds;
}