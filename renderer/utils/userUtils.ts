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

// Role-based access control helpers
export async function isCurrentUserAdmin(): Promise<boolean> {
  const userId = getCurrentUserIdSafe();
  if (!userId) return false;
  return await safeIpcInvoke("is-user-admin", [userId], {
    fallback: false,
    showNotification: false,
  });
}

export async function isCurrentUserManagerOrAdmin(): Promise<boolean> {
  const userId = getCurrentUserIdSafe();
  if (!userId) return false;
  return await safeIpcInvoke("is-user-manager-or-admin", [userId], {
    fallback: false,
    showNotification: false,
  });
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
