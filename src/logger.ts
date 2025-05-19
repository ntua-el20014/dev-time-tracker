import Database from 'better-sqlite3';
const db = new Database('usage.db');

db.prepare(`
  CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app TEXT,
    title TEXT,
    timestamp TEXT
  )
`).run();

export function logWindow(app: string, title: string) {
  db.prepare(`INSERT INTO usage (app, title, timestamp) VALUES (?, ?, ?)`)
    .run(app, title, new Date().toISOString());
}

export function getLogs() {
  return db.prepare('SELECT app, title, timestamp FROM usage ORDER BY id DESC LIMIT 100').all();
}
