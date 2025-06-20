import db from './db';
import { notifyRenderer } from '../utils/ipcHelp';

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

export function getUserInfo(userId: number): { id: number, username: string, avatar: string } | undefined {
  return db.prepare(`SELECT id, username, avatar FROM users WHERE id = ?`).get(userId) as { id: number, username: string, avatar: string } | undefined;
}

export function setUserAvatar(userId: number, avatar: string) {
  db.prepare(`UPDATE users SET avatar = ? WHERE id = ?`).run(avatar, userId);
}

// Database migration functions

export function clearUsers() {
  db.prepare('DELETE FROM users').run();
}
export function importUsers(usersArr: { id: number, username: string, avatar: string }[]) {
  const stmt = db.prepare('INSERT INTO users (id, username, avatar) VALUES (?, ?, ?)');
  for (const row of usersArr) {
    stmt.run(row.id, row.username, row.avatar);
  }
}