import db from "./db";
import { notifyRenderer } from "../utils/ipcHelp";
import { getLocalDateString } from "../utils/timeFormat";
import { Tag, SessionRow } from "./types";
import { v4 as uuidv4 } from "uuid";

export function getSessions(
  userId: number,
  filters?: {
    tag?: string;
    startDate?: string;
    endDate?: string;
    projectId?: number;
    billableOnly?: boolean;
  }
) {
  try {
    let query = `
      SELECT 
        s.id, s.timestamp, s.start_time, s.duration, s.title, s.description,
        s.project_id, s.is_billable,
        p.name as project_name, p.color as project_color,
        GROUP_CONCAT(t.name, ',') as tag_names
      FROM sessions s
      LEFT JOIN projects p ON s.project_id = p.id
      LEFT JOIN session_tags st ON s.id = st.session_id
      LEFT JOIN tags t ON st.tag_id = t.id
      WHERE s.user_id = ?
    `;
    const params: (string | number)[] = [userId];

    if (filters?.startDate) {
      query += " AND date(s.timestamp) >= date(?)";
      params.push(filters.startDate);
    }
    if (filters?.endDate) {
      query += " AND date(s.timestamp) <= date(?)";
      params.push(filters.endDate);
    }
    if (filters?.projectId) {
      query += " AND s.project_id = ?";
      params.push(filters.projectId);
    }
    if (filters?.billableOnly === true) {
      query += " AND s.is_billable = 1";
    } else if (filters?.billableOnly === false) {
      query += " AND s.is_billable = 0";
    }
    if (filters?.tag) {
      query += `
        AND s.id IN (
          SELECT st2.session_id
          FROM session_tags st2
          JOIN tags t2 ON t2.id = st2.tag_id
          WHERE t2.name = ? AND t2.user_id = ?
        )
      `;
      params.push(filters.tag, userId);
    }

    query += " GROUP BY s.id ORDER BY s.timestamp DESC";

    const sessions = db.prepare(query).all(...params) as (SessionRow & {
      tag_names: string;
    })[];

    // Process tags and add date
    return sessions.map((session) => {
      const { tag_names, ...sessionData } = session;
      return {
        ...sessionData,
        tags: tag_names ? tag_names.split(",").filter(Boolean) : [],
        date: getLocalDateString(new Date(session.timestamp)),
      };
    });
  } catch (err) {
    notifyRenderer("Failed to load sessions.", 5000);
    return [];
  }
}

export function addSession(
  userId: number,
  _date: string,
  start_time: string,
  duration: number,
  title: string,
  description?: string,
  tags?: string[],
  projectId?: number,
  isBillable: boolean = false
) {
  try {
    const now = new Date();
    const timestamp = now.toISOString();
    const info = db
      .prepare(
        `
      INSERT INTO sessions (local_id, timestamp, start_time, duration, title, description, project_id, is_billable, user_id, synced, last_modified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `
      )
      .run(
        uuidv4(),
        timestamp,
        start_time,
        duration,
        title,
        description || null,
        projectId || null,
        isBillable ? 1 : 0,
        userId,
        timestamp
      );
    const sessionId = info.lastInsertRowid as number;
    if (tags && tags.length) setSessionTags(userId, sessionId, tags);

    // Send success notification to renderer
    notifyRenderer(`Session "${title}" saved successfully!`);
  } catch (err) {
    notifyRenderer("Failed to add session.", 5000);
  }
}

export function editSession(
  userId: number,
  id: number,
  title: string,
  description: string,
  tags?: string[],
  projectId?: number,
  isBillable: boolean = false
) {
  try {
    db.prepare(
      `
      UPDATE sessions SET title = ?, description = ?, project_id = ?, is_billable = ?, synced = 0, last_modified = ? WHERE id = ?
    `
    ).run(
      title,
      description,
      projectId || null,
      isBillable ? 1 : 0,
      new Date().toISOString(),
      id
    );
    if (tags) setSessionTags(userId, id, tags);
  } catch (err) {
    notifyRenderer("Failed to update session.", 5000);
  }
}

export function deleteSession(id: number) {
  try {
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
  } catch (err) {
    notifyRenderer("Failed to delete session.", 5000);
  }
}

export function getAllTags(userId: number): Tag[] {
  try {
    return db
      .prepare(
        `SELECT * FROM tags WHERE user_id = ? ORDER BY name COLLATE NOCASE`
      )
      .all(userId) as Tag[];
  } catch (err) {
    notifyRenderer("Failed to load tags.", 5000);
    return [];
  }
}

