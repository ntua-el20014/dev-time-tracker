import { supabase } from "./config";
import { Database } from "../types/database.types";

type ScheduledSessionInsert =
  Database["public"]["Tables"]["scheduled_work_sessions"]["Insert"];
type ScheduledSessionUpdate =
  Database["public"]["Tables"]["scheduled_work_sessions"]["Update"];

export interface ScheduledSessionData {
  title: string;
  description?: string | null;
  scheduled_datetime: string;
  estimated_duration_minutes?: number | null;
  project_id?: string | null;
  org_id?: string | null;
  recurrence_type?: "none" | "weekly";
  recurrence_data?: any;
  status?: "pending" | "notified" | "completed" | "missed" | "cancelled";
  tags?: string[]; // Tag names
}

export interface ScheduledSessionNotification {
  id: string;
  title: string;
  scheduled_datetime: string;
  estimated_duration_minutes: number | null;
  type: "day_before" | "same_day" | "time_to_start";
  tags: string[];
}

/**
 * Create a new scheduled session.
 */
export async function createScheduledSession(
  userId: string,
  sessionData: ScheduledSessionData,
) {
  const { tags, ...sessionFields } = sessionData;

  const insertData: ScheduledSessionInsert = {
    user_id: userId,
    title: sessionFields.title,
    description: sessionFields.description || null,
    scheduled_datetime: sessionFields.scheduled_datetime,
    estimated_duration_minutes:
      sessionFields.estimated_duration_minutes || null,
    project_id: sessionFields.project_id || null,
    org_id: sessionFields.org_id || null,
    recurrence_type: sessionFields.recurrence_type || "none",
    recurrence_data: sessionFields.recurrence_data || null,
    status: sessionFields.status || "pending",
  };

  const { data, error } = await (supabase as any)
    .from("scheduled_work_sessions")
    .insert(insertData)
    .select()
    .single();

  if (error) {
    throw error;
  }

  // Handle tags if provided
  if (tags && tags.length > 0) {
    await setScheduledSessionTags(userId, data.id, tags);
  }

  return data;
}

/**
 * Get scheduled sessions with optional filters.
 */
export async function getScheduledSessions(
  userId: string,
  filters?: {
    startDate?: string;
    endDate?: string;
    status?: Array<
      "pending" | "notified" | "completed" | "missed" | "cancelled"
    >;
    projectId?: string;
  },
) {
  let query = supabase
    .from("scheduled_work_sessions")
    .select(
      `
      *,
      scheduled_session_tags (
        tag_id,
        user_tags (
          name
        )
      )
    `,
    )
    .eq("user_id", userId);

  if (filters?.startDate) {
    query = query.gte("scheduled_datetime", filters.startDate);
  }
  if (filters?.endDate) {
    query = query.lte("scheduled_datetime", filters.endDate);
  }
  if (filters?.status && filters.status.length > 0) {
    query = query.in("status", filters.status);
  }
  if (filters?.projectId) {
    query = query.eq("project_id", filters.projectId);
  }

  query = query.order("scheduled_datetime", { ascending: true });

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  // Transform data to include tag names
  return (data || []).map((session: any) => {
    const { scheduled_session_tags, ...sessionData } = session;
    const tags = scheduled_session_tags
      .map((st: any) => st.user_tags?.name)
      .filter(Boolean);

    return {
      ...sessionData,
      tags,
    };
  });
}

/**
 * Update a scheduled session.
 */
