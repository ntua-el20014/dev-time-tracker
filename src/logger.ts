import Database from 'better-sqlite3';
import { showNotification } from '../html/components'; // Add this import at the top
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
  try {
    const timestamp = new Date().toISOString();
    db.prepare(`INSERT INTO usage (app, title, language, timestamp) VALUES (?, ?, ?, ?)`)
      .run(app, title, lang, timestamp);

    const date = getLocalDateString();
    db.prepare(`
      INSERT INTO usage_summary (app, language, date, icon, time_spent)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(app, language, date)
      DO UPDATE SET 
        time_spent = time_spent + excluded.time_spent,
        icon = CASE WHEN usage_summary.icon IS NULL OR usage_summary.icon = '' THEN excluded.icon ELSE usage_summary.icon END
    `).run(app, lang, date, icon, intervalSeconds);
  } catch (err) {
    showNotification('Failed to log window usage. Please try again.', 5000);
    console.error(err);
  }
}

export function getLogs(date?: string) {
  try {
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
  } catch (err) {
    showNotification('Failed to load logs from the database.', 5000);
    console.error(err);
    return [];
  }
}

export function getLoggedDaysOfMonth(year: number, month: number) {
  try {
    return db.prepare(`
      SELECT DISTINCT date FROM usage_summary
      WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ?
    `).all(String(year), String(month).padStart(2, '0'));
  } catch (err) {
    showNotification('Failed to load logged days.', 5000);
    console.error(err);
    return [];
  }
}

export function getSummary(date?: string) {
  try {
    if (!date) {
      date = getLocalDateString();
    }
    return db.prepare(
      'SELECT app, language, icon, time_spent FROM usage_summary WHERE date = ? ORDER BY time_spent DESC'
    ).all(date);
  } catch (err) {
    showNotification('Failed to load summary.', 5000);
    console.error(err);
    return [];
  }
}

export function getEditorUsage() {
  try {
    return db.prepare(
      `SELECT app, SUM(time_spent) as total_time FROM usage_summary GROUP BY app`
    ).all();
  } catch (err) {
    showNotification('Failed to load editor usage.', 5000);
    console.error(err);
    return [];
  }
}

export function getLanguageUsage() {
  try {
    return db.prepare(
      `SELECT language, SUM(time_spent) as total_time FROM usage_summary WHERE language IS NOT NULL GROUP BY language`
    ).all();
  } catch (err) {
    showNotification('Failed to load language usage.', 5000);
    console.error(err);
    return [];
  }
}

export function getDailySummary() {
  try {
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
  } catch (err) {
    showNotification('Failed to load daily summary.', 5000);
    console.error(err);
    return [];
  }
}

export function getSessions() {
  try {
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
      s.date = getLocalDateString(new Date(s.timestamp));
    }
    return sessions;
  } catch (err) {
    showNotification('Failed to load sessions.', 5000);
    console.error(err);
    return [];
  }
}

export function editSession(id: number, title: string, description: string, tags?: string[]) {
  try {
    db.prepare(`
      UPDATE sessions SET title = ?, description = ? WHERE id = ?
    `).run(title, description, id);
    if (tags) setSessionTags(id, tags);
  } catch (err) {
    showNotification('Failed to update session.', 5000);
    console.error(err);
  }
}

export function deleteSession(id: number) {
  try {
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
  } catch (err) {
    showNotification('Failed to delete session.', 5000);
    console.error(err);
  }
}

export function getAllTags() {
  try {
    return db.prepare(`SELECT * FROM tags ORDER BY name COLLATE NOCASE`).all();
  } catch (err) {
    showNotification('Failed to load tags.', 5000);
    console.error(err);
    return [];
  }
}

export function addTag(name: string): number | undefined {
  try {
    const info = db.prepare(`INSERT INTO tags (name) VALUES (?)`).run(name);
    return info.lastInsertRowid as number;
  } catch {
    // Tag already exists
    try {
      const row = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(name) as { id: number } | undefined;
      return row?.id;
    } catch (err) {
      showNotification('Failed to add or fetch tag.', 5000);
      console.error(err);
      return undefined;
    }
  }
}

export function setSessionTags(sessionId: number, tagNames: string[]) {
  try {
    db.prepare(`DELETE FROM session_tags WHERE session_id = ?`).run(sessionId);
    for (const name of tagNames) {
      const tagId = addTag(name);
      if (tagId !== undefined) {
        db.prepare(`INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES (?, ?)`).run(sessionId, tagId);
      }
    }
  } catch (err) {
    showNotification('Failed to set session tags.', 5000);
    console.error(err);
  }
}

export function getSessionTags(sessionId: number): string[] {
  try {
    return db.prepare(`
      SELECT t.name FROM tags t
      JOIN session_tags st ON t.id = st.tag_id
      WHERE st.session_id = ?
      ORDER BY t.name COLLATE NOCASE
    `).all(sessionId).map((row: { name: string }) => row.name);
  } catch (err) {
    showNotification('Failed to load session tags.', 5000);
    console.error(err);
    return [];
  }
}

export function addSession(
  date: string,
  start_time: string,
  duration: number,
  title: string,
  description?: string,
  tags?: string[]
) {
  try {
    const now = new Date();
    const timestamp = now.toISOString();
    const info = db.prepare(`
      INSERT INTO sessions (timestamp, start_time, duration, title, description)
      VALUES (?, ?, ?, ?, ?)
    `).run(timestamp, start_time, duration, title, description || null);
    const sessionId = info.lastInsertRowid as number;
    if (tags && tags.length) setSessionTags(sessionId, tags);
  } catch (err) {
    showNotification('Failed to add session.', 5000);
    console.error(err);
  }
}

export function deleteTag(name: string) {
  try {
    const tag = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(name) as { id: number } | undefined;
    if (tag) {
      db.prepare(`DELETE FROM session_tags WHERE tag_id = ?`).run(tag.id);
      db.prepare(`DELETE FROM tags WHERE id = ?`).run(tag.id);
    }
  } catch (err) {
    showNotification('Failed to delete tag.', 5000);
    console.error(err);
  }
}

