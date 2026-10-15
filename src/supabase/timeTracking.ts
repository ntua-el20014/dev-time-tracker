import { supabase } from "./config";
import type { Database } from "../types/database.types";
import { setSessionTagsByNames } from "./tags";
import { localDayStartISO, localDayEndISO } from "../utils/timeFormat";
import type { RepoCodeStats } from "../../shared/codeStats";

type SessionInsert =
  Database["public"]["Tables"]["time_tracking_sessions"]["Insert"];

/** Part of a session spent supervising an AI agent (no input, agent busy). */
export interface SupervisingTime {
  seconds: number;
  /** [start, end] ISO timestamps */
  spans: [string, string][];
}

const SESSION_COLUMNS =
  "id, title, description, start_time, end_time, duration, project_id, is_billable, supervising_seconds, supervising_spans, code_stats, created_at";

/**
 * Get sessions with duration less than or equal to specified threshold
 * Useful for reviewing and cleaning up short/incomplete sessions
 */
export async function getSmallSessions(
  userId: string,
  maxDurationSeconds: number,
) {
  const { data, error } = await supabase
    .from("time_tracking_sessions")
    .select(SESSION_COLUMNS)
    .eq("user_id", userId)
    .lte("duration", maxDurationSeconds)
    .order("start_time", { ascending: false });

  if (error) {
    throw error;
  }
  return data || [];
}

/**
 * Delete multiple sessions by IDs
 * Used for batch cleanup from review panel
 */
export async function deleteSessions(sessionIds: string[]) {
  const { error } = await supabase
    .from("time_tracking_sessions")
    .delete()
    .in("id", sessionIds);

  if (error) {
    throw error;
  }
}

/**
 * Session IDs carrying the given tag, or null if the user has no such tag.
 */
async function getSessionIdsForTag(
  userId: string,
  tagName: string,
): Promise<string[] | null> {
  const { data: tagData, error: tagError } = await supabase
    .from("user_tags")
    .select("id")
    .eq("user_id", userId)
    .eq("name", tagName)
    .single();

  if (tagError || !tagData) {
    return null;
  }

  const { data: sessionTagsData, error: sessionTagsError } = await supabase
    .from("session_tags")
    .select("session_id")
    .eq("tag_id", (tagData as any).id);

  if (sessionTagsError) {
    throw sessionTagsError;
  }
  return (sessionTagsData || []).map((st: any) => st.session_id);
}

/**
 * Get all sessions for a user with optional filters
 */
export async function getAllSessions(
  userId: string,
  filters?: {
    projectId?: string;
    startDate?: string;
    endDate?: string;
    isBillable?: boolean;
    tag?: string;
    limit?: number;
    offset?: number;
  },
) {
  // A tag filter narrows the query to that tag's sessions
  let taggedSessionIds: string[] | null = null;
  if (filters?.tag) {
    taggedSessionIds = await getSessionIdsForTag(userId, filters.tag);
    if (!taggedSessionIds || taggedSessionIds.length === 0) {
      return [];
    }
  }

  let query = supabase
    .from("time_tracking_sessions")
    .select(SESSION_COLUMNS)
    .eq("user_id", userId);

  if (taggedSessionIds) {
    query = query.in("id", taggedSessionIds);
  }
  query = query.order("start_time", { ascending: false });

  if (filters?.projectId) {
    query = query.eq("project_id", filters.projectId);
  }
  if (filters?.startDate) {
    query = query.gte("start_time", localDayStartISO(filters.startDate));
  }
  if (filters?.endDate) {
    query = query.lte("start_time", localDayEndISO(filters.endDate));
  }
  if (filters?.isBillable !== undefined) {
    query = query.eq("is_billable", filters.isBillable);
  }
  if (filters?.limit) {
    query = query.limit(filters.limit);
  }
  if (filters?.offset) {
    query = query.range(
      filters.offset,
      filters.offset + (filters.limit || 50) - 1,
    );
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }
  return data || [];
}

/**
 * Get a specific session by ID
 */
export async function getSessionById(sessionId: string) {
  const { data, error } = await supabase
    .from("time_tracking_sessions")
    .select(SESSION_COLUMNS)
    .eq("id", sessionId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null; // Not found
    }
    throw error;
  }
  return data;
}

/**
 * Update a session
 */
export async function updateSession(
  sessionId: string,
  updates: {
    title?: string;
    description?: string;
    project_id?: string | null;
    is_billable?: boolean;
    duration?: number;
  },
) {
  const { data, error } = await (supabase as any)
    .from("time_tracking_sessions")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .select()
    .single();

  if (error) {
    throw error;
  }
  return data;
}

/**
 * Delete a single session
 */
export async function deleteSession(sessionId: string) {
  const { error } = await supabase
    .from("time_tracking_sessions")
    .delete()
    .eq("id", sessionId);

  if (error) {
    throw error;
  }
}

/**
 * Add a completed session (retrospectively)
 * Used for adding sessions with known duration and details.
 *
 * `duration` is active time (pauses excluded); `endTime` is the wall-clock end.
 * Requires DB patch 007 — before it, the duration trigger would overwrite
 * `duration` with end_time - start_time whenever end_time is set.
 */
export async function addSession(
  userId: string,
  startTime: string,
  duration: number,
  title: string,
  description?: string,
  tags?: string[],
  projectId?: string,
  isBillable: boolean = false,
  endTime?: string,
  supervising?: SupervisingTime,
  codeStats?: RepoCodeStats[],
) {
  const sessionData: SessionInsert = {
    user_id: userId,
    start_time: startTime,
    end_time: endTime || null,
    duration,
    title,
    description: description || null,
    project_id: projectId || null,
    is_billable: isBillable,
    supervising_seconds: supervising?.seconds ?? 0,
    supervising_spans: supervising?.spans ?? [],
    code_stats: codeStats ?? [],
  };

  const { data, error } = await supabase
    .from("time_tracking_sessions")
    .insert(sessionData as any)
    .select()
    .single();

  if (error) {
    throw error;
  }

  // If tags provided, set them
  if (tags && tags.length > 0 && data) {
    await setSessionTagsByNames(userId, (data as any).id, tags);
  }

  return data;
}

/**
 * Get sessions within a date range
 */
export async function getSessionsInDateRange(
  userId: string,
  startDate: string,
  endDate: string,
) {
  const { data, error } = await supabase
    .from("time_tracking_sessions")
    .select(SESSION_COLUMNS)
    .eq("user_id", userId)
    .gte("start_time", localDayStartISO(startDate))
    .lte("start_time", localDayEndISO(endDate))
    .order("start_time", { ascending: false });

  if (error) {
    throw error;
  }
  return data || [];
}
