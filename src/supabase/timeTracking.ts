import { supabase } from "./config";
import type { Database } from "../types/database.types";
import { setSessionTagsByNames } from "./tags";
import { localDayStartISO, localDayEndISO } from "../utils/timeFormat";
import type { RepoCodeStats } from "../../shared/codeStats";
import type { AppUsageEntry } from "../../shared/appUsage";
import type { DraftRow, MergedDraft } from "../../shared/drafts";

type SessionInsert =
  Database["public"]["Tables"]["time_tracking_sessions"]["Insert"];

/** Part of a session spent supervising an AI agent (no input, agent busy). */
export interface SupervisingTime {
  seconds: number;
  /** [start, end] ISO timestamps */
  spans: [string, string][];
}

/**
 * Session lists show confirmed sessions only. Drafts (always-on segments,
 * Phase D) wait in the review inbox until the user confirms them.
 */
const CONFIRMED = "confirmed";

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
    .eq("status", CONFIRMED)
    .lte("duration", maxDurationSeconds)
    .order("start_time", { ascending: false });

  if (error) {
    throw error;
  }
  return data || [];
}

/**
 * Delete some of the user's confirmed sessions (batch cleanup from the
 * review panel). Drafts go through the inbox, which settles them first.
 */
export async function deleteSessions(userId: string, sessionIds: string[]) {
  const { error } = await supabase
    .from("time_tracking_sessions")
    .delete()
    .eq("user_id", userId)
    .eq("status", CONFIRMED)
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
    .eq("user_id", userId)
    .eq("status", CONFIRMED);

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
 * Update one of the user's confirmed sessions. Returns the row, or null if
 * there is no such session (drafts are edited by confirming them).
 */
export async function updateSession(
  userId: string,
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
    .eq("user_id", userId)
    .eq("status", CONFIRMED)
    .select();

  if (error) {
    throw error;
  }
  return Array.isArray(data) ? (data[0] ?? null) : null;
}

/**
 * Delete one of the user's confirmed sessions
 */
export async function deleteSession(userId: string, sessionId: string) {
  const { error } = await supabase
    .from("time_tracking_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("user_id", userId)
    .eq("status", CONFIRMED);

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
  appUsage?: AppUsageEntry[],
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
    app_usage: appUsage ?? [],
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
    .eq("status", CONFIRMED)
    .gte("start_time", localDayStartISO(startDate))
    .lte("start_time", localDayEndISO(endDate))
    .order("start_time", { ascending: false });

  if (error) {
    throw error;
  }
  return data || [];
}

/** An always-on segment, saved as a draft while it grows and when it ends. */
export interface DraftSessionData {
  /** Chosen on the device; one row per segment */
  clientId: string;
  startTime: string;
  endTime: string;
  duration: number;
  title: string | null;
  projectId: string | null;
  supervising: SupervisingTime;
  appUsage: AppUsageEntry[];
  /** Only once the segment has ended (git runs then); left as is otherwise */
  codeStats?: RepoCodeStats[];
}

/**
 * Create or update the draft of an always-on segment (keyed by its
 * client_id). A row the user already confirmed is never touched: then
 * nothing is written and "confirmed" is returned.
 */
export async function saveDraftSession(
  userId: string,
  draft: DraftSessionData,
): Promise<"saved" | "confirmed"> {
  const fields = {
    start_time: draft.startTime,
    end_time: draft.endTime,
    duration: draft.duration,
    title: draft.title,
    project_id: draft.projectId,
    supervising_seconds: draft.supervising.seconds,
    supervising_spans: draft.supervising.spans,
    app_usage: draft.appUsage,
    ...(draft.codeStats ? { code_stats: draft.codeStats } : {}),
  };

  // Usually the row exists already (the segment grew since the last save)
  const { data: updated, error: updateError } = await (supabase as any)
    .from("time_tracking_sessions")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("client_id", draft.clientId)
    .eq("status", "draft")
    .select("id");
  if (updateError) throw updateError;
  if (Array.isArray(updated) && updated.length > 0) return "saved";

  const row: SessionInsert = {
    user_id: userId,
    client_id: draft.clientId,
    status: "draft",
    source: "auto",
    is_billable: false,
    code_stats: [],
    ...fields,
  };
  const { error } = await supabase
    .from("time_tracking_sessions")
    .insert(row as any);
  if (error) {
    // The row exists but isn't a draft any more: the user confirmed it
    if ((error as { code?: string }).code === "23505") return "confirmed";
    throw error;
  }
  return "saved";
}

const DRAFT_COLUMNS =
  "id, client_id, title, start_time, end_time, duration, project_id, supervising_seconds, supervising_spans, code_stats, app_usage";

/**
 * The user's drafts (the review inbox), newest first; optionally only those
 * starting within some local days (YYYY-MM-DD, inclusive), like sessions.
 */
export async function getDraftSessions(
  userId: string,
  range?: { startDate: string; endDate: string },
): Promise<DraftRow[]> {
  let query = supabase
    .from("time_tracking_sessions")
    .select(DRAFT_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "draft");
  if (range) {
    query = query
      .gte("start_time", localDayStartISO(range.startDate))
      .lte("start_time", localDayEndISO(range.endDate));
  }
  const { data, error } = await query.order("start_time", { ascending: false });
  if (error) throw error;
  return (data as DraftRow[] | null) || [];
}

/** Some of the user's drafts, by id (others' rows and confirmed ones are left out). */
export async function getDraftSessionsByIds(
  userId: string,
  ids: string[],
): Promise<DraftRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("time_tracking_sessions")
    .select(DRAFT_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "draft")
    .in("id", ids);
  if (error) throw error;
  return (data as DraftRow[] | null) || [];
}

export async function countDraftSessions(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("time_tracking_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "draft");
  if (error) throw error;
  return count ?? 0;
}

/**
 * Turn a draft into a confirmed session. Returns false if it isn't (any
 * more) one of the user's drafts.
 */
export async function confirmDraftSession(
  userId: string,
  id: string,
  details: {
    title: string;
    description: string | null;
    projectId: string | null;
    isBillable: boolean;
  },
): Promise<boolean> {
  const { data, error } = await (supabase as any)
    .from("time_tracking_sessions")
    .update({
      status: "confirmed",
      title: details.title,
      description: details.description,
      project_id: details.projectId,
      is_billable: details.isBillable,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("status", "draft")
    .select("id");
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

/** Overwrite a draft's contents (merging). Confirmed rows are left alone. */
export async function updateDraftSession(
  userId: string,
  id: string,
  fields: MergedDraft["fields"],
): Promise<boolean> {
  const { data, error } = await (supabase as any)
    .from("time_tracking_sessions")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("status", "draft")
    .select("id");
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

/** Delete some of the user's drafts. Confirmed sessions are never deleted here. */
export async function deleteDraftSessions(userId: string, ids: string[]) {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from("time_tracking_sessions")
    .delete()
    .eq("user_id", userId)
    .eq("status", "draft")
    .in("id", ids);
  if (error) throw error;
}
