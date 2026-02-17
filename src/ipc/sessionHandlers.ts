import { ipcMain } from "electron";
import * as timeTracking from "../supabase/timeTracking";
import * as tags from "../supabase/tags";
import { getCurrentUser } from "../supabase/api";
import { supabase } from "../supabase/config";
import { logError } from "../utils/errorHandler";

/**
 * Enrich raw Supabase session rows with derived fields the renderer expects:
 * - date (from start_time)
 * - tags (from session_tags join)
 * - project_name / project_color (from cloud_projects)
 */
async function enrichSessions(rawSessions: any[]): Promise<any[]> {
  if (rawSessions.length === 0) return [];

  const sessionIds = rawSessions.map((s) => s.id);

  // Batch-fetch tags for all sessions
  const { data: sessionTagsData } = await supabase
    .from("session_tags")
    .select("session_id, user_tags(name, color)")
    .in("session_id", sessionIds);

  const tagsBySession: Record<string, string[]> = {};
  for (const st of sessionTagsData || []) {
    const sid = (st as any).session_id;
    const tagName = (st as any).user_tags?.name;
    if (tagName) {
      if (!tagsBySession[sid]) tagsBySession[sid] = [];
      tagsBySession[sid].push(tagName);
    }
  }

  // Batch-fetch projects for sessions that have a project_id
  const projectIds = [
    ...new Set(rawSessions.map((s) => s.project_id).filter(Boolean)),
  ];
  const projectMap: Record<string, { name: string; color: string }> = {};
  if (projectIds.length > 0) {
    const { data: projects } = await supabase
      .from("cloud_projects")
      .select("id, name, color")
      .in("id", projectIds);
    for (const p of projects || []) {
      projectMap[(p as any).id] = {
        name: (p as any).name,
        color: (p as any).color,
      };
    }
  }

  return rawSessions.map((s) => ({
    ...s,
    date: s.start_time ? s.start_time.split("T")[0] : null,
    tags: tagsBySession[s.id] || [],
    project_name: s.project_id ? projectMap[s.project_id]?.name : null,
    project_color: s.project_id ? projectMap[s.project_id]?.color : null,
  }));
}

/**
 * Get all sessions for the current user with optional filters
 */
ipcMain.handle(
  "get-sessions",
  async (
    _event,
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

      const rawSessions = await timeTracking.getAllSessions(
        user.id,
        supabaseFilters,
      );
      return await enrichSessions(rawSessions);
    } catch (err) {
      logError("get-sessions", err);
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
      id,
      title,
      description,
      tags: tagNames,
      projectId,
      isBillable,
    }: {
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
      logError("edit-session", err);
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
    logError("delete-session", err);
    return false;
  }
});

/**
 * Get small/short sessions below a duration threshold
 * Used by the Session Review Panel for cleanup
 */
ipcMain.handle(
  "get-small-sessions",
  async (_event, maxDurationSeconds: number) => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }
      return await enrichSessions(
        await timeTracking.getSmallSessions(user.id, maxDurationSeconds),
      );
    } catch (err) {
      logError("get-small-sessions", err);
      return [];
    }
  },
);

/**
 * Delete multiple sessions by IDs (batch cleanup)
 */
ipcMain.handle(
  "delete-sessions",
  async (_event, sessionIds: (string | number)[]) => {
    try {
      const ids = sessionIds.map(String);
      await timeTracking.deleteSessions(ids);
      return true;
    } catch (err) {
      logError("delete-sessions", err);
      return false;
    }
  },
);
