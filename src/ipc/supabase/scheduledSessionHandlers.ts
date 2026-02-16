import { ipcMain } from "electron";
import * as scheduledSessions from "../../supabase/scheduledSessions";
import { getCurrentUser } from "../../supabase/api";
import type { ScheduledSessionData } from "../../supabase/scheduledSessions";

/**
 * Create a new scheduled session
 */
ipcMain.handle(
  "create-scheduled-session",
  async (_event, scheduledSession: ScheduledSessionData) => {
    try {
      // Get current authenticated user
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      return await scheduledSessions.createScheduledSession(
        user.id,
        scheduledSession,
      );
    } catch (err) {
      // Error creating scheduled session
      return null;
    }
  },
);

/**
 * Get scheduled sessions with optional filters
 */
ipcMain.handle(
  "get-scheduled-sessions",
  async (
    _event,
    filters?: {
      startDate?: string;
      endDate?: string;
      status?: Array<
        "pending" | "notified" | "completed" | "missed" | "cancelled"
      >;
      projectId?: number | string;
      includeRecurring?: boolean;
    },
  ) => {
    try {
      // Get current authenticated user
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      // Convert filters to Supabase format
      const supabaseFilters: any = {};

      if (filters) {
        if (filters.startDate) supabaseFilters.startDate = filters.startDate;
        if (filters.endDate) supabaseFilters.endDate = filters.endDate;
        if (filters.status) supabaseFilters.status = filters.status;
        if (filters.projectId) {
          supabaseFilters.projectId = String(filters.projectId);
        }
        // Note: includeRecurring is not yet implemented in Supabase API
      }

      return await scheduledSessions.getScheduledSessions(
        user.id,
        supabaseFilters,
      );
    } catch (err) {
      // Error getting scheduled sessions
      return [];
    }
  },
);

/**
 * Update a scheduled session
 */
ipcMain.handle(
  "update-scheduled-session",
  async (
    _event,
    id: number | string,
    updates: Partial<ScheduledSessionData>,
  ) => {
    try {
      // Get current authenticated user
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      const sessionId = String(id);
      await scheduledSessions.updateScheduledSession(sessionId, updates);
      return true;
    } catch (err) {
      // Error updating scheduled session
      return false;
    }
  },
);

/**
 * Delete a scheduled session
 */
ipcMain.handle(
  "delete-scheduled-session",
  async (_event, id: number | string) => {
    try {
      // Get current authenticated user
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      const sessionId = String(id);
      await scheduledSessions.deleteScheduledSession(sessionId);
      return true;
    } catch (err) {
      // Error deleting scheduled session
      return false;
    }
  },
);

/**
 * Mark a scheduled session as completed
 */
ipcMain.handle(
  "mark-scheduled-session-completed",
  async (
    _event,
    scheduledSessionId: number | string,
    actualSessionId: number | string,
  ) => {
    try {
      // Get current authenticated user
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      const scheduledId = String(scheduledSessionId);
      const actualId = String(actualSessionId);

      await scheduledSessions.markScheduledSessionCompleted(
        scheduledId,
        actualId,
      );
      return true;
    } catch (err) {
      // Error marking session as completed
      return false;
    }
  },
);

/**
 * Get upcoming sessions that need notifications
 */
ipcMain.handle("get-upcoming-session-notifications", async (_event) => {
  try {
    // Get current authenticated user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    return await scheduledSessions.getUpcomingSessionNotifications(user.id);
  } catch (err) {
    // Error getting notifications
    return [];
  }
});

/**
 * Mark that a notification has been sent for a scheduled session
 */
ipcMain.handle(
  "mark-notification-sent",
  async (_event, sessionId: number | string) => {
    try {
      const sessionIdStr = String(sessionId);
      await scheduledSessions.markNotificationSent(sessionIdStr);
      return true;
    } catch (err) {
      // Error marking notification as sent
      return false;
    }
  },
);