export async function updateScheduledSession(
  sessionId: string,
  updates: Partial<Omit<ScheduledSessionData, "tags"> & { tags?: string[] }>,
) {
  const { tags, ...sessionUpdates } = updates;

  const updateData: ScheduledSessionUpdate = {};

  if (sessionUpdates.title !== undefined) {
    updateData.title = sessionUpdates.title;
  }
  if (sessionUpdates.description !== undefined) {
    updateData.description = sessionUpdates.description;
  }
  if (sessionUpdates.scheduled_datetime !== undefined) {
    updateData.scheduled_datetime = sessionUpdates.scheduled_datetime;
  }
  if (sessionUpdates.estimated_duration_minutes !== undefined) {
    updateData.estimated_duration_minutes =
      sessionUpdates.estimated_duration_minutes;
  }
  if (sessionUpdates.project_id !== undefined) {
    updateData.project_id = sessionUpdates.project_id;
  }
  if (sessionUpdates.org_id !== undefined) {
    updateData.org_id = sessionUpdates.org_id;
  }
  if (sessionUpdates.status !== undefined) {
    updateData.status = sessionUpdates.status;
  }
  if (sessionUpdates.recurrence_type !== undefined) {
    updateData.recurrence_type = sessionUpdates.recurrence_type;
  }
  if (sessionUpdates.recurrence_data !== undefined) {
    updateData.recurrence_data = sessionUpdates.recurrence_data;
  }

  updateData.updated_at = new Date().toISOString();

  const { data, error } = await (supabase as any)
    .from("scheduled_work_sessions")
    .update(updateData)
    .eq("id", sessionId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  // Update tags if provided
  if (tags !== undefined) {
    // Get user_id from the session
    const { data: session } = await supabase
      .from("scheduled_work_sessions")
      .select("user_id")
      .eq("id", sessionId)
      .single();

    if (session) {
      await setScheduledSessionTags(session.user_id, sessionId, tags);
    }
  }

  return data;
}

/**
 * Delete a scheduled session.
 */
export async function deleteScheduledSession(sessionId: string) {
  const { error } = await supabase
    .from("scheduled_work_sessions")
    .delete()
    .eq("id", sessionId);

  if (error) {
    throw error;
  }
}

/**
 * Mark a scheduled session as completed and link it to the actual session.
 */
export async function markScheduledSessionCompleted(
  sessionId: string,
  actualSessionId: string,
) {
  const { data, error } = await (supabase as any)
    .from("scheduled_work_sessions")
    .update({
      status: "completed",
      actual_session_id: actualSessionId,
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
 * Get upcoming sessions that need notifications.
 * Returns sessions that are:
 * - Day before: scheduled for tomorrow (more than 2 hours away)
 * - Same day: scheduled within next 2 hours (not notified in last 30 min)
 * - Time to start: scheduled within next 5 minutes (not notified in last 2 min)
 */
export async function getUpcomingSessionNotifications(
  userId: string,
): Promise<ScheduledSessionNotification[]> {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const tomorrowStart = new Date(tomorrow);
  tomorrowStart.setHours(0, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrow);
  tomorrowEnd.setHours(23, 59, 59, 999);

  // Get sessions scheduled for tomorrow (day-before notification)
  const { data: tomorrowSessions, error: tomorrowError } = await supabase
    .from("scheduled_work_sessions")
    .select(
      `
      *,
      scheduled_session_tags (
        tag_id,
        user_tags (
          name
        )
      )
    `,
    )
    .eq("user_id", userId)
    .eq("status", "pending")
    .gte("scheduled_datetime", tomorrowStart.toISOString())
    .lte("scheduled_datetime", tomorrowEnd.toISOString())
    .or(
      `last_notification_sent.is.null,last_notification_sent.lt.${now.toISOString().split("T")[0]}`,
    );

  if (tomorrowError) {
    throw tomorrowError;
  }

  // Get sessions scheduled for today (same-day notification)
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const { data: todaySessions, error: todayError } = await supabase
    .from("scheduled_work_sessions")
    .select(
      `
      *,
      scheduled_session_tags (
        tag_id,
        user_tags (
          name
        )
      )
    `,
    )
    .eq("user_id", userId)
    .eq("status", "pending")
    .gte("scheduled_datetime", todayStart.toISOString())
    .lte("scheduled_datetime", todayEnd.toISOString());

  if (todayError) {
    throw todayError;
  }

  const notifications: ScheduledSessionNotification[] = [];

  // Day-before notifications (sessions more than 2 hours away)
  (tomorrowSessions || []).forEach((session: any) => {
    const sessionTime = new Date(session.scheduled_datetime);
    const timeDiff = sessionTime.getTime() - now.getTime();
    const hoursUntil = timeDiff / (1000 * 60 * 60);

    if (hoursUntil > 2) {
      notifications.push({
        id: session.id,
        title: session.title,
        scheduled_datetime: session.scheduled_datetime,
        estimated_duration_minutes: session.estimated_duration_minutes,
        type: "day_before",
        tags:
          session.scheduled_session_tags
            ?.map((st: any) => st.user_tags?.name)
            .filter(Boolean) || [],
      });
    }
  });

  // Same-day notifications
  (todaySessions || []).forEach((session: any) => {
    const sessionTime = new Date(session.scheduled_datetime);
    const timeDiff = sessionTime.getTime() - now.getTime();
    const hoursUntil = timeDiff / (1000 * 60 * 60);
    const lastNotificationSent = session.last_notification_sent
      ? new Date(session.last_notification_sent)
      : null;

    const timeSinceLastNotification = lastNotificationSent
      ? (now.getTime() - lastNotificationSent.getTime()) / (1000 * 60)
      : Infinity;

    const tags =
      session.scheduled_session_tags
        ?.map((st: any) => st.user_tags?.name)
        .filter(Boolean) || [];

    // Notify if session is in the next 2 hours (but not if notified in last 30 min)
    if (hoursUntil <= 2 && hoursUntil > 0 && timeSinceLastNotification > 30) {
      notifications.push({
        id: session.id,
        title: session.title,
        scheduled_datetime: session.scheduled_datetime,
        estimated_duration_minutes: session.estimated_duration_minutes,
        type: "same_day",
        tags,
      });
    }

    // Notify if it's time to start (within 5 minutes, not if notified in last 2 min)
    if (
      hoursUntil <= 5 / 60 &&
      hoursUntil > -(5 / 60) &&
      timeSinceLastNotification > 2
    ) {
      notifications.push({
        id: session.id,
        title: session.title,
        scheduled_datetime: session.scheduled_datetime,
        estimated_duration_minutes: session.estimated_duration_minutes,
        type: "time_to_start",
        tags,
      });
    }
  });

  return notifications;
}

/**
 * Helper function to set tags for a scheduled session.
 */
async function setScheduledSessionTags(
  userId: string,
  sessionId: string,
  tagNames: string[],
) {
  // First, delete existing tags for this scheduled session
  await supabase
    .from("scheduled_session_tags")
    .delete()
    .eq("scheduled_session_id", sessionId);

  if (tagNames.length === 0) return;

  // Get or create tags
  const tagIds: string[] = [];

  for (const tagName of tagNames) {
    // Try to get existing tag
    const { data: existingTag } = await supabase
      .from("user_tags")
      .select("id")
      .eq("user_id", userId)
      .eq("name", tagName)
      .single();

    if (existingTag) {
      tagIds.push(existingTag.id);
    } else {
      // Create new tag
      const { data: newTag, error } = await (supabase as any)
        .from("user_tags")
        .insert({
          user_id: userId,
          name: tagName,
          color: "#808080", // Default gray color
        })
        .select()
        .single();

      if (error) {
        // If error is duplicate (23505), try to fetch it again
        if (error.code === "23505") {
          const { data: retryTag } = await supabase
            .from("user_tags")
            .select("id")
            .eq("user_id", userId)
            .eq("name", tagName)
            .single();

          if (retryTag) {
            tagIds.push(retryTag.id);
          }
        } else {
          throw error;
        }
      } else if (newTag) {
        tagIds.push(newTag.id);
      }
    }
  }

  // Insert tag associations
  if (tagIds.length > 0) {
    const tagAssociations = tagIds.map((tagId) => ({
      scheduled_session_id: sessionId,
      tag_id: tagId,
    }));

    const { error } = await supabase
      .from("scheduled_session_tags")
      .insert(tagAssociations);

    if (error) {
      throw error;
    }
  }
}

/**
 * Mark that a notification has been sent for a scheduled session.
 */
export async function markNotificationSent(sessionId: string) {
  const { error } = await supabase
    .from("scheduled_work_sessions")
    .update({
      last_notification_sent: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (error) {
    throw error;
  }
}
