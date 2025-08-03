import { ipcMain } from "electron";
import * as sessions from "../backend/sessions";

ipcMain.handle(
  "get-sessions",
  async (
    _event,
    userId: number,
    filters?: {
      tag?: string;
      startDate?: string;
      endDate?: string;
      projectId?: number;
      billableOnly?: boolean;
    }
  ) => {
    try {
      return sessions.getSessions(userId, filters);
    } catch (err) {
      return [];
    }
  }
);

ipcMain.handle(
  "edit-session",
  async (
    _event,
    { userId, id, title, description, tags, projectId, isBillable }
  ) => {
    try {
      sessions.editSession(
        userId,
        id,
        title,
        description,
        tags,
        projectId,
        isBillable
      );
      return true;
    } catch (err) {
      return false;
    }
  }
);

ipcMain.handle("delete-session", async (_event, id) => {
  try {
    sessions.deleteSession(id);
    return true;
  } catch (err) {
    return false;
  }
});

// --- Tags ---
ipcMain.handle("get-all-tags", (_event, userId: number) => {
  return sessions.getAllTags(userId);
});

ipcMain.handle(
  "set-tag-color",
  (_event, userId: number, tagName: string, color: string) => {
    sessions.setTagColor(userId, tagName, color);
    return true;
  }
);

ipcMain.handle("set-session-tags", (_event, userId, sessionId, tagNames) => {
  sessions.setSessionTags(userId, sessionId, tagNames);
  return true;
});

ipcMain.handle("delete-tag", (_event, userId: number, name: string) => {
  sessions.deleteTag(userId, name);
  return true;
});