export function addTag(
  userId: number,
  name: string,
  color?: string
): number | undefined {
  try {
    if (!color) color = "#f0db4f";
    const info = db
      .prepare(
        `INSERT INTO tags (local_id, name, user_id, color, synced, last_modified) VALUES (?, ?, ?, ?, 0, ?)`
      )
      .run(uuidv4(), name, userId, color, new Date().toISOString());
    return info.lastInsertRowid as number;
  } catch {
    try {
      const row = db
        .prepare(`SELECT id FROM tags WHERE name = ? AND user_id = ?`)
        .get(name, userId) as { id: number } | undefined;
      return row?.id;
    } catch (err) {
      notifyRenderer("Failed to add or fetch tag.", 5000);
      return undefined;
    }
  }
}

export function setTagColor(userId: number, tagName: string, color: string) {
  db.prepare(
    `UPDATE tags SET color = ?, synced = 0, last_modified = ? WHERE name = ? AND user_id = ?`
  ).run(color, new Date().toISOString(), tagName, userId);
}

export function setSessionTags(
  userId: number,
  sessionId: number,
  tagNames: string[]
) {
  try {
    db.prepare(`DELETE FROM session_tags WHERE session_id = ?`).run(sessionId);
    for (const name of tagNames) {
      // Try to get existing tag color
      const tag = db
        .prepare(`SELECT id, color FROM tags WHERE name = ? AND user_id = ?`)
        .get(name, userId) as { id: number; color?: string } | undefined;
      let tagId: number | undefined;
      if (tag) {
        tagId = tag.id;
      } else {
        // Use default accent color if not found
        tagId = addTag(userId, name, "#f0db4f");
      }
      if (tagId !== undefined) {
        db.prepare(
          `INSERT OR IGNORE INTO session_tags (local_id, session_id, tag_id, synced, last_modified) VALUES (?, ?, ?, ?, ?)`
        ).run(uuidv4(), sessionId, tagId, 0, new Date().toISOString());
      }
    }
  } catch (err) {
    notifyRenderer("Failed to set session tags.", 5000);
  }
}

export function getSessionTags(sessionId: number): string[] {
  try {
    return db
      .prepare(
        `
      SELECT t.name FROM tags t
      JOIN session_tags st ON t.id = st.tag_id
      WHERE st.session_id = ?
      ORDER BY t.name COLLATE NOCASE
    `
      )
      .all(sessionId)
      .map((row: any) => row.name);
  } catch (err) {
    notifyRenderer("Failed to load session tags.", 5000);
    return [];
  }
}

export function deleteTag(userId: number, name: string) {
  try {
    const tag = db
      .prepare(`SELECT id FROM tags WHERE name = ? AND user_id = ?`)
      .get(name, userId) as { id: number } | undefined;
    if (tag) {
      db.prepare(`DELETE FROM session_tags WHERE tag_id = ?`).run(tag.id);
      db.prepare(`DELETE FROM tags WHERE id = ?`).run(tag.id);
    }
  } catch (err) {
    notifyRenderer("Failed to delete tag.", 5000);
  }
}

// Database migration functions

export function getAllSessionsData() {
  return db.prepare("SELECT * FROM sessions").all();
}
export function getAllTagsData() {
  return db.prepare("SELECT * FROM tags").all();
}
export function getAllSessionTagsData() {
  return db.prepare("SELECT * FROM session_tags").all();
}

export function clearSessions() {
  db.prepare("DELETE FROM sessions").run();
}
export function importSessions(sessionsArr: any[]) {
  const stmt = db.prepare(
    "INSERT INTO sessions (id, local_id, timestamp, start_time, duration, title, description, project_id, is_billable, user_id, synced, last_modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const row of sessionsArr) {
    stmt.run(
      row.id,
      uuidv4(),
      row.timestamp,
      row.start_time,
      row.duration,
      row.title,
      row.description,
      row.project_id || null,
      row.is_billable || 0,
      row.user_id,
      0,
      new Date().toISOString()
    );
  }
}
export function clearTags() {
  db.prepare("DELETE FROM tags").run();
}
export function importTags(tagsArr: any[]) {
  const stmt = db.prepare(
    "INSERT INTO tags (id, local_id, name, user_id, color, synced, last_modified) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  for (const row of tagsArr) {
    stmt.run(
      row.id,
      uuidv4(),
      row.name,
      row.user_id,
      row.color,
      0,
      new Date().toISOString()
    );
  }
}
export function clearSessionTags() {
  db.prepare("DELETE FROM session_tags").run();
}
export function importSessionTags(sessionTagsArr: any[]) {
  const stmt = db.prepare(
    "INSERT INTO session_tags (local_id, session_id, tag_id, synced, last_modified) VALUES (?, ?, ?, ?, ?)"
  );
  for (const row of sessionTagsArr) {
    stmt.run(uuidv4(), row.session_id, row.tag_id, 0, new Date().toISOString());
  }
}
