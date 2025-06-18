/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

const db = new (Database as any)('usage.db');

// --- Utility functions ---
function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randomChoice<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)];
}
function pad(n: number) {
  return n < 10 ? '0' + n : n;
}

function toDateString(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// --- Dummy data ---
const editors = [
  { app: 'VS Code', icon: svgToDataUri('icons/vscode.svg') },
  { app: 'WebStorm', icon: svgToDataUri('icons/webstorm.svg') },
  { app: 'PyCharm', icon: svgToDataUri('icons/pycharm.svg') },
  { app: 'Sublime Text', icon: svgToDataUri('icons/sublime.svg') },
  { app: 'Vim', icon: svgToDataUri('icons/vim.svg') },
];
const languages = [
  { language: 'TypeScript', lang_ext: '.ts' },
  { language: 'JavaScript', lang_ext: '.js' },
  { language: 'Python', lang_ext: '.py' },
  { language: 'HTML', lang_ext: '.html' },
  { language: 'SQL', lang_ext: '.sql' },
  { language: 'Markdown', lang_ext: '.md' },
];
const sessionTitles = [
  'Refactor login flow', 'Fix bug #123', 'Write documentation', 'Implement feature X',
  'Database migration', 'Code review', 'Optimize queries', 'UI improvements'
];
const tags = ['work', 'personal', 'urgent', 'review', 'frontend', 'backend', 'docs'];
const tagColors = [
  '#f0db4f', '#ff6961', '#7ed957', '#4f8cff', '#ffb347',
  '#b19cd9', '#f67280', '#355c7d', '#ffb6b9', '#c1c8e4',
  '#ffe156', '#6a0572', '#ff6f3c', '#00b8a9', '#f6416c',
  '#43dde6', '#e7e6e1', '#f9f871', '#a28089', '#f7b32b',
  '#2d4059', '#ea5455', '#ffd460', '#40514e', '#11999e'
];

// --- Main population logic ---
function populateDummyUsers() {
  db.prepare(`INSERT OR IGNORE INTO users (id, username, avatar) VALUES (1, 'Default', ''), (2, 'Bob', '')`).run();
}

function populateUsageAndSummary(userId: number, days = 30) {
  for (let i = 0; i < days; ++i) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = toDateString(date);

    // Each day, random number of editor/language combos
    const combos = randomInt(2, 4);
    for (let j = 0; j < combos; ++j) {
      const editor = randomChoice(editors);
      const lang = randomChoice(languages);
      const timeSpent = randomInt(600, 7200); // 10 min to 2 hours

      // Insert into usage_summary
      db.prepare(`
        INSERT INTO usage_summary (app, language, lang_ext, date, icon, time_spent, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(app, language, date, user_id)
        DO UPDATE SET 
          time_spent = time_spent + excluded.time_spent,
          icon = CASE WHEN usage_summary.icon IS NULL OR usage_summary.icon = '' THEN excluded.icon ELSE usage_summary.icon END,
          lang_ext = CASE WHEN excluded.lang_ext IS NOT NULL THEN excluded.lang_ext ELSE usage_summary.lang_ext END
      `).run(editor.app, lang.language, lang.lang_ext, dateStr, editor.icon, timeSpent, userId);
    }
  }
}

function populateSessions(userId: number, days= 30) {
  for (let i = 0; i < days; ++i) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const sessionCount = randomInt(1, 3);
    for (let j = 0; j < sessionCount; ++j) {
      const start = new Date(date);
      start.setHours(randomInt(8, 20), randomInt(0, 59), 0, 0);
      const duration = randomInt(600, 5400); // 10 min to 1.5h
      const title = randomChoice(sessionTitles);
      const description = Math.random() > 0.5 ? 'Some notes about this session.' : null;

      db.prepare(`
        INSERT INTO sessions (timestamp, start_time, duration, title, description, user_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        start.toISOString(),
        start.toISOString(),
        duration,
        title,
        description,
        userId
      );
    }
  }
}

function populateTags(userId: number) {
  tags.forEach((tag, i) => {
    const color = tagColors[i % tagColors.length];
    db.prepare(`INSERT OR IGNORE INTO tags (name, user_id, color) VALUES (?, ?, ?)`).run(tag, userId, color);
  });
}

function assignTagsToSessions(userId: number) {
  const sessionRows = db.prepare(`SELECT id FROM sessions WHERE user_id = ?`).all(userId);
  const tagRows = db.prepare(`SELECT id FROM tags WHERE user_id = ?`).all(userId) as { id: number }[];

  sessionRows.forEach((session: { id: number }) => {
    // Assign 1-3 random tags to each session
    const tagCount = randomInt(1, 3);
    const shuffled = tagRows.slice().sort(() => Math.random() - 0.5);
    for (let i = 0; i < tagCount; ++i) {
      db.prepare(`INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES (?, ?)`)
        .run(session.id, shuffled[i].id);
    }
  });
}

function svgToDataUri(svgPath: string): string {
  const absPath = path.resolve(__dirname, '..', 'public', svgPath);
  const svg = fs.readFileSync(absPath, 'utf8');
  const base64 = Buffer.from(svg, 'utf8').toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}

function populateDailyGoals(userId: number, days = 10) {
  for (let i = 0; i < days; ++i) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = toDateString(date);
    const time = randomInt(30, 180); // 30 to 180 minutes
    const description = randomChoice([
      'Focus on bug fixes',
      'UI improvements',
      'Write tests',
      'Documentation',
      'Refactor modules',
      'Experiment with new tech',
      'Pair programming',
      'Code review',
      'Optimize performance',
      'General coding'
    ]);
    const isCompleted = Math.random() > 0.3 ? 1 : 0; // Most goals completed

    db.prepare(`
      INSERT OR IGNORE INTO daily_goals (user_id, date, time, description, isCompleted)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, dateStr, time, description, isCompleted);
  }
}

// --- Run population ---
console.log('Populating dummy data...');
populateDummyUsers();
[1, 2].forEach(userId => {
  populateUsageAndSummary(userId, 30);
  populateSessions(userId, 30);
  populateTags(userId);
  assignTagsToSessions(userId);
  populateDailyGoals(userId, 10); // <-- Add this line
});
console.log('Done!');
// Exit the process
process.exit(0);

// To run: npx ts-node src/populateDummyData.ts