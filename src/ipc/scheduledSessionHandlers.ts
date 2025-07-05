import { ipcMain } from "electron";
import * as scheduledSessions from "../backend/scheduledSessions";
import { ScheduledSession } from "@shared/types";

ipcMain.handle(
  "create-scheduled-session",
  async (
    _event,
    scheduledSession: Omit<ScheduledSession, "id" | "created_at">
  ) => {
    try {
      return scheduledSessions.createScheduledSession(scheduledSession);
    } catch (err) {
      return null;
    }
  }
);

ipcMain.handle(
  "get-scheduled-sessions",
  async (
    _event,
    userId: number,
    filters?: {
      startDate?: string;
      endDate?: string;
      status?: ScheduledSession["status"][];
      includeRecurring?: boolean;
    }
  ) => {
    try {
      return scheduledSessions.getScheduledSessions(userId, filters);
    } catch (err) {
      return [];
    }
  }
);

ipcMain.handle(
  "update-scheduled-session",
  async (
    _event,
    userId: number,
    id: number,
    updates: Partial<Omit<ScheduledSession, "id" | "user_id" | "created_at">>
  ) => {
    try {
      return scheduledSessions.updateScheduledSession(userId, id, updates);
    } catch (err) {
      return false;
    }
  }
);

ipcMain.handle(
  "delete-scheduled-session",
  async (_event, userId: number, id: number) => {
    try {
      return scheduledSessions.deleteScheduledSession(userId, id);
    } catch (err) {
      return false;
    }
  }
);

ipcMain.handle(
  "mark-scheduled-session-completed",
  async (
    _event,
    userId: number,
    scheduledSessionId: number,
    actualSessionId: number
  ) => {
    try {
      return scheduledSessions.markScheduledSessionCompleted(
        userId,
        scheduledSessionId,
        actualSessionId
      );
    } catch (err) {
      return false;
    }
  }
);

ipcMain.handle("get-upcoming-session-notifications", async (_event) => {
  try {
    return scheduledSessions.getUpcomingSessionsForNotification();
  } catch (err) {
    return [];
  }
});

ipcMain.handle("mark-notification-sent", async (_event, sessionId: number) => {
  try {
    scheduledSessions.markNotificationSent(sessionId);
    return true;
  } catch (err) {
    return false;
  }
});
