import Database from 'better-sqlite3';
const db = new Database('usage.db');

db.prepare(`
  CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app TEXT,
    title TEXT,
    language TEXT,
    timestamp TEXT,
    icon TEXT
  )
`).run();

export function logWindow(app: string, title: string, lang: string | null, icon: string) {
  // Store SVG icon as TEXT directly
  db.prepare(`INSERT INTO usage (app, title, language, timestamp, icon) VALUES (?, ?, ?, ?, ?)`)
    .run(app, title, lang, new Date().toISOString(), icon);
}

export function getLogs() {
  return db.prepare('SELECT app, title, language, timestamp, icon FROM usage ORDER BY id DESC LIMIT 100').all();
}
