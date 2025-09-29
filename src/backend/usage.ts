import db from "./db";
import { notifyRenderer } from "../utils/ipcHelp";
import { getLocalDateString } from "../utils/timeFormat";
import type { DailySummaryFilters } from "./types";
import { v4 as uuidv4 } from "uuid";

export function logWindow(
  userId: number,
  app: string,
  title: string,
  lang: string | null,
  icon: string,
  intervalSeconds: number,
  langExt: string | null
) {
  try {
    const timestamp = new Date().toISOString();
    db.prepare(
      `INSERT INTO usage (local_id, app, title, language, timestamp, user_id, synced, last_modified) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(uuidv4(), app, title, lang, timestamp, userId, timestamp);

    const date = getLocalDateString();

    db.prepare(
      `
      INSERT INTO usage_summary (local_id, app, language, lang_ext, date, icon, time_spent, user_id, synced, last_modified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT(app, language, date, user_id)
      DO UPDATE SET 
        time_spent = time_spent + excluded.time_spent,
        icon = CASE WHEN usage_summary.icon IS NULL OR usage_summary.icon = '' THEN excluded.icon ELSE usage_summary.icon END,
        lang_ext = CASE WHEN excluded.lang_ext IS NOT NULL THEN excluded.lang_ext ELSE usage_summary.lang_ext END,
        synced = 0,
        last_modified = excluded.last_modified
    `
    ).run(
      uuidv4(),
      app,
      lang,
      langExt,
      date,
      icon,
      intervalSeconds,
      userId,
      new Date().toISOString()
    );
  } catch (err) {
    notifyRenderer("Failed to log window usage. Please try again.", 5000);
  }
}

export function getLogs(userId: number, date?: string) {
  try {
    if (date) {
      return db
        .prepare(
          `
        SELECT app, title, language, timestamp 
        FROM usage 
        WHERE date(timestamp) = date(?) AND user_id = ?
        ORDER BY id DESC 
        LIMIT 100
      `
        )
        .all(date, userId);
    }
    return db
      .prepare(
        "SELECT app, title, language, timestamp FROM usage WHERE user_id = ? ORDER BY id DESC LIMIT 100"
      )
      .all(userId);
  } catch (err) {
    notifyRenderer("Failed to load logs from the database.", 5000);
    return [];
  }
}

export function getLoggedDaysOfMonth(
  userId: number,
  year: number,
  month: number
) {
  try {
    return db
      .prepare(
        `
      SELECT DISTINCT date FROM usage_summary
      WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ? AND user_id = ?
    `
      )
      .all(String(year), String(month).padStart(2, "0"), userId);
  } catch (err) {
    notifyRenderer("Failed to load logged days.", 5000);
    return [];
  }
}

export function getSummary(userId: number, date?: string) {
  try {
    if (!date) {
      date = getLocalDateString();
    }
    return db
      .prepare(
        "SELECT app, language, lang_ext, icon, time_spent FROM usage_summary WHERE date = ? AND user_id = ? ORDER BY time_spent DESC"
      )
      .all(date, userId);
  } catch (err) {
    notifyRenderer("Failed to load summary.", 5000);
    return [];
  }
}

export function getEditorUsage(userId: number) {
  try {
    return db
      .prepare(
        `SELECT app, SUM(time_spent) as total_time FROM usage_summary WHERE user_id = ? GROUP BY app`
      )
      .all(userId);
  } catch (err) {
    notifyRenderer("Failed to load editor usage.", 5000);
    return [];
  }
}

export function getLanguageUsage(userId: number) {
  try {
    return db
      .prepare(
        `SELECT language, SUM(time_spent) as total_time FROM usage_summary WHERE language IS NOT NULL AND user_id = ? GROUP BY language`
      )
      .all(userId);
  } catch (err) {
    notifyRenderer("Failed to load language usage.", 5000);
    return [];
  }
}

export function getDailySummary(userId: number, filters?: DailySummaryFilters) {
  try {
    let query = `
      SELECT 
        date, 
        app, 
        icon, 
        language,
        SUM(time_spent) as total_time
      FROM usage_summary
      WHERE user_id = ?
    `;
    const params: any[] = [userId];

    if (filters?.language) {
      query += " AND language = ?";
      params.push(filters.language);
    }
    if (filters?.app) {
      query += " AND app = ?";
      params.push(filters.app);
    }
    if (filters?.startDate) {
      query += " AND date >= ?";
      params.push(filters.startDate);
    }
    if (filters?.endDate) {
      query += " AND date <= ?";
      params.push(filters.endDate);
    }

    query += `
      GROUP BY date, app
      ORDER BY date DESC, total_time DESC
    `;
    return db.prepare(query).all(...params);
  } catch (err) {
    notifyRenderer("Failed to load daily summary.", 5000);
    return [];
  }
}

export function getLanguageSummaryByDateRange(
  userId: number,
  startDate: string,
  endDate: string
) {
  try {
    return db
      .prepare(
        `
      SELECT language, lang_ext, SUM(time_spent) as total_time
      FROM usage_summary
      WHERE date BETWEEN ? AND ?
        AND language IS NOT NULL
        AND user_id = ?
      GROUP BY language, lang_ext
      ORDER BY total_time DESC
    `
      )
      .all(startDate, endDate, userId);
  } catch (err) {
    notifyRenderer("Failed to load language summary for date range.", 5000);
    return [];
  }
}

export function setDailyGoal(
  userId: number,
  date: string,
  time: number,
  description: string
) {
  db.prepare(
    `
    INSERT INTO daily_goals (local_id, user_id, date, time, description, isCompleted, synced, last_modified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, date)
    DO UPDATE SET
      time = excluded.time,
      description = excluded.description,
      synced = 0,
      last_modified = excluded.last_modified
  `
  ).run(
    uuidv4(),
    userId,
    date,
    time,
    description,
    0,
    0,
    new Date().toISOString()
  );
}

export function getDailyGoal(userId: number, date: string) {
  return db
    .prepare(
      `
    SELECT * FROM daily_goals WHERE user_id = ? AND date = ?
  `
    )
    .get(userId, date);
}

export function deleteDailyGoal(userId: number, date: string) {
  db.prepare(`DELETE FROM daily_goals WHERE user_id = ? AND date = ?`).run(
    userId,
    date
  );
}

export function completeDailyGoal(userId: number, date: string) {
  db.prepare(
    `UPDATE daily_goals SET isCompleted = 1, synced = 0, last_modified = ? WHERE user_id = ? AND date = ?`
  ).run(new Date().toISOString(), userId, date);
}

export function getTotalTimeForDay(userId: number, date: string): number {
  const row = db
    .prepare(
      `
    SELECT SUM(time_spent) as total FROM usage_summary WHERE user_id = ? AND date = ?
  `
    )
    .get(userId, date) as { total: number } | undefined;
  return row?.total ? row.total / 60 : 0;
}

export function getAllDailyGoals(userId: number) {
  return db
    .prepare(
      `
    SELECT date, time, description, isCompleted
    FROM daily_goals
    WHERE user_id = ?
    ORDER BY date DESC
  `
    )
    .all(userId);
}

export function getUserEditors(userId: number) {
  return db
    .prepare(
      "SELECT DISTINCT app, icon FROM usage_summary WHERE user_id = ? AND icon IS NOT NULL AND icon != ''"
    )
    .all(userId);
}

export function getUserLangExts(userId: number) {
  return db
    .prepare(
      "SELECT DISTINCT lang_ext FROM usage_summary WHERE user_id = ? AND lang_ext IS NOT NULL AND lang_ext != ''"
    )
    .all(userId);
}

// Get detailed usage data for a specific app on a specific date
export function getUsageDetailsForAppDate(
  userId: number,
  app: string,
  date: string
) {
  try {
    return db
      .prepare(
        `
      SELECT app, title, language, timestamp, 
             strftime('%H:%M:%S', timestamp) as time
      FROM usage 
      WHERE date(timestamp) = date(?) 
        AND app = ? 
        AND user_id = ?
      ORDER BY timestamp ASC
    `
      )
      .all(date, app, userId);
  } catch (err) {
    notifyRenderer("Failed to load usage details.", 5000);
    return [];
  }
}

// Get detailed usage data for a specific session
export function getUsageDetailsForSession(userId: number, sessionId: number) {
  try {
    // First get the session details
    const session = db
      .prepare(
        `
      SELECT timestamp, start_time, duration, title, description
      FROM sessions 
      WHERE id = ? AND user_id = ?
    `
      )
      .get(sessionId, userId) as any;

    if (!session) return null;

    // Calculate session end time
    const startTime = new Date(session.start_time);
    const endTime = new Date(startTime.getTime() + session.duration * 1000);

    // Get usage data during the session timeframe
    const usage = db
      .prepare(
        `
      SELECT app, title, language, timestamp,
             strftime('%H:%M:%S', timestamp) as time
      FROM usage 
      WHERE timestamp BETWEEN ? AND ?
        AND user_id = ?
      ORDER BY timestamp ASC
    `
      )
      .all(session.start_time, endTime.toISOString(), userId);

    return {
      session,
      usage,
    };
  } catch (err) {
    notifyRenderer("Failed to load session details.", 5000);
    return null;
  }
}

// Database migration functions

export function getAllUsageData() {
  return db.prepare("SELECT * FROM usage").all();
}
export function getAllUsageSummaryData() {
  return db.prepare("SELECT * FROM usage_summary").all();
}
export function getAllDailyGoalsData() {
  return db.prepare("SELECT * FROM daily_goals").all();
}

export function clearUsage() {
  db.prepare("DELETE FROM usage").run();
}
export function importUsage(usageArr: any[]) {
  const stmt = db.prepare(
    "INSERT INTO usage (id, local_id, app, title, language, timestamp, user_id, synced, last_modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const row of usageArr) {
    stmt.run(
      row.id,
      uuidv4(),
      row.app,
      row.title,
      row.language,
      row.timestamp,
      row.user_id,
      0,
      new Date().toISOString()
    );
  }
}
export function clearUsageSummary() {
  db.prepare("DELETE FROM usage_summary").run();
}
export function importUsageSummary(usageSummaryArr: any[]) {
  const stmt = db.prepare(
    "INSERT INTO usage_summary (id, local_id, app, language, lang_ext, date, icon, time_spent, user_id, synced, last_modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const row of usageSummaryArr) {
    stmt.run(
      row.id,
      uuidv4(),
      row.app,
      row.language,
      row.lang_ext,
      row.date,
      row.icon,
      row.time_spent,
      row.user_id,
      0,
      new Date().toISOString()
    );
  }
}
export function clearDailyGoals() {
  db.prepare("DELETE FROM daily_goals").run();
}
export function importDailyGoals(dailyGoalsArr: any[]) {
  const stmt = db.prepare(
    "INSERT INTO daily_goals (id, local_id, user_id, date, time, description, isCompleted, synced, last_modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const row of dailyGoalsArr) {
    stmt.run(
      row.id,
      uuidv4(),
      row.user_id,
      row.date,
      row.time,
      row.description,
      row.isCompleted,
      0,
      new Date().toISOString()
    );
  }
}
