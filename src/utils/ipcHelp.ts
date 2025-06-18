import { BrowserWindow } from 'electron';

export function notifyRenderer(message: string, durationMs = 3500) {
  // Find the main window and send the notification
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send('notify', { message, durationMs });
  }
}