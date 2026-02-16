import { ipcMain } from "electron";
import * as timeTracking from "../../supabase/timeTracking";
import * as tags from "../../supabase/tags";
import { getCurrentUser } from "../../supabase/api";

/**
 * Get all sessions for the current user with optional filters
 */
ipcMain.handle(
  "get-sessions",
  async (
    _event,
    _userId: number | string, // Accept both for transition compatibility
    filters?: {
      tag?: string;
      startDate?: string;
      endDate?: string;
      projectId?: number | string;
      billableOnly?: boolean;
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
        if (filters.tag) supabaseFilters.tag = filters.tag;
        if (filters.startDate) supabaseFilters.startDate = filters.startDate;
        if (filters.endDate) supabaseFilters.endDate = filters.endDate;
        if (filters.projectId) {
          // Convert to string if it's a number
          supabaseFilters.projectId = String(filters.projectId);
        }
        if (filters.billableOnly !== undefined) {
          supabaseFilters.isBillable = filters.billableOnly;
        }
      }

      return await timeTracking.getAllSessions(user.id, supabaseFilters);
    } catch (err) {
      // Error getting sessions - return empty array
      return [];
    }
  },
);

/**
 * Edit/update a session
 */
ipcMain.handle(
  "edit-session",
  async (
    _event,
    {
      userId: _userId,
      id,
      title,
      description,
      tags: tagNames,
      projectId,
      isBillable,
    }: {
      userId: number | string;
      id: string | number;
      title?: string;
      description?: string;
      tags?: string[];
      projectId?: number | string | null;
      isBillable?: boolean;
    },
  ) => {
    try {
      // Get current authenticated user
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      const sessionId = String(id);

      // Update session fields
      const updates: any = {};
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (projectId !== undefined) {
        updates.project_id = projectId ? String(projectId) : null;
      }
      if (isBillable !== undefined) updates.is_billable = isBillable;

      if (Object.keys(updates).length > 0) {
        await timeTracking.updateSession(sessionId, updates);
      }

      // Update tags if provided
      if (tagNames && Array.isArray(tagNames)) {
        await tags.setSessionTagsByNames(user.id, sessionId, tagNames);
      }

      return true;
    } catch (err) {
      // Error editing session
      return false;
    }
  },
);

/**
 * Delete a session
 */
ipcMain.handle("delete-session", async (_event, id: string | number) => {
  try {
    const sessionId = String(id);
    await timeTracking.deleteSession(sessionId);
    return true;
  } catch (err) {
    // Error deleting session
    return false;
  }
});
