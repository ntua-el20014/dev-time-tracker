/* eslint-disable @typescript-eslint/no-explicit-any */
import db from './db';
import { notifyRenderer } from '../utils/ipcHelp';
import { getLocalDateString } from '../utils/timeFormat';
import type { DailySummaryFilters } from './types';

// --- Usage logging and queries (all user-specific, user_id as input) ---
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
    db.prepare(`INSERT INTO usage (app, title, language, timestamp, user_id) VALUES (?, ?, ?, ?, ?)`)
      .run(app, title, lang, timestamp, userId);

    const date = getLocalDateString();

    db.prepare(`
      INSERT INTO usage_summary (app, language, lang_ext, date, icon, time_spent, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(app, language, date, user_id)
      DO UPDATE SET 
        time_spent = time_spent + excluded.time_spent,
        icon = CASE WHEN usage_summary.icon IS NULL OR usage_summary.icon = '' THEN excluded.icon ELSE usage_summary.icon END,
        lang_ext = CASE WHEN excluded.lang_ext IS NOT NULL THEN excluded.lang_ext ELSE usage_summary.lang_ext END
    `).run(app, lang, langExt, date, icon, intervalSeconds, userId);
  } catch (err) {
    notifyRenderer('Failed to log window usage. Please try again.', 5000);
    console.error(err);
  }
}

export function getLogs(userId: number, date?: string) {
  try {
    if (date) {
      return db.prepare(`
        SELECT app, title, language, timestamp 
        FROM usage 
        WHERE date(timestamp) = date(?) AND user_id = ?
        ORDER BY id DESC 
        LIMIT 100
      `).all(date, userId);
    }
    return db.prepare('SELECT app, title, language, timestamp FROM usage WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(userId);
  } catch (err) {
    notifyRenderer('Failed to load logs from the database.', 5000);
    console.error(err);
    return [];
  }
}

export function getLoggedDaysOfMonth(userId: number, year: number, month: number) {
  try {
    return db.prepare(`
      SELECT DISTINCT date FROM usage_summary
      WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ? AND user_id = ?
    `).all(String(year), String(month).padStart(2, '0'), userId);
  } catch (err) {
    notifyRenderer('Failed to load logged days.', 5000);
    console.error(err);
    return [];
  }
}

export function getSummary(userId: number, date?: string) {
  try {
    if (!date) {
      date = getLocalDateString();
    }
    return db.prepare(
      'SELECT app, language, lang_ext, icon, time_spent FROM usage_summary WHERE date = ? AND user_id = ? ORDER BY time_spent DESC'
    ).all(date, userId);
  } catch (err) {
    notifyRenderer('Failed to load summary.', 5000);
    console.error(err);
    return [];
  }
}

export function getEditorUsage(userId: number) {
  try {
    return db.prepare(
      `SELECT app, SUM(time_spent) as total_time FROM usage_summary WHERE user_id = ? GROUP BY app`
    ).all(userId);
  } catch (err) {
    notifyRenderer('Failed to load editor usage.', 5000);
    console.error(err);
    return [];
  }
}

export function getLanguageUsage(userId: number) {
  try {
    return db.prepare(
      `SELECT language, SUM(time_spent) as total_time FROM usage_summary WHERE language IS NOT NULL AND user_id = ? GROUP BY language`
    ).all(userId);
  } catch (err) {
    notifyRenderer('Failed to load language usage.', 5000);
    console.error(err);
    return [];
  }
}

export function getDailySummary(
  userId: number,
  filters?: DailySummaryFilters
) {
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
      query += ' AND language = ?';
      params.push(filters.language);
    }
    if (filters?.app) {
      query += ' AND app = ?';
      params.push(filters.app);
    }
    if (filters?.startDate) {
      query += ' AND date >= ?';
      params.push(filters.startDate);
    }
    if (filters?.endDate) {
      query += ' AND date <= ?';
      params.push(filters.endDate);
    }

    query += `
      GROUP BY date, app
      ORDER BY date DESC, total_time DESC
    `;
    return db.prepare(query).all(...params);
  } catch (err) {
    notifyRenderer('Failed to load daily summary.', 5000);
    console.error(err);
    return [];
  }
}

