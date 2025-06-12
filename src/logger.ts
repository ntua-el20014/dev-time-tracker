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
    timestamp TEXT,         -- ISO string, local time
    start_time TEXT,
    duration INTEGER,
    title TEXT,
    description TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS session_tags (
    session_id INTEGER,
    tag_id INTEGER,
    PRIMARY KEY (session_id, tag_id),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
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

export function getSessions() {
  type SessionRow = {
    id: number;
    timestamp: string;
    start_time: string;
    duration: number;
    title: string;
    description: string | null;
    tags?: string[];
    date: string; // For display
  };
  const sessions = db.prepare(`
    SELECT id, timestamp, start_time, duration, title, description
    FROM sessions
    ORDER BY timestamp DESC
  `).all() as SessionRow[];
  for (const s of sessions) {
    s.tags = getSessionTags(s.id);
    // Convert timestamp to local date string for display
    s.date = getLocalDateString(new Date(s.timestamp));
  }
  return sessions;
}

export function editSession(id: number, title: string, description: string, tags?: string[]) {
  db.prepare(`
    UPDATE sessions SET title = ?, description = ? WHERE id = ?
  `).run(title, description, id);
  if (tags) setSessionTags(id, tags);
}

export function deleteSession(id: number) {
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
}

export function getAllTags() {
  return db.prepare(`SELECT * FROM tags ORDER BY name COLLATE NOCASE`).all();
}

export function addTag(name: string): number {
  try {
    const info = db.prepare(`INSERT INTO tags (name) VALUES (?)`).run(name);
    return info.lastInsertRowid as number;
  } catch {
    // Tag already exists
    const row = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(name) as { id: number } | undefined;
    return row?.id;
  }
}

export function setSessionTags(sessionId: number, tagNames: string[]) {
  // Remove old tags
  db.prepare(`DELETE FROM session_tags WHERE session_id = ?`).run(sessionId);
  // Add new tags
  for (const name of tagNames) {
    const tagId = addTag(name);
    db.prepare(`INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES (?, ?)`).run(sessionId, tagId);
  }
}

export function getSessionTags(sessionId: number): string[] {
  return db.prepare(`
    SELECT t.name FROM tags t
    JOIN session_tags st ON t.id = st.tag_id
    WHERE st.session_id = ?
    ORDER BY t.name COLLATE NOCASE
  `).all(sessionId).map((row: { name: string }) => row.name);
}

// When adding a session, optionally accept tags:
export function addSession(
  date: string,
  start_time: string,
  duration: number,
  title: string,
  description?: string,
  tags?: string[]
) {
  const now = new Date();
  const timestamp = now.toISOString(); // Always store as ISO string (UTC)
  const info = db.prepare(`
    INSERT INTO sessions (timestamp, start_time, duration, title, description)
    VALUES (?, ?, ?, ?, ?)
  `).run(timestamp, start_time, duration, title, description || null);
  const sessionId = info.lastInsertRowid as number;
  if (tags && tags.length) setSessionTags(sessionId, tags);
}

export function deleteTag(name: string) {
  // Remove tag from tags and all session_tags
  const tag = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(name) as { id: number } | undefined;
  if (tag) {
    db.prepare(`DELETE FROM session_tags WHERE tag_id = ?`).run(tag.id);
    db.prepare(`DELETE FROM tags WHERE id = ?`).run(tag.id);
  }
}

