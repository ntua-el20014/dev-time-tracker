/**
 * Daily Goal Cache
 *
 * Centralises fetches for `get-daily-goal` and `get-total-time-for-day` so that
 * dashboardTab, logsTab, and the periodic goal-checker in renderer.ts all share
 * the same cached values instead of issuing separate IPC round-trips.
 *
 * The cache is keyed by date string (YYYY-MM-DD) with a short TTL.
 * Any mutation (set/delete/complete goal) should call `invalidateDailyGoalCache()`.
 */

import { safeIpcInvoke } from "./ipcHelpers";

// ── Types ───────────────────────────────────────────────────────────

export interface DailyGoalInfo {
  time: number;
  description?: string;
  isCompleted: boolean;
}

interface CacheEntry {
  goal: DailyGoalInfo | null;
  totalMins: number;
  ts: number;
}

// ── Config ──────────────────────────────────────────────────────────

const CACHE_TTL = 15_000; // 15 seconds — short enough to stay fresh

// ── State ───────────────────────────────────────────────────────────

const cache = new Map<string, CacheEntry>();

// ── Public API ──────────────────────────────────────────────────────

/**
 * Get today's (or any date's) daily goal + total tracked minutes.
 * Returns cached data if still fresh, otherwise fetches from IPC.
 */
export async function getDailyGoalCached(
  date?: string,
): Promise<{ goal: DailyGoalInfo | null; totalMins: number }> {
  const key = date ?? new Date().toLocaleDateString("en-CA");
  const existing = cache.get(key);

  if (existing && Date.now() - existing.ts < CACHE_TTL) {
    return { goal: existing.goal, totalMins: existing.totalMins };
  }

  // Fetch both in parallel
  const [goal, totalMins] = await Promise.all([
    safeIpcInvoke<DailyGoalInfo | null>("get-daily-goal", [key], {
      fallback: null,
      showNotification: false,
    }),
    safeIpcInvoke<number>("get-total-time-for-day", [key], {
      fallback: 0,
      showNotification: false,
    }),
  ]);

  cache.set(key, { goal, totalMins, ts: Date.now() });
  return { goal, totalMins };
}

/**
 * Invalidate cache for a specific date (or all dates).
 * Call after set-daily-goal, delete-daily-goal, complete-daily-goal, or
 * after session start/stop (which changes totalMins).
 */
export function invalidateDailyGoalCache(date?: string): void {
  if (date) {
    cache.delete(date);
  } else {
    cache.clear();
  }
}
