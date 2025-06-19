import { ipcMain } from 'electron';
import * as config from '../config';
import { getIdleTimeoutSeconds } from '../utils/ipcHelp';

let idleTimeoutSeconds = getIdleTimeoutSeconds();

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