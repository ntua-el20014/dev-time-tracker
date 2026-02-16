import { ipcRenderer } from "electron";
import { safeIpcInvoke } from "./ipcHelpers";

export function getCurrentUserId(): string {
  const stored = localStorage.getItem("currentUserId");
  if (!stored) {
    throw new Error("No user ID available");
  }
  return stored;
}

// Safe version that returns null instead of throwing
export function getCurrentUserIdSafe(): string | null {
  const stored = localStorage.getItem("currentUserId");
  return stored;
}

// Legacy support for numeric user IDs (for backward compatibility)
export function getCurrentUserIdLegacy(): number {
  const stored = localStorage.getItem("currentUserId");
  // If it's a UUID, try to get legacy local_id from backend
  if (stored && stored.includes("-")) {
    // This is a UUID, we need to handle this differently
    return 1; // fallback for now
  }
  return stored ? Number(stored) : 1;
}

// Role-based access control helpers
export async function isCurrentUserAdmin(): Promise<boolean> {
  try {
    const userId = getCurrentUserId();
    return await safeIpcInvoke("is-user-admin", [userId], {
      fallback: false,
      showNotification: false,
    });
  } catch (error) {
    const legacyId = getCurrentUserIdLegacy();
    return await safeIpcInvoke("is-user-admin", [legacyId], {
      fallback: false,
      showNotification: false,
    });
  }
}

export async function isCurrentUserManagerOrAdmin(): Promise<boolean> {
  try {
    const userId = getCurrentUserId();
    return await safeIpcInvoke("is-user-manager-or-admin", [userId], {
      fallback: false,
      showNotification: false,
    });
  } catch (error) {
    const legacyId = getCurrentUserIdLegacy();
    return await safeIpcInvoke("is-user-manager-or-admin", [legacyId], {
      fallback: false,
      showNotification: false,
    });
  }
}

export async function getCurrentUserInfo() {
  try {
    const userId = getCurrentUserId();
    return await safeIpcInvoke("get-user-info", [userId], {
      fallback: null,
      showNotification: false,
    });
  } catch (error) {
    const legacyId = getCurrentUserIdLegacy();
    return await safeIpcInvoke("get-user-info", [legacyId], {
      fallback: null,
      showNotification: false,
    });
  }
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
