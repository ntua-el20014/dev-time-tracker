/**
 * Today's Usage Logs Cache
 *
 * Caches the `get-logs` IPC response in localStorage + an in-memory layer so
 * that the logs tab renders instantly on repeat visits.  Uses a
 * stale-while-revalidate strategy: cached data is returned immediately while a
 * background fetch refreshes the value.
 *
 * Only today's logs are cached (they change frequently during active tracking).
 * Historical dates are fetched normally — they rarely change and are not worth
 * the storage overhead.
 */

import type { LogEntry } from "@shared/types";
import { safeIpcInvoke } from "./ipcHelpers";

// ── Config ──────────────────────────────────────────────────────────

const LS_KEY = "cached_today_logs";
const CACHE_TTL = 30_000; // 30 s — logs append every ~5 s while tracking

// ── In-memory layer ─────────────────────────────────────────────────

interface MemEntry {
  date: string;
  logs: LogEntry[];
  ts: number;
}

let mem: MemEntry | null = null;

// ── Helpers ─────────────────────────────────────────────────────────

function todayKey(): string {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
}

function readLS(): MemEntry | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MemEntry;
    // Only accept if the stored date matches today
    if (parsed.date !== todayKey()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLS(entry: MemEntry): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(entry));
  } catch {
    // Storage full — silently ignore
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Get today's usage logs with stale-while-revalidate.
 * For any other date, falls through to a direct IPC call.
 */
export async function getLogsCached(date?: string): Promise<LogEntry[]> {
  const requestDate = date ?? todayKey();

  // Only cache today's logs
  if (requestDate !== todayKey()) {
    return safeIpcInvoke<LogEntry[]>("get-logs", [requestDate], {
      fallback: [],
    });
  }

  // Try memory first
  if (mem && mem.date === requestDate && Date.now() - mem.ts < CACHE_TTL) {
    // Still fresh — return cached, no background refresh needed
    return mem.logs;
  }

  // Try localStorage
  const ls = readLS();
  if (ls && Date.now() - ls.ts < CACHE_TTL) {
    mem = ls;
    return ls.logs;
  }

  // Stale data exists — return it immediately but refresh in background
  const stale = mem?.date === requestDate ? mem.logs : (ls?.logs ?? null);

  if (stale !== null) {
    // Fire-and-forget refresh
    refreshLogsCache(requestDate);
    return stale;
  }

  // No cached data at all — must wait for IPC
  return refreshLogsCache(requestDate);
}

/**
 * Force-refresh the cache for a given date and return the fresh logs.
 */
async function refreshLogsCache(date: string): Promise<LogEntry[]> {
  const logs = await safeIpcInvoke<LogEntry[]>("get-logs", [date], {
    fallback: [],
    showNotification: false,
  });

  const entry: MemEntry = { date, logs, ts: Date.now() };
  mem = entry;
  if (date === todayKey()) writeLS(entry);
  return logs;
}

/**
 * Invalidate the logs cache.
 * Call after session start / stop / delete or any mutation that affects today's logs.
 */
export function invalidateLogsCache(): void {
  mem = null;
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    // ignore
  }
}
