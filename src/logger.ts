import Database from 'better-sqlite3';
import { BrowserWindow } from 'electron';
const db = new Database('usage.db');


function notifyRenderer(message: string, durationMs = 3500) {
  // Find the main window and send the notification
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send('notify', { message, durationMs });
  }
}

// --- Table creation with user_id support ---
db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    avatar TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app TEXT,
    title TEXT,
    language TEXT,
    timestamp TEXT,
    user_id INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS usage_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app TEXT,
    language TEXT,
    lang_ext TEXT,
    date TEXT,
    icon TEXT,
    time_spent INTEGER DEFAULT 0,
    user_id INTEGER,
    UNIQUE(app, language, date, user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT,
    start_time TEXT,
    duration INTEGER,
    title TEXT,
    description TEXT,
    user_id INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    UNIQUE(name, user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

// --- Helper ---
function getLocalDateString(date = new Date()): string {
  return date.toLocaleDateString('en-CA'); // YYYY-MM-DD format
}

// --- User management functions ---
export function createUser(username: string, avatar = ''): number | undefined {
  try {
    const info = db.prepare(`INSERT INTO users (username, avatar) VALUES (?, ?)`).run(username, avatar);
    return info.lastInsertRowid as number;
  } catch {
    const row = db.prepare(`SELECT id FROM users WHERE username = ?`).get(username) as { id: number } | undefined;
    return row?.id;
  }
}

export function getAllUsers(): { id: number, username: string, avatar: string }[] {
  return db.prepare(`SELECT id, username, avatar FROM users ORDER BY username`).all() as { id: number, username: string, avatar: string }[];
}

export function setCurrentUser(userId: number) {
  db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('current_user', ?)`).run(String(userId));
}

export function getCurrentUser(): number {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'current_user'`).get() as { value: string } | undefined;
  return row ? Number(row.value) : 1;
}

export function deleteUser(userId: number) {
  try {
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
  } catch (err) {
    notifyRenderer('Failed to delete user.', 5000);
    console.error(err);
  }
}

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

export function getDailySummary(userId: number) {
  try {
    return db.prepare(`
      SELECT 
        date, 
        app, 
        icon, 
        SUM(time_spent) as total_time
      FROM usage_summary
      WHERE user_id = ?
      GROUP BY date, app
      ORDER BY date DESC, total_time DESC
    `).all(userId);
  } catch (err) {
    notifyRenderer('Failed to load daily summary.', 5000);
    console.error(err);
    return [];
  }
}

export function getLanguageSummaryByDateRange(userId: number, startDate: string, endDate: string) {
  try {
    return db.prepare(`
      SELECT language, SUM(time_spent) as total_time
      FROM usage_summary
      WHERE date BETWEEN ? AND ?
        AND language IS NOT NULL
        AND user_id = ?
      GROUP BY language
      ORDER BY total_time DESC
    `).all(startDate, endDate, userId);
  } catch (err) {
    notifyRenderer('Failed to load language summary for date range.', 5000);
    console.error(err);
    return [];
  }
}

export function getSessions(userId: number) {
  try {
    type SessionRow = {
      id: number;
      timestamp: string;
      start_time: string;
      duration: number;
      title: string;
      description: string | null;
      tags?: string[];
      date: string;
    };
    const sessions = db.prepare(`
      SELECT id, timestamp, start_time, duration, title, description
      FROM sessions
      WHERE user_id = ?
      ORDER BY timestamp DESC
    `).all(userId) as SessionRow[];
    for (const s of sessions) {
      s.tags = getSessionTags(s.id);
      s.date = getLocalDateString(new Date(s.timestamp));
    }
    return sessions;
  } catch (err) {
    notifyRenderer('Failed to load sessions.', 5000);
    console.error(err);
    return [];
  }
}

export function addSession(
  userId: number,
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
      INSERT INTO sessions (timestamp, start_time, duration, title, description, user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(timestamp, start_time, duration, title, description || null, userId);
    const sessionId = info.lastInsertRowid as number;
    if (tags && tags.length) setSessionTags(userId, sessionId, tags);
  } catch (err) {
    notifyRenderer('Failed to add session.', 5000);
    console.error(err);
  }
}

export function editSession(userId: number, id: number, title: string, description: string, tags?: string[], ) {
  try {
    db.prepare(`
      UPDATE sessions SET title = ?, description = ? WHERE id = ?
    `).run(title, description, id);
    if (tags) setSessionTags(userId, id, tags);
  } catch (err) {
    notifyRenderer('Failed to update session.', 5000);
    console.error(err);
  }
}

export function deleteSession(id: number) {
  try {
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
  } catch (err) {
    notifyRenderer('Failed to delete session.', 5000);
    console.error(err);
  }
}

export function getAllTags(userId: number): Tag[] {
  try {
    return db.prepare(`SELECT * FROM tags WHERE user_id = ? ORDER BY name COLLATE NOCASE`).all(userId) as Tag[];
  } catch (err) {
    notifyRenderer('Failed to load tags.', 5000);
    console.error(err);
    return [];
  }
}

export function addTag(userId: number, name: string): number | undefined {
  try {
    const info = db.prepare(`INSERT INTO tags (name, user_id) VALUES (?, ?)`).run(name, userId);
    return info.lastInsertRowid as number;
  } catch {
    try {
      const row = db.prepare(`SELECT id FROM tags WHERE name = ? AND user_id = ?`).get(name, userId) as { id: number } | undefined;
      return row?.id;
    } catch (err) {
      notifyRenderer('Failed to add or fetch tag.', 5000);
      console.error(err);
      return undefined;
    }
  }
}

export function setSessionTags(userId: number, sessionId: number, tagNames: string[]) {
  try {
    db.prepare(`DELETE FROM session_tags WHERE session_id = ?`).run(sessionId);
    for (const name of tagNames) {
      const tagId = addTag(userId, name);
      if (tagId !== undefined) {
        db.prepare(`INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES (?, ?)`).run(sessionId, tagId);
      }
    }
  } catch (err) {
    notifyRenderer('Failed to set session tags.', 5000);
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
    notifyRenderer('Failed to load session tags.', 5000);
    console.error(err);
    return [];
  }
}

export function deleteTag(userId: number, name: string) {
  try {
    const tag = db.prepare(`SELECT id FROM tags WHERE name = ? AND user_id = ?`).get(name, userId) as { id: number } | undefined;
    if (tag) {
      db.prepare(`DELETE FROM session_tags WHERE tag_id = ?`).run(tag.id);
      db.prepare(`DELETE FROM tags WHERE id = ?`).run(tag.id);
    }
  } catch (err) {
    notifyRenderer('Failed to delete tag.', 5000);
    console.error(err);
  }
}

export interface DailySummaryRow {
  date: string;
  app: string;
  language?: string;
  lang_ext?: string;
  icon?: string;
  total_time: number;
}

export interface SessionRow {
  id: number;
  timestamp: string;
  start_time: string;
  duration: number;
  title: string;
  description: string | null;
  tags?: string[];
  date: string;
}

export interface LogEntry {
  icon: string;
  app: string;
  language: string;
  lang_ext?: string;
  time_spent: number;
}

export interface Tag {
  id: number;
  name: string;
}

export interface SessionTag {
  session_id: number;
  tag_id: number;
}