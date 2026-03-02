import { safeIpcInvoke } from "./ipcHelpers";

/**
 * Get the current authenticated user's ID (Supabase UUID string).
 *
 * Primary source: localStorage "currentUserId" (set during Supabase auth).
 * Falls back to querying the main process via IPC if localStorage is empty.
 *
 * @throws Error if no user is authenticated
 */
export function getCurrentUserId(): string {
  const stored = localStorage.getItem("currentUserId");
  if (!stored) {
    throw new Error("No user ID available — user is not authenticated");
  }
  return stored;
}

// Safe version that returns null instead of throwing
export function getCurrentUserIdSafe(): string | null {
  return localStorage.getItem("currentUserId");
}

/**
 * Async version that can check Supabase auth via IPC as a fallback.
 * Useful at startup when localStorage may not yet be populated.
 */
export async function getCurrentUserIdAsync(): Promise<string> {
  const stored = localStorage.getItem("currentUserId");
  if (stored) return stored;

  // Fallback: ask the main process for the authenticated user ID
  const userId = await safeIpcInvoke<string | null>("get-current-user-id", [], {
    fallback: null,
    showNotification: false,
  });

  if (userId) {
    localStorage.setItem("currentUserId", userId);
    return userId;
  }

  throw new Error("No user ID available — user is not authenticated");
}

// ── Role Cache ──────────────────────────────────────────────────────
// Avoids re-fetching the user's role on every tab switch / render.
// Cached per userId with a short TTL (30 s). Invalidated on sign-out.
interface RoleCacheEntry {
  role: string; // "admin" | "manager" | "member" | …
  ts: number;
}

const ROLE_CACHE_TTL = 30_000; // 30 seconds
let _roleCache: RoleCacheEntry | null = null;

/** Clear the cached role (call on sign-out or role change). */
export function clearRoleCache(): void {
  _roleCache = null;
}

/** Get the current user's role, using a short-lived cache. */
export async function getCurrentUserRole(): Promise<string> {
  const userId = getCurrentUserIdSafe();
  if (!userId) return "member";

  if (_roleCache && Date.now() - _roleCache.ts < ROLE_CACHE_TTL) {
    return _roleCache.role;
  }

  const role = await safeIpcInvoke<string>("get-user-role", [userId], {
    fallback: "member",
    showNotification: false,
  });
  _roleCache = { role, ts: Date.now() };
  return role;
}

// Role-based access control helpers
export async function isCurrentUserAdmin(): Promise<boolean> {
  const role = await getCurrentUserRole();
  return role === "admin";
}

export async function isCurrentUserManagerOrAdmin(): Promise<boolean> {
  const role = await getCurrentUserRole();
  return role === "admin" || role === "manager";
}

export async function getCurrentUserInfo() {
  const userId = getCurrentUserIdSafe();
  if (!userId) return null;
  return await safeIpcInvoke("get-user-info", [userId], {
    fallback: null,
    showNotification: false,
  });
}

// Custom avatar management functions (support both string and number IDs)
export function getCustomAvatars(userId: string | number): string[] {
  const key = `customAvatars_${userId}`;
  const stored = localStorage.getItem(key);
  return stored ? JSON.parse(stored) : [];
}

export function addCustomAvatar(
  userId: string | number,
  dataUrl: string,
): void {
  const customAvatars = getCustomAvatars(userId);
  // Avoid duplicates
  if (!customAvatars.includes(dataUrl)) {
    customAvatars.push(dataUrl);
    const key = `customAvatars_${userId}`;
    localStorage.setItem(key, JSON.stringify(customAvatars));
  }
}

export function removeCustomAvatar(
  userId: string | number,
  dataUrl: string,
): void {
  const customAvatars = getCustomAvatars(userId);
  const filtered = customAvatars.filter((avatar) => avatar !== dataUrl);
  const key = `customAvatars_${userId}`;
  localStorage.setItem(key, JSON.stringify(filtered));
}
