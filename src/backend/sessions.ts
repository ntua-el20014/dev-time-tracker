/* eslint-disable @typescript-eslint/no-explicit-any */
import db from './db';
import { notifyRenderer } from '../utils/ipcHelp';
import { getLocalDateString } from '../utils/timeFormat';
import { Tag, SessionRow } from './types';

export function getSessions(userId: number) {
  try {
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

export function addTag(userId: number, name: string, color?: string): number | undefined {
  try {
    if (!color) color = '#f0db4f';
    const info = db.prepare(`INSERT INTO tags (name, user_id, color) VALUES (?, ?, ?)`).run(name, userId, color);
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

export function setTagColor(userId: number, tagName: string, color: string) {
  db.prepare(`UPDATE tags SET color = ? WHERE name = ? AND user_id = ?`).run(color, tagName, userId);
}

export function setSessionTags(userId: number, sessionId: number, tagNames: string[]) {
  try {
    db.prepare(`DELETE FROM session_tags WHERE session_id = ?`).run(sessionId);
    for (const name of tagNames) {
      // Try to get existing tag color
      const tag = db.prepare(`SELECT id, color FROM tags WHERE name = ? AND user_id = ?`).get(name, userId) as { id: number, color?: string } | undefined;
      let tagId: number | undefined;
      if (tag) {
        tagId = tag.id;
      } else {
        // Use default accent color if not found
        tagId = addTag(userId, name, '#f0db4f');
      }
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

// Database migration functions

export function getAllSessionsData() {
  return db.prepare('SELECT * FROM sessions').all();
}
export function getAllTagsData() {
  return db.prepare('SELECT * FROM tags').all();
}
export function getAllSessionTagsData() {
  return db.prepare('SELECT * FROM session_tags').all();
}

export function clearSessions() {
  db.prepare('DELETE FROM sessions').run();
}
export function importSessions(sessionsArr: any[]) {
  const stmt = db.prepare('INSERT INTO sessions (id, timestamp, start_time, duration, title, description, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const row of sessionsArr) {
    stmt.run(row.id, row.timestamp, row.start_time, row.duration, row.title, row.description, row.user_id);
  }
}
export function clearTags() {
  db.prepare('DELETE FROM tags').run();
}
export function importTags(tagsArr: any[]) {
  const stmt = db.prepare('INSERT INTO tags (id, name, user_id, color) VALUES (?, ?, ?, ?)');
  for (const row of tagsArr) {
    stmt.run(row.id, row.name, row.user_id, row.color);
  }
}
export function clearSessionTags() {
  db.prepare('DELETE FROM session_tags').run();
}
export function importSessionTags(sessionTagsArr: any[]) {
  const stmt = db.prepare('INSERT INTO session_tags (session_id, tag_id) VALUES (?, ?)');
  for (const row of sessionTagsArr) {
    stmt.run(row.session_id, row.tag_id);
  }
}