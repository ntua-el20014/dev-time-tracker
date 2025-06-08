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

export function logWindow(app: string, title: string, lang: string | null, icon: string, intervalSeconds: number) {
  const timestamp = new Date().toISOString();
  // 1. Log the raw event
  db.prepare(`INSERT INTO usage (app, title, language, timestamp) VALUES (?, ?, ?, ?)`)
    .run(app, title, lang, timestamp);

  // 2. Aggregate for summary table
  const date = timestamp.slice(0, 10) // YYYY-MM-DD
  db.prepare(`
    INSERT INTO usage_summary (app, language, date, icon, time_spent)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(app, language, date)
    DO UPDATE SET 
      time_spent = time_spent + excluded.time_spent,
      icon = CASE WHEN usage_summary.icon IS NULL OR usage_summary.icon = '' THEN excluded.icon ELSE usage_summary.icon END
  `).run(app, lang, date, icon, intervalSeconds);
}

export function getLogs() {
  return db.prepare('SELECT app, title, language, timestamp FROM usage ORDER BY id DESC LIMIT 100').all();
}

export function getSummary(date?: string) {
  if (!date) {
    date = new Date().toISOString().slice(0, 10);
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
