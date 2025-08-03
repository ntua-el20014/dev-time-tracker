import Database from "better-sqlite3";
import { DB_PATH } from "../ipc/dbHandler";
const db = new Database(DB_PATH);

// --- Table creation ---
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    avatar TEXT,
    role TEXT DEFAULT 'employee' CHECK(role IN ('admin', 'manager', 'employee'))
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app TEXT,
    title TEXT,
    language TEXT,
    timestamp TEXT,
    user_id INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`
).run();

db.prepare(
  `
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
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    is_active INTEGER DEFAULT 1,
    manager_id INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE CASCADE
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS project_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT DEFAULT 'employee' CHECK(role IN ('manager', 'employee')),
    joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, user_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT,
    start_time TEXT,
    duration INTEGER,
    title TEXT,
    description TEXT,
    project_id INTEGER,
    is_billable INTEGER DEFAULT 0,
    user_id INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    color TEXT,
    UNIQUE(name, user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS session_tags (
    session_id INTEGER,
    tag_id INTEGER,
    PRIMARY KEY (session_id, tag_id),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS daily_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    time INTEGER NOT NULL, -- in minutes
    description TEXT,
    isCompleted INTEGER DEFAULT 0,
    UNIQUE(user_id, date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`
).run();

// Scheduled sessions table
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS scheduled_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    scheduled_datetime TEXT NOT NULL, -- ISO datetime string
    estimated_duration INTEGER, -- in minutes
    recurrence_type TEXT CHECK(recurrence_type IN ('none', 'weekly')) DEFAULT 'none',
    recurrence_data TEXT, -- JSON for recurrence settings
    status TEXT CHECK(status IN ('pending', 'notified', 'completed', 'missed', 'cancelled')) DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_notification_sent TEXT,
    actual_session_id INTEGER, -- Links to sessions table when completed
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (actual_session_id) REFERENCES sessions(id) ON DELETE SET NULL
  )
`
).run();

// Scheduled session tags table
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS scheduled_session_tags (
    scheduled_session_id INTEGER,
    tag_id INTEGER,
    PRIMARY KEY (scheduled_session_id, tag_id),
    FOREIGN KEY (scheduled_session_id) REFERENCES scheduled_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  )
`
).run();

export default db;