export function getLanguageSummaryByDateRange(userId: number, startDate: string, endDate: string) {
  try {
    return db.prepare(`
      SELECT language, lang_ext, SUM(time_spent) as total_time
      FROM usage_summary
      WHERE date BETWEEN ? AND ?
        AND language IS NOT NULL
        AND user_id = ?
      GROUP BY language, lang_ext
      ORDER BY total_time DESC
    `).all(startDate, endDate, userId);
  } catch (err) {
    notifyRenderer('Failed to load language summary for date range.', 5000);
    console.error(err);
    return [];
  }
}

export function setDailyGoal(userId: number, date: string, time: number, description: string) {
  db.prepare(`
    INSERT OR IGNORE INTO daily_goals (user_id, date, time, description, isCompleted)
    VALUES (?, ?, ?, ?, 0)
  `).run(userId, date, time, description);
}

export function getDailyGoal(userId: number, date: string) {
  return db.prepare(`
    SELECT * FROM daily_goals WHERE user_id = ? AND date = ?
  `).get(userId, date);
}

export function deleteDailyGoal(userId: number, date: string) {
  db.prepare(`DELETE FROM daily_goals WHERE user_id = ? AND date = ?`).run(userId, date);
}

export function completeDailyGoal(userId: number, date: string) {
  db.prepare(`UPDATE daily_goals SET isCompleted = 1 WHERE user_id = ? AND date = ?`).run(userId, date);
}

export function getTotalTimeForDay(userId: number, date: string): number {
  const row = db.prepare(`
    SELECT SUM(time_spent) as total FROM usage_summary WHERE user_id = ? AND date = ?
  `).get(userId, date) as { total: number } | undefined;
  return row?.total ? row.total / 60 : 0;
}

export function getAllDailyGoals(userId: number) {
  return db.prepare(`
    SELECT date, time, description, isCompleted
    FROM daily_goals
    WHERE user_id = ?
    ORDER BY date DESC
  `).all(userId);
}

// Database migration functions

export function getAllUsageData() {
 return db.prepare('SELECT * FROM usage').all();
}
export function getAllUsageSummaryData() {
  return db.prepare('SELECT * FROM usage_summary').all();
}
export function getAllDailyGoalsData() {
  return db.prepare('SELECT * FROM daily_goals').all();
}

export function clearUsage() {
  db.prepare('DELETE FROM usage').run();
}
export function importUsage(usageArr: any[]) {
  const stmt = db.prepare('INSERT INTO usage (id, app, title, language, timestamp, user_id) VALUES (?, ?, ?, ?, ?, ?)');
  for (const row of usageArr) {
    stmt.run(row.id, row.app, row.title, row.language, row.timestamp, row.user_id);
  }
}
export function clearUsageSummary() {
  db.prepare('DELETE FROM usage_summary').run();
}
export function importUsageSummary(usageSummaryArr: any[]) {
  const stmt = db.prepare('INSERT INTO usage_summary (id, app, language, lang_ext, date, icon, time_spent, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const row of usageSummaryArr) {
    stmt.run(row.id, row.app, row.language, row.lang_ext, row.date, row.icon, row.time_spent, row.user_id);
  }
}
export function clearDailyGoals() {
  db.prepare('DELETE FROM daily_goals').run();
}
export function importDailyGoals(dailyGoalsArr: any[]) {
  const stmt = db.prepare('INSERT INTO daily_goals (id, user_id, date, time, description, isCompleted) VALUES (?, ?, ?, ?, ?, ?)');
  for (const row of dailyGoalsArr) {
    stmt.run(row.id, row.user_id, row.date, row.time, row.description, row.isCompleted);
  }
}