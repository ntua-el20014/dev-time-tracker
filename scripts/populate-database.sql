-- Database population script for dev-time-tracker
-- This creates and populates the database from scratch
--
-- IMPORTANT BUSINESS RULES:
-- - Only users with 'admin' or 'manager' roles can be assigned as project managers
-- - Project member roles are 'manager' or 'member' (not 'employee')
-- - Role validation is enforced in the application layer

-- Drop all tables if they exist
DROP TABLE IF EXISTS scheduled_session_tags;
DROP TABLE IF EXISTS scheduled_sessions;
DROP TABLE IF EXISTS session_tags;
DROP TABLE IF EXISTS daily_goals;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS project_members;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS usage_summary;
DROP TABLE IF EXISTS usage;
DROP TABLE IF EXISTS app_settings;
DROP TABLE IF EXISTS users;

-- Create tables
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  avatar TEXT,
  role TEXT DEFAULT 'employee' CHECK(role IN ('admin', 'manager', 'employee'))
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app TEXT,
  title TEXT,
  language TEXT,
  timestamp TEXT,
  user_id INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE usage_summary (
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
);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT,
  is_active INTEGER DEFAULT 1,
  manager_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE project_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT DEFAULT 'member' CHECK(role IN ('manager', 'member')),
  joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE sessions (
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
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  color TEXT,
  UNIQUE(name, user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE session_tags (
  session_id INTEGER,
  tag_id INTEGER,
  PRIMARY KEY (session_id, tag_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE daily_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  time INTEGER NOT NULL, -- in minutes
  description TEXT,
  isCompleted INTEGER DEFAULT 0,
  UNIQUE(user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE scheduled_sessions (
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
);

CREATE TABLE scheduled_session_tags (
  scheduled_session_id INTEGER,
  tag_id INTEGER,
  PRIMARY KEY (scheduled_session_id, tag_id),
  FOREIGN KEY (scheduled_session_id) REFERENCES scheduled_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Insert sample data

-- Users
INSERT INTO users (id, username, avatar, role) VALUES 
(1, 'Admin User', '', 'admin'),
(2, 'Manager Bob', '', 'manager'),
(3, 'Developer Alice', '', 'employee'),
(4, 'Designer Charlie', '', 'employee');

-- Projects
-- Note: Only users with 'admin' or 'manager' roles can be assigned as project managers
INSERT INTO projects (name, description, color, manager_id) VALUES 
('E-commerce Platform', 'Main company e-commerce website', '#3b82f6', 1),
('Mobile App', 'React Native mobile application', '#10b981', 1),
('Admin Dashboard', 'Internal admin panel', '#f59e0b', 2),
('API Microservices', 'Backend API services', '#ef4444', 2),
('Documentation Site', 'Company documentation portal', '#8b5cf6', 2);

-- Project memberships
-- Note: Only users with 'admin' or 'manager' roles can have 'manager' role in projects
INSERT INTO project_members (project_id, user_id, role) VALUES 
-- Project 1: E-commerce Platform
(1, 1, 'manager'),  -- Admin User (admin role)
(1, 3, 'member'),   -- Developer Alice (employee role)
(1, 4, 'member'),   -- Designer Charlie (employee role)
-- Project 2: Mobile App
(2, 1, 'manager'),  -- Admin User (admin role)
(2, 3, 'member'),   -- Developer Alice (employee role)
-- Project 3: Admin Dashboard
(3, 2, 'manager'),  -- Manager Bob (manager role)
(3, 3, 'member'),   -- Developer Alice (employee role)
(3, 4, 'member'),   -- Designer Charlie (employee role)
-- Project 4: API Microservices
(4, 2, 'manager'),  -- Manager Bob (manager role)
(4, 3, 'member'),   -- Developer Alice (employee role)
-- Project 5: Documentation Site
(5, 2, 'manager'),  -- Manager Bob (manager role)
(5, 4, 'member');   -- Designer Charlie (employee role)

-- Tags for each user
INSERT INTO tags (name, user_id, color) VALUES 
-- Admin User tags
('work', 1, '#f0db4f'),
('personal', 1, '#ff6961'),
('urgent', 1, '#7ed957'),
('review', 1, '#4f8cff'),
('frontend', 1, '#ffb347'),
('backend', 1, '#b19cd9'),
('docs', 1, '#f67280'),
-- Manager Bob tags
('work', 2, '#f0db4f'),
('personal', 2, '#ff6961'),
('urgent', 2, '#7ed957'),
('review', 2, '#4f8cff'),
('frontend', 2, '#ffb347'),
('backend', 2, '#b19cd9'),
('docs', 2, '#f67280'),
-- Developer Alice tags
('work', 3, '#f0db4f'),
('personal', 3, '#ff6961'),
('urgent', 3, '#7ed957'),
('review', 3, '#4f8cff'),
('frontend', 3, '#ffb347'),
('backend', 3, '#b19cd9'),
('docs', 3, '#f67280'),
-- Designer Charlie tags
('work', 4, '#f0db4f'),
('personal', 4, '#ff6961'),
('urgent', 4, '#7ed957'),
('review', 4, '#4f8cff'),
('frontend', 4, '#ffb347'),
('backend', 4, '#b19cd9'),
('docs', 4, '#f67280');

-- Sample sessions (simplified - just a few examples)
INSERT INTO sessions (timestamp, start_time, duration, title, description, project_id, is_billable, user_id) VALUES 
-- Admin User sessions
('2025-08-03T09:00:00Z', '2025-08-03T09:00:00Z', 3600, 'Refactor login flow', 'Improved authentication system', 1, 1, 1),
('2025-08-03T14:00:00Z', '2025-08-03T14:00:00Z', 5400, 'Code review', 'Reviewed PR #123', 2, 1, 1),
('2025-08-02T10:30:00Z', '2025-08-02T10:30:00Z', 2700, 'Database migration', 'Updated user schema', 1, 1, 1),
-- Manager Bob sessions
('2025-08-03T08:00:00Z', '2025-08-03T08:00:00Z', 1800, 'Team standup', 'Daily team meeting', 3, 0, 2),
('2025-08-03T15:30:00Z', '2025-08-03T15:30:00Z', 4200, 'API documentation', 'Documented new endpoints', 4, 1, 2),
('2025-08-02T11:00:00Z', '2025-08-02T11:00:00Z', 3000, 'Architecture planning', 'Planned microservices structure', 4, 1, 2),
-- Developer Alice sessions
('2025-08-03T09:30:00Z', '2025-08-03T09:30:00Z', 4800, 'Implement feature X', 'Added shopping cart functionality', 1, 1, 3),
('2025-08-03T16:00:00Z', '2025-08-03T16:00:00Z', 2400, 'Fix bug #123', 'Fixed payment processing issue', 1, 1, 3),
('2025-08-02T13:00:00Z', '2025-08-02T13:00:00Z', 3600, 'Mobile UI components', 'Created reusable components', 2, 1, 3),
-- Designer Charlie sessions
('2025-08-03T10:00:00Z', '2025-08-03T10:00:00Z', 5400, 'UI improvements', 'Redesigned dashboard layout', 3, 1, 4),
('2025-08-03T17:00:00Z', '2025-08-03T17:00:00Z', 1800, 'Design review', 'Reviewed mockups with team', 1, 0, 4),
('2025-08-02T14:30:00Z', '2025-08-02T14:30:00Z', 2700, 'Documentation design', 'Created style guide', 5, 1, 4);

-- Sample daily goals
INSERT INTO daily_goals (user_id, date, time, description, isCompleted) VALUES 
-- Admin User goals
(1, '2025-08-03', 120, 'Focus on bug fixes', 1),
(1, '2025-08-02', 180, 'Code review sessions', 1),
(1, '2025-08-01', 90, 'Team meetings', 0),
-- Manager Bob goals
(2, '2025-08-03', 150, 'Documentation updates', 1),
(2, '2025-08-02', 120, 'Architecture planning', 1),
(2, '2025-08-01', 90, 'Team coordination', 1),
-- Developer Alice goals
(3, '2025-08-03', 240, 'Feature development', 1),
(3, '2025-08-02', 180, 'Bug fixing', 1),
(3, '2025-08-01', 210, 'Code refactoring', 0),
-- Designer Charlie goals
(4, '2025-08-03', 180, 'UI improvements', 1),
(4, '2025-08-02', 120, 'Design reviews', 1),
(4, '2025-08-01', 150, 'Style guide creation', 1);

-- Sample usage data (app usage tracking)
INSERT INTO usage (app, title, language, timestamp, user_id) VALUES 
-- Admin User usage
('Visual Studio Code', 'auth.ts', 'TypeScript', '2025-08-03T09:00:00Z', 1),
('Visual Studio Code', 'user.model.ts', 'TypeScript', '2025-08-03T09:15:00Z', 1),
('Visual Studio Code', 'database.ts', 'TypeScript', '2025-08-03T09:30:00Z', 1),
('Sublime Text', 'config.json', 'JSON', '2025-08-03T14:00:00Z', 1),
('IntelliJ IDEA', 'ApiController.java', 'Java', '2025-08-03T14:30:00Z', 1),
-- Manager Bob usage
('Visual Studio Code', 'api-docs.md', 'Markdown', '2025-08-03T08:00:00Z', 2),
('Visual Studio Code', 'architecture.md', 'Markdown', '2025-08-03T15:30:00Z', 2),
('Notepad++', 'meeting-notes.txt', 'Text', '2025-08-03T16:00:00Z', 2),
('Atom', 'project-specs.md', 'Markdown', '2025-08-03T16:30:00Z', 2),
-- Developer Alice usage
('Visual Studio Code', 'shopping-cart.tsx', 'TypeScript', '2025-08-03T09:30:00Z', 3),
('Visual Studio Code', 'payment.service.ts', 'TypeScript', '2025-08-03T10:00:00Z', 3),
('Visual Studio Code', 'cart.component.tsx', 'TypeScript', '2025-08-03T16:00:00Z', 3),
('WebStorm', 'utils.js', 'JavaScript', '2025-08-03T16:30:00Z', 3),
('Vim', 'deploy.sh', 'Shell', '2025-08-03T17:00:00Z', 3),
-- Designer Charlie usage
('Visual Studio Code', 'main.scss', 'SCSS', '2025-08-03T10:00:00Z', 4),
('Visual Studio Code', 'components.css', 'CSS', '2025-08-03T11:00:00Z', 4),
('Visual Studio Code', 'styles.css', 'CSS', '2025-08-03T17:00:00Z', 4),
('Brackets', 'theme.css', 'CSS', '2025-08-03T17:30:00Z', 4);

-- Sample usage summary (daily aggregated data)
INSERT INTO usage_summary (app, language, lang_ext, date, icon, time_spent, user_id) VALUES 
-- Admin User summary
('Visual Studio Code', 'TypeScript', 'ts', '2025-08-03', 'vscode.svg', 7200, 1),
('Sublime Text', 'JSON', 'json', '2025-08-03', 'sublime.svg', 1800, 1),
('IntelliJ IDEA', 'Java', 'java', '2025-08-03', 'file_type_java.svg', 900, 1),
('Visual Studio Code', 'TypeScript', 'ts', '2025-08-02', 'vscode.svg', 8100, 1),
('Sublime Text', 'JSON', 'json', '2025-08-02', 'sublime.svg', 2400, 1),
-- Manager Bob summary
('Visual Studio Code', 'Markdown', 'md', '2025-08-03', 'vscode.svg', 5400, 2),
('Notepad++', 'Text', 'txt', '2025-08-03', 'file_type_text.svg', 2700, 2),
('Atom', 'Markdown', 'md', '2025-08-03', 'file_type_js.svg', 1800, 2),
('Visual Studio Code', 'Markdown', 'md', '2025-08-02', 'vscode.svg', 6300, 2),
-- Developer Alice summary
('Visual Studio Code', 'TypeScript', 'tsx', '2025-08-03', 'vscode.svg', 10800, 3),
('WebStorm', 'JavaScript', 'js', '2025-08-03', 'webstorm.svg', 1800, 3),
('Vim', 'Shell', 'sh', '2025-08-03', 'vim.svg', 900, 3),
('Visual Studio Code', 'TypeScript', 'tsx', '2025-08-02', 'vscode.svg', 9000, 3),
('WebStorm', 'JavaScript', 'js', '2025-08-02', 'webstorm.svg', 2700, 3),
-- Designer Charlie summary
('Visual Studio Code', 'SCSS', 'scss', '2025-08-03', 'vscode.svg', 7200, 4),
('Visual Studio Code', 'CSS', 'css', '2025-08-03', 'vscode.svg', 1800, 4),
('Brackets', 'CSS', 'css', '2025-08-03', 'file_type_css.svg', 1200, 4),
('Visual Studio Code', 'CSS', 'css', '2025-08-02', 'vscode.svg', 6300, 4),
('Brackets', 'CSS', 'css', '2025-08-02', 'file_type_css.svg', 2700, 4);

-- Sample session tags (linking sessions to tags)
INSERT INTO session_tags (session_id, tag_id) VALUES 
-- Admin User sessions with tags
(1, 1), (1, 5), -- session 1: work, frontend
(2, 1), (2, 4), -- session 2: work, review
(3, 1), (3, 6), -- session 3: work, backend
-- Manager Bob sessions with tags
(4, 8), -- session 4: work (Manager Bob's work tag)
(5, 8), (5, 14), -- session 5: work, docs
(6, 8), (6, 13), -- session 6: work, backend
-- Developer Alice sessions with tags
(7, 15), (7, 19), -- session 7: work, frontend
(8, 15), (8, 17), -- session 8: work, urgent
(9, 15), (9, 19), -- session 9: work, frontend
-- Designer Charlie sessions with tags
(10, 22), (10, 26), -- session 10: work, frontend
(11, 22), (11, 25), -- session 11: work, review
(12, 22), (12, 28); -- session 12: work, docs
