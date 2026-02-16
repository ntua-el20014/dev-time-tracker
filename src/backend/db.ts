import Database from "better-sqlite3";
import { DB_PATH } from "../ipc/dbHandler";
import { v4 as uuidv4 } from "uuid";

const db = new Database(DB_PATH);

// --- Table creation ---

// Create organizations table
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    local_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    synced INTEGER DEFAULT 0,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP
  )
`
).run();

// Create users table
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    local_id TEXT UNIQUE,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT,
    avatar TEXT,
    role TEXT DEFAULT 'employee' CHECK(role IN ('admin', 'manager', 'employee')),
    org_id INTEGER,
    synced INTEGER DEFAULT 0,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP
  )
`
).run();

// Create a default organization if none exists
const defaultOrg = db.prepare("SELECT id FROM organizations LIMIT 1").get();
if (!defaultOrg) {
  const orgId = db
    .prepare(
      `INSERT INTO organizations (local_id, name) VALUES (?, 'Default Organization')`
    )
    .run(uuidv4()).lastInsertRowid;

  // Update all existing users to belong to this organization
  db.prepare("UPDATE users SET org_id = ?").run(orgId);
}

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    synced INTEGER DEFAULT 0,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    local_id TEXT UNIQUE,
    app TEXT,
    title TEXT,
    language TEXT,
    timestamp TEXT,
    user_id INTEGER,
    synced INTEGER DEFAULT 0,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS usage_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    local_id TEXT UNIQUE,
    app TEXT,
    language TEXT,
    lang_ext TEXT,
    date TEXT,
    icon TEXT,
    time_spent INTEGER DEFAULT 0,
    user_id INTEGER,
    synced INTEGER DEFAULT 0,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(app, language, date, user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    local_id TEXT UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    is_active INTEGER DEFAULT 1,
    manager_id INTEGER NOT NULL,
    org_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    synced INTEGER DEFAULT 0,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS project_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    local_id TEXT UNIQUE,
    project_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT DEFAULT 'member' CHECK(role IN ('manager', 'member')),
    joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
    synced INTEGER DEFAULT 0,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
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
    local_id TEXT UNIQUE,
    timestamp TEXT,
    start_time TEXT,
    duration INTEGER,
    title TEXT,
    description TEXT,
    project_id INTEGER,
    is_billable INTEGER DEFAULT 0,
    user_id INTEGER,
    synced INTEGER DEFAULT 0,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    local_id TEXT UNIQUE,
    name TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    color TEXT,
    synced INTEGER DEFAULT 0,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
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
    local_id TEXT UNIQUE,
    synced INTEGER DEFAULT 0,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
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
    local_id TEXT UNIQUE,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    time INTEGER NOT NULL, -- in minutes
    description TEXT,
    isCompleted INTEGER DEFAULT 0,
    synced INTEGER DEFAULT 0,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
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
    local_id TEXT UNIQUE,
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
    synced INTEGER DEFAULT 0,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
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
    local_id TEXT UNIQUE,
    synced INTEGER DEFAULT 0,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (scheduled_session_id, tag_id),
    FOREIGN KEY (scheduled_session_id) REFERENCES scheduled_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  )
`
).run();

// Create performance optimization indexes after all tables
db.prepare(
  "CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON sessions(user_id, timestamp)"
).run();
db.prepare(
  "CREATE INDEX IF NOT EXISTS idx_usage_user_date ON usage_summary(user_id, date)"
).run();
db.prepare(
  "CREATE INDEX IF NOT EXISTS idx_usage_raw_user_date ON usage(user_id, timestamp)"
).run();

export default db;
