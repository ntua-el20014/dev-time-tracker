export function getCurrentUserId(): number {
  const stored = localStorage.getItem("currentUserId");
  return stored ? Number(stored) : 1; // fallback to 1 if not set
}

// Custom avatar management functions
export function getCustomAvatars(userId: number): string[] {
  const key = `customAvatars_${userId}`;
  const stored = localStorage.getItem(key);
  return stored ? JSON.parse(stored) : [];
}

export function addCustomAvatar(userId: number, dataUrl: string): void {
  const customAvatars = getCustomAvatars(userId);
  // Avoid duplicates
  if (!customAvatars.includes(dataUrl)) {
    customAvatars.push(dataUrl);
    const key = `customAvatars_${userId}`;
    localStorage.setItem(key, JSON.stringify(customAvatars));
  }
}

export function removeCustomAvatar(userId: number, dataUrl: string): void {
  const customAvatars = getCustomAvatars(userId);
  const filtered = customAvatars.filter((avatar) => avatar !== dataUrl);
  const key = `customAvatars_${userId}`;
  localStorage.setItem(key, JSON.stringify(filtered));
}
