import Database from 'better-sqlite3';
import { DB_PATH } from '../ipc/dbHandler';
const db = new Database(DB_PATH);

// --- Table creation ---
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
    color TEXT,
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

db.prepare(`
  CREATE TABLE IF NOT EXISTS daily_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    time INTEGER NOT NULL, -- in minutes
    description TEXT,
    isCompleted INTEGER DEFAULT 0,
    UNIQUE(user_id, date)
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`).run();

export default db;