import Database from 'better-sqlite3';
const db = new Database('usage.db');

db.prepare(`
  CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app TEXT,
    title TEXT,
    language TEXT,
    timestamp TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS usage_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app TEXT,
    language TEXT,
    date TEXT,
    icon TEXT,
    time_spent INTEGER DEFAULT 0,
    UNIQUE(app, language, date)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    start_time TEXT,
    end_time TEXT,
    title TEXT,
    description TEXT
  )
`).run();

// Add this helper function at the top of logger.ts
function getLocalDateString(date = new Date()): string {
  return date.toLocaleDateString('en-CA'); // YYYY-MM-DD format
}

// Then update logWindow function:
export function logWindow(app: string, title: string, lang: string | null, icon: string, intervalSeconds: number) {
  const timestamp = new Date().toISOString();
  // 1. Log the raw event (keep UTC timestamp for exact time)
  db.prepare(`INSERT INTO usage (app, title, language, timestamp) VALUES (?, ?, ?, ?)`)
    .run(app, title, lang, timestamp);

  const date = getLocalDateString(); // Use local date
  db.prepare(`
    INSERT INTO usage_summary (app, language, date, icon, time_spent)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(app, language, date)
    DO UPDATE SET 
      time_spent = time_spent + excluded.time_spent,
      icon = CASE WHEN usage_summary.icon IS NULL OR usage_summary.icon = '' THEN excluded.icon ELSE usage_summary.icon END
  `).run(app, lang, date, icon, intervalSeconds);
}

export function getLogs(date?: string) {
  if (date) {
    return db.prepare(`
      SELECT app, title, language, timestamp 
      FROM usage 
      WHERE date(timestamp) = date(?)
      ORDER BY id DESC 
      LIMIT 100
    `).all(date);
  }
  return db.prepare('SELECT app, title, language, timestamp FROM usage ORDER BY id DESC LIMIT 100').all();
}

export function getLoggedDaysOfMonth(year: number, month: number) {
  // month: 1-based (1=January)
  return db.prepare(`
    SELECT DISTINCT date FROM usage_summary
    WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ?
  `).all(String(year), String(month).padStart(2, '0'));
}

export function getSummary(date?: string) {
  if (!date) {
    date = getLocalDateString();
  }
  return db.prepare(
    'SELECT app, language, icon, time_spent FROM usage_summary WHERE date = ? ORDER BY time_spent DESC'
  ).all(date);
}

export function getEditorUsage() {
  return db.prepare(
    `SELECT app, SUM(time_spent) as total_time FROM usage_summary GROUP BY app`
  ).all();
}

export function getLanguageUsage() {
  return db.prepare(
    `SELECT language, SUM(time_spent) as total_time FROM usage_summary WHERE language IS NOT NULL GROUP BY language`
  ).all();
}

export function getDailySummary() {
  // Returns: [{ date, app, icon, total_time }]
  return db.prepare(`
    SELECT 
      date, 
      app, 
      icon, 
      SUM(time_spent) as total_time
    FROM usage_summary
    GROUP BY date, app
    ORDER BY date DESC, total_time DESC
  `).all();
}

export function addSession(date: string, start_time: string, end_time: string, title: string, description?: string) {
  db.prepare(`
    INSERT INTO sessions (date, start_time, end_time, title, description)
    VALUES (?, ?, ?, ?, ?)
  `).run(date, start_time, end_time, title, description || null);
}

export function getSessions() {
  return db.prepare(`
    SELECT id, date, start_time, end_time, title, description
    FROM sessions
    ORDER BY date DESC, start_time DESC
  `).all();
}

export function editSession(id: number, title: string, description: string) {
  db.prepare(`
    UPDATE sessions SET title = ?, description = ? WHERE id = ?
  `).run(title, description, id);
}

export function deleteSession(id: number) {
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
}