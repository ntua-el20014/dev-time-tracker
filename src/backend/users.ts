import db from "./db";
import { notifyRenderer } from "../utils/ipcHelp";
import { UserRole } from "../../shared/types";

// --- User management functions ---
export function createUser(
  username: string,
  avatar = "",
  role: UserRole = UserRole.EMPLOYEE
): number | undefined {
  try {
    const info = db
      .prepare(`INSERT INTO users (username, avatar, role) VALUES (?, ?, ?)`)
      .run(username, avatar, role);
    return info.lastInsertRowid as number;
  } catch {
    const row = db
      .prepare(`SELECT id FROM users WHERE username = ?`)
      .get(username) as { id: number } | undefined;
    return row?.id;
  }
}

export function getAllUsers(): {
  id: number;
  username: string;
  avatar: string;
  role: UserRole;
}[] {
  return db
    .prepare(`SELECT id, username, avatar, role FROM users ORDER BY username`)
    .all() as {
    id: number;
    username: string;
    avatar: string;
    role: UserRole;
  }[];
}

export function setCurrentUser(userId: number) {
  db.prepare(
    `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('current_user', ?)`
  ).run(String(userId));
}

export function getCurrentUser(): number {
  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = 'current_user'`)
    .get() as { value: string } | undefined;
  return row ? Number(row.value) : 1;
}

export function deleteUser(userId: number) {
  try {
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
  } catch (err) {
    notifyRenderer("Failed to delete user.", 5000);
  }
}

export function getUserInfo(
  userId: number
):
  | { id: number; username: string; avatar: string; role: UserRole }
  | undefined {
  return db
    .prepare(`SELECT id, username, avatar, role FROM users WHERE id = ?`)
    .get(userId) as
    | { id: number; username: string; avatar: string; role: UserRole }
    | undefined;
}

export function setUserRole(userId: number, role: UserRole) {
  try {
    db.prepare(`UPDATE users SET role = ? WHERE id = ?`).run(role, userId);
  } catch (err) {
    notifyRenderer("Failed to update user role.", 5000);
  }
}

export function setUserAvatar(userId: number, avatar: string) {
  db.prepare(`UPDATE users SET avatar = ? WHERE id = ?`).run(avatar, userId);
}

// Database migration functions

export function clearUsers() {
  db.prepare("DELETE FROM users").run();
}

export function importUsers(
  usersArr: { id: number; username: string; avatar: string; role?: UserRole }[]
) {
  const stmt = db.prepare(
    "INSERT INTO users (id, username, avatar, role) VALUES (?, ?, ?, ?)"
  );
  for (const row of usersArr) {
    stmt.run(row.id, row.username, row.avatar, row.role || UserRole.EMPLOYEE);
  }
}

// Helper function to check if user has admin privileges
export function isUserAdmin(userId: number): boolean {
  const user = getUserInfo(userId);
  return user?.role === UserRole.ADMIN;
}

// Helper function to check if user has manager or admin privileges
export function isUserManagerOrAdmin(userId: number): boolean {
  const user = getUserInfo(userId);
  return user?.role === UserRole.ADMIN || user?.role === UserRole.MANAGER;
}

// Initialize default admin user if none exist
export function ensureAdminExists() {
  const users = getAllUsers();
  const hasAdmin = users.some((user) => user.role === UserRole.ADMIN);

  if (!hasAdmin) {
    // If user with ID 1 exists, make them admin, otherwise create admin user
    const firstUser = users.find((user) => user.id === 1);
    if (firstUser) {
      setUserRole(1, UserRole.ADMIN);
    } else {
      createUser("Admin", "", UserRole.ADMIN);
    }
  }
}
