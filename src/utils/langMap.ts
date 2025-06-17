// main/langMap.ts (main process)
import { shell, app, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';

function getUserLangPath(userId: number) {
  return path.join(app.getPath('userData'), `lang-${userId}.json`);
}

function ensureLangJson(userId: number) {
  const userLangPath = getUserLangPath(userId);
  if (!fs.existsSync(userLangPath)) {
    fs.writeFileSync(userLangPath, '{}', 'utf-8');
  }
}

function loadUserLangMap(userId: number) {
  ensureLangJson(userId);
  try {
    const raw = fs.readFileSync(getUserLangPath(userId), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

ipcMain.handle('get-user-lang-map', (_event, userId: number) => {
  return loadUserLangMap(userId);
});

ipcMain.handle('open-lang-json', (_event, userId: number) => {
  const userLangPath = getUserLangPath(userId);
  if (!fs.existsSync(userLangPath)) {
    fs.writeFileSync(userLangPath, '{}', 'utf-8');
  }
  shell.openPath(userLangPath);
});