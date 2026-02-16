import { supabase } from "./config";
import type { Database } from "../types/database.types";
import { setSessionTagsByNames } from "./tags";

type SessionInsert =
  Database["public"]["Tables"]["time_tracking_sessions"]["Insert"];

/**
 * Start a new tracking session
 */
export async function startSession(
  userId: string,
  projectId?: string,
  description?: string,
) {
  const now = new Date().toISOString();

  const sessionData: SessionInsert = {
    user_id: userId,
    project_id: projectId || null,
    description: description || null,
    start_time: now,
    duration: 0,
    title: description || "Untitled Session",
    is_billable: false,
  };

  const { data, error } = await supabase
    .from("time_tracking_sessions")
    .insert(sessionData as any)
    .select()
    .single();

  if (error) {
    throw error;
  }
  return data;
}

/**
 * End a tracking session by calculating and updating its duration
 */
export async function endSession(sessionId: string) {
  // Get the session to calculate duration
  const { data: session, error: fetchError } = await supabase
    .from("time_tracking_sessions")
    .select("start_time")
    .eq("id", sessionId)
    .single();

  if (fetchError) {
    throw fetchError;
  }
  if (!session) {
    throw new Error("Session not found");
  }

  const now = new Date().toISOString();
  const startTime = new Date((session as any).start_time);
  const endTime = new Date(now);
  const durationSeconds = Math.floor(
    (endTime.getTime() - startTime.getTime()) / 1000,
  );

  const { data, error } = await (supabase as any)
    .from("time_tracking_sessions")
    .update({
      duration: durationSeconds,
      updated_at: now,
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
 * Get sessions with duration less than or equal to specified threshold
 * Useful for reviewing and cleaning up short/incomplete sessions
 */
export async function getSmallSessions(
  userId: string,
  maxDurationSeconds: number,
) {
  const { data, error } = await supabase
    .from("time_tracking_sessions")
    .select("*")
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
  // If tag filter is specified, first get sessions with that tag
  if (filters?.tag) {
    // Get the tag ID for the given tag name
    const { data: tagData, error: tagError } = await supabase
      .from("user_tags")
      .select("id")
      .eq("user_id", userId)
      .eq("name", filters.tag)
      .single();

    if (tagError || !tagData) {
      // Tag not found, return empty array
      return [];
    }

    // Get session IDs that have this tag
    const { data: sessionTagsData, error: sessionTagsError } = await supabase
      .from("session_tags")
      .select("session_id")
      .eq("tag_id", (tagData as any).id);

    if (sessionTagsError) {
      throw sessionTagsError;
    }

    const sessionIds = (sessionTagsData || []).map((st: any) => st.session_id);

    if (sessionIds.length === 0) {
      return [];
    }

    // Build query with session IDs filter
    let query = supabase
      .from("time_tracking_sessions")
      .select("*")
      .eq("user_id", userId)
      .in("id", sessionIds)
      .order("start_time", { ascending: false });

    // Apply other filters
    if (filters?.projectId) {
      query = query.eq("project_id", filters.projectId);
    }
    if (filters?.startDate) {
      query = query.gte("start_time", filters.startDate);
    }
    if (filters?.endDate) {
      query = query.lte("start_time", filters.endDate);
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

  // No tag filter - proceed with regular query
  let query = supabase
    .from("time_tracking_sessions")
    .select("*")
    .eq("user_id", userId)
    .order("start_time", { ascending: false });

  // Apply filters
  if (filters?.projectId) {
    query = query.eq("project_id", filters.projectId);
  }
  if (filters?.startDate) {
    query = query.gte("start_time", filters.startDate);
  }
  if (filters?.endDate) {
    query = query.lte("start_time", filters.endDate);
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
    .select("*")
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
 * Used for adding sessions with known duration and details
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
) {
  const sessionData: SessionInsert = {
    user_id: userId,
    start_time: startTime,
    duration,
    title,
    description: description || null,
    project_id: projectId || null,
    is_billable: isBillable,
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
    .select("*")
    .eq("user_id", userId)
    .gte("start_time", startDate)
    .lte("start_time", endDate)
    .order("start_time", { ascending: false });

  if (error) {
    throw error;
  }
  return data || [];
}
