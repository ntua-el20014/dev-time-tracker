/**
 * User Preferences Cache
 *
 * Caches the full user preferences object in localStorage so that
 * theme, accent colour, and other settings apply instantly on app start
 * without waiting for the Supabase round-trip.
 *
 * Strategy: **write-through**
 *  • Reads:  return cached value immediately; refresh in background.
 *  • Writes: update localStorage *and* send IPC in parallel.
 *
 * Call `invalidatePreferencesCache()` on sign-out to clear stale data.
 */

import { safeIpcInvoke } from "./ipcHelpers";

// ── Types (mirror what the backend returns) ─────────────────────────

export interface CachedPreferences {
  theme: "light" | "dark" | "system";
  accent_color: { light: string; dark: string };
  editor_colors: Record<string, string>;
  notification_settings: {
    enabled: boolean;
    scheduledSessions: boolean;
    dailyGoals: boolean;
  };
  idle_timeout_seconds: number;
}

// ── Constants ───────────────────────────────────────────────────────

const STORAGE_KEY = "cache:user-preferences";
const CACHE_TTL = 60_000; // 1 minute – background refresh interval
const DEFAULTS: CachedPreferences = {
  theme: "dark",
  accent_color: { light: "#007acc", dark: "#f0db4f" },
  editor_colors: {},
  notification_settings: {
    enabled: true,
    scheduledSessions: true,
    dailyGoals: true,
  },
  idle_timeout_seconds: 300,
};

// ── In-memory layer (faster than hitting localStorage every time) ───

let memCache: CachedPreferences | null = null;
let memCacheTs = 0;

// ── Helpers ─────────────────────────────────────────────────────────

function readFromStorage(): CachedPreferences | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedPreferences;
  } catch {
    return null;
  }
}

function writeToStorage(prefs: CachedPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage full or blocked — not critical
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Get user preferences – returns instantly from cache, then refreshes
 * in the background if the cache is stale.
 */
export async function getCachedPreferences(): Promise<CachedPreferences> {
  // 1. Try in-memory
  if (memCache && Date.now() - memCacheTs < CACHE_TTL) {
    return memCache;
  }

  // 2. Try localStorage
  const stored = readFromStorage();
  if (stored) {
    memCache = stored;
    memCacheTs = Date.now();
    // Background refresh (fire-and-forget)
    refreshPreferencesInBackground();
    return stored;
  }

  // 3. Fetch from backend (first load / cleared cache)
  return await forceRefreshPreferences();
}

/**
 * Get a single preference field instantly from cache.
 */
export function getCachedTheme(): "light" | "dark" | "system" {
  if (memCache) return memCache.theme;
  const stored = readFromStorage();
  return stored?.theme ?? DEFAULTS.theme;
}

export function getCachedAccentColor(mode: "light" | "dark"): string {
  if (memCache) return memCache.accent_color[mode];
  const stored = readFromStorage();
  return stored?.accent_color?.[mode] ?? DEFAULTS.accent_color[mode];
}

/**
 * Update preferences – writes to cache AND sends IPC.
 * Returns immediately after cache write; IPC happens async.
 */
export async function updateCachedPreference(
  key: keyof CachedPreferences,
  value: unknown,
): Promise<void> {
  // Ensure we have a base to merge into
  const current = memCache ?? readFromStorage() ?? { ...DEFAULTS };
  (current as any)[key] = value;
  memCache = current;
  memCacheTs = Date.now();
  writeToStorage(current);
}

/**
 * Update the full preferences cache with a partial update.
 */
export function patchCachedPreferences(
  partial: Partial<CachedPreferences>,
): void {
  const current = memCache ?? readFromStorage() ?? { ...DEFAULTS };
  Object.assign(current, partial);
  memCache = current;
  memCacheTs = Date.now();
  writeToStorage(current);
}

/**
 * Force a full refresh from Supabase (bypasses cache).
 */
export async function forceRefreshPreferences(): Promise<CachedPreferences> {
  const prefs = await safeIpcInvoke<CachedPreferences>(
    "get-user-preferences",
    [],
    { fallback: DEFAULTS, showNotification: false },
  );
  memCache = prefs;
  memCacheTs = Date.now();
  writeToStorage(prefs);
  return prefs;
}

/**
 * Fire-and-forget background refresh.
 */
function refreshPreferencesInBackground(): void {
  forceRefreshPreferences().catch(() => {
    // Silently ignore – stale cache is better than no data
  });
}

/**
 * Invalidate cache (call on sign-out or user switch).
 */
export function invalidatePreferencesCache(): void {
  memCache = null;
  memCacheTs = 0;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
