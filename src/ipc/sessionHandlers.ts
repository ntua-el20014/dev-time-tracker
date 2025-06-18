import { ipcMain } from 'electron';
import * as sessions from '../backend/sessions';


ipcMain.handle('get-sessions', async (_event, userId: number) => {
  try {
    return sessions.getSessions(userId);
  } catch (err) {
    console.error('[Get Sessions Error]', err);
    return [];
  }
});

ipcMain.handle('edit-session', async (_event, {userId, id, title, description, tags }) => {
  try {
    sessions.editSession(userId, id, title, description, tags);
    return true;
  } catch (err) {
    console.error('[Edit Session Error]', err);
    return false;
  }
});

ipcMain.handle('delete-session', async (_event, id) => {
  try {
    sessions.deleteSession(id);
    return true;
  } catch (err) {
    console.error('[Delete Session Error]', err);
    return false;
  }
});

// --- Tags ---
ipcMain.handle('get-all-tags', (_event, userId: number) => {
  return sessions.getAllTags(userId);
});

ipcMain.handle('set-tag-color', (_event, userId: number, tagName: string, color: string) => {
  sessions.setTagColor(userId, tagName, color);
  return true;
});

ipcMain.handle('set-session-tags', (_event, userId, sessionId, tagNames) => {
  sessions.setSessionTags(userId, sessionId, tagNames);
  return true;
});

ipcMain.handle('delete-tag', (_event, userId: number, name: string) => {
  sessions.deleteTag(userId, name);
  return true;
});