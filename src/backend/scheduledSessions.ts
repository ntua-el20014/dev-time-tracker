import db from "./db";
import { ScheduledSession, ScheduledSessionNotification } from "@shared/types";

export function createScheduledSession(
  scheduledSession: Omit<ScheduledSession, "id" | "created_at">
): number {
  const stmt = db.prepare(`
    INSERT INTO scheduled_sessions 
    (user_id, title, description, scheduled_datetime, estimated_duration, 
     recurrence_type, recurrence_data, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    scheduledSession.user_id,
    scheduledSession.title,
    scheduledSession.description || null,
    scheduledSession.scheduled_datetime,
    scheduledSession.estimated_duration || null,
    scheduledSession.recurrence_type,
    scheduledSession.recurrence_data
      ? JSON.stringify(scheduledSession.recurrence_data)
      : null,
    scheduledSession.status
  );

  const sessionId = result.lastInsertRowid as number;

  // Handle tags if provided
  if (scheduledSession.tags && scheduledSession.tags.length > 0) {
    setScheduledSessionTags(
      scheduledSession.user_id,
      sessionId,
      scheduledSession.tags
    );
  }

  // Generate recurring sessions if needed
  if (
    scheduledSession.recurrence_type === "weekly" &&
    scheduledSession.recurrence_data
  ) {
    generateRecurringInstances(sessionId, scheduledSession);
  }

  return sessionId;
}

export function getScheduledSessions(
  userId: number,
  filters?: {
    startDate?: string;
    endDate?: string;
    status?: ScheduledSession["status"][];
    includeRecurring?: boolean;
  }
): ScheduledSession[] {
  let query = `
    SELECT 
      ss.id, ss.user_id, ss.title, ss.description, ss.scheduled_datetime,
      ss.estimated_duration, ss.recurrence_type, ss.recurrence_data, ss.status,
      ss.created_at, ss.last_notification_sent, ss.actual_session_id,
      GROUP_CONCAT(t.name, ',') as tag_names
    FROM scheduled_sessions ss
    LEFT JOIN scheduled_session_tags sst ON ss.id = sst.scheduled_session_id
    LEFT JOIN tags t ON sst.tag_id = t.id
    WHERE ss.user_id = ?
  `;

  const params: any[] = [userId];

  if (filters?.startDate) {
    query += " AND date(ss.scheduled_datetime) >= date(?)";
    params.push(filters.startDate);
  }
  if (filters?.endDate) {
    query += " AND date(ss.scheduled_datetime) <= date(?)";
    params.push(filters.endDate);
  }
  if (filters?.status && filters.status.length > 0) {
    const placeholders = filters.status.map(() => "?").join(",");
    query += ` AND ss.status IN (${placeholders})`;
    params.push(...filters.status);
  }

  query += " GROUP BY ss.id ORDER BY ss.scheduled_datetime ASC";

  const sessions = db.prepare(query).all(...params) as (ScheduledSession & {
    tag_names: string;
  })[];

  return sessions.map((session) => {
    const { tag_names, recurrence_data, ...rest } = session;
    return {
      ...rest,
      tags: tag_names ? tag_names.split(",").filter(Boolean) : [],
      recurrence_data: recurrence_data
        ? JSON.parse(recurrence_data as string)
        : undefined,
    };
  });
}

export function updateScheduledSession(
  userId: number,
  id: number,
  updates: Partial<Omit<ScheduledSession, "id" | "user_id" | "created_at">>
): boolean {
  try {
    const setClause = [];
    const params = [];

    if (updates.title !== undefined) {
      setClause.push("title = ?");
      params.push(updates.title);
    }
    if (updates.description !== undefined) {
      setClause.push("description = ?");
      params.push(updates.description);
    }
    if (updates.scheduled_datetime !== undefined) {
      setClause.push("scheduled_datetime = ?");
      params.push(updates.scheduled_datetime);
    }
    if (updates.estimated_duration !== undefined) {
      setClause.push("estimated_duration = ?");
      params.push(updates.estimated_duration);
    }
    if (updates.status !== undefined) {
      setClause.push("status = ?");
      params.push(updates.status);
    }
    if (updates.last_notification_sent !== undefined) {
      setClause.push("last_notification_sent = ?");
      params.push(updates.last_notification_sent);
    }
    if (updates.actual_session_id !== undefined) {
      setClause.push("actual_session_id = ?");
      params.push(updates.actual_session_id);
    }

    if (setClause.length === 0) return false;

    params.push(userId, id);

    const stmt = db.prepare(`
      UPDATE scheduled_sessions 
      SET ${setClause.join(", ")}
      WHERE user_id = ? AND id = ?
    `);

    const result = stmt.run(...params);

    // Update tags if provided
    if (updates.tags !== undefined) {
      setScheduledSessionTags(userId, id, updates.tags);
    }

    return result.changes > 0;
  } catch (err) {
    // Handle update error silently
    return false;
  }
}

export function deleteScheduledSession(userId: number, id: number): boolean {
  try {
    const stmt = db.prepare(
      "DELETE FROM scheduled_sessions WHERE user_id = ? AND id = ?"
    );
    const result = stmt.run(userId, id);
    return result.changes > 0;
  } catch (err) {
    // Handle delete error silently
    return false;
  }
}

export function markScheduledSessionCompleted(
  userId: number,
  scheduledSessionId: number,
  actualSessionId: number
): boolean {
  return updateScheduledSession(userId, scheduledSessionId, {
    status: "completed",
    actual_session_id: actualSessionId,
  });
}

export function setScheduledSessionTags(
  userId: number,
  scheduledSessionId: number,
  tagNames: string[]
): void {
  // First, delete existing tags for this scheduled session
  db.prepare(
    "DELETE FROM scheduled_session_tags WHERE scheduled_session_id = ?"
  ).run(scheduledSessionId);

  if (tagNames.length === 0) return;

  // Get or create tags
  const tagIds: number[] = [];
  const getTagStmt = db.prepare(
    "SELECT id FROM tags WHERE name = ? AND user_id = ?"
  );
  const createTagStmt = db.prepare(
    "INSERT INTO tags (name, user_id) VALUES (?, ?)"
  );

  for (const tagName of tagNames) {
    const tagRow = getTagStmt.get(tagName, userId) as
      | { id: number }
      | undefined;
    if (!tagRow) {
      const result = createTagStmt.run(tagName, userId);
      tagIds.push(result.lastInsertRowid as number);
    } else {
      tagIds.push(tagRow.id);
    }
  }

  // Insert new tag associations
  const insertTagStmt = db.prepare(
    "INSERT INTO scheduled_session_tags (scheduled_session_id, tag_id) VALUES (?, ?)"
  );
  for (const tagId of tagIds) {
    insertTagStmt.run(scheduledSessionId, tagId);
  }
}

function generateRecurringInstances(
  _baseSessionId: number,
  baseSession: Omit<ScheduledSession, "id" | "created_at">
): void {
  if (!baseSession.recurrence_data) return;

  const { endDate, occurrences } = baseSession.recurrence_data;
  const startDate = new Date(baseSession.scheduled_datetime);
  const instances = [];

  const currentDate = new Date(startDate);
  currentDate.setDate(currentDate.getDate() + 7); // Start with next week

  let count = 1;
  const maxOccurrences = occurrences || 52; // Default to 1 year
  const endDateTime = endDate
    ? new Date(endDate)
    : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year from now

  while (count < maxOccurrences && currentDate <= endDateTime) {
    // Format as local datetime to match the main session format
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, "0");
    const day = String(currentDate.getDate()).padStart(2, "0");
    const hours = String(currentDate.getHours()).padStart(2, "0");
    const minutes = String(currentDate.getMinutes()).padStart(2, "0");
    const seconds = String(currentDate.getSeconds()).padStart(2, "0");

    instances.push({
      ...baseSession,
      scheduled_datetime: `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`,
      status: "pending" as const,
    });

    currentDate.setDate(currentDate.getDate() + 7); // Next week
    count++;
  }

  // Insert all instances
  const stmt = db.prepare(`
    INSERT INTO scheduled_sessions 
    (user_id, title, description, scheduled_datetime, estimated_duration, 
     recurrence_type, recurrence_data, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const instance of instances) {
    stmt.run(
      instance.user_id,
      instance.title,
      instance.description || null,
      instance.scheduled_datetime,
      instance.estimated_duration || null,
      "none", // Individual instances are not recurring
      null,
      instance.status
    );
  }
}

// Notification functions
export function getUpcomingSessionsForNotification(): ScheduledSessionNotification[] {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  // Get sessions scheduled for tomorrow (day-before notification)
  const tomorrowSessions = db
    .prepare(
      `
    SELECT ss.id, ss.title, ss.scheduled_datetime, ss.estimated_duration,
           GROUP_CONCAT(t.name, ',') as tag_names
    FROM scheduled_sessions ss
    LEFT JOIN scheduled_session_tags sst ON ss.id = sst.scheduled_session_id
    LEFT JOIN tags t ON sst.tag_id = t.id
    WHERE date(ss.scheduled_datetime) = date(?)
      AND ss.status = 'pending'
      AND (ss.last_notification_sent IS NULL OR ss.last_notification_sent < date('now'))
    GROUP BY ss.id
  `
    )
    .all(tomorrow.toISOString().split("T")[0]) as any[];

  // Get sessions scheduled for today (same-day notification)
  const todaySessions = db
    .prepare(
      `
    SELECT ss.id, ss.title, ss.scheduled_datetime, ss.estimated_duration,
           GROUP_CONCAT(t.name, ',') as tag_names
    FROM scheduled_sessions ss
    LEFT JOIN scheduled_session_tags sst ON ss.id = sst.scheduled_session_id
    LEFT JOIN tags t ON sst.tag_id = t.id
    WHERE date(ss.scheduled_datetime) = date(?)
      AND ss.status = 'pending'
    GROUP BY ss.id
  `
    )
    .all(now.toISOString().split("T")[0]) as any[];

  const notifications: ScheduledSessionNotification[] = [];

  // Day-before notifications
  tomorrowSessions.forEach((session) => {
    notifications.push({
      id: session.id,
      title: session.title,
      scheduled_datetime: session.scheduled_datetime,
      estimated_duration: session.estimated_duration,
      type: "day_before",
      tags: session.tag_names
        ? session.tag_names.split(",").filter(Boolean)
        : [],
    });
  });

  // Same-day notifications
  todaySessions.forEach((session) => {
    const sessionTime = new Date(session.scheduled_datetime);
    const timeDiff = sessionTime.getTime() - now.getTime();
    const hoursUntil = timeDiff / (1000 * 60 * 60);

    // Notify if session is in the next 2 hours
    if (hoursUntil <= 2 && hoursUntil > 0) {
      notifications.push({
        id: session.id,
        title: session.title,
        scheduled_datetime: session.scheduled_datetime,
        estimated_duration: session.estimated_duration,
        type: "same_day",
        tags: session.tag_names
          ? session.tag_names.split(",").filter(Boolean)
          : [],
      });
    }

    // Notify if it's time to start (within 5 minutes)
    if (hoursUntil <= 5 / 60 && hoursUntil > -(5 / 60)) {
      notifications.push({
        id: session.id,
        title: session.title,
        scheduled_datetime: session.scheduled_datetime,
        estimated_duration: session.estimated_duration,
        type: "time_to_start",
        tags: session.tag_names
          ? session.tag_names.split(",").filter(Boolean)
          : [],
      });
    }
  });

  return notifications;
}

export function markNotificationSent(sessionId: number): void {
  const stmt = db.prepare(
    "UPDATE scheduled_sessions SET last_notification_sent = CURRENT_TIMESTAMP WHERE id = ?"
  );
  stmt.run(sessionId);
}
