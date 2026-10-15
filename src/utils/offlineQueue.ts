/**
 * Offline Queue — persists critical writes locally when Supabase is unreachable.
 *
 * Queued item types:
 *   - usage_log  — one per tracking tick (every 10 s)
 *   - session    — one per completed tracking session
 *
 * Storage: flat JSON file at  ~/.dev-time-tracker/offline-queue.json
 * Each item carries an idempotency key so duplicates are skipped on flush.
 *
 * The queue is flushed:
 *   1. Automatically via a periodic timer (every 30 s)
 *   2. Whenever an enqueue detects the queue was previously empty (immediate retry)
 *   3. Manually via the `flush()` export
 */

import fs from "fs";
import path from "path";
import os from "os";
import { BrowserWindow } from "electron";
import { CONFIG_DIR } from "../../shared/constants";
import { logUsage } from "../supabase/usageLogs";
import { addSession, type SupervisingTime } from "../supabase/timeTracking";
import { supabase } from "../supabase/config";
import { logError, classifyError } from "./errorHandler";

// ── Types ────────────────────────────────────────────────────────────

export interface QueuedUsageLog {
  type: "usage_log";
  /** ISO timestamp for ordering */
  queuedAt: string;
  /** Idempotency key: `usage_log:<userId>:<logTimestamp>` */
  key: string;
  data: {
    userId: string;
    appName: string;
    windowTitle: string;
    language: string | null;
    languageExtension: string | null;
    iconUrl: string | null;
    intervalSeconds: number;
    /** The original log timestamp (NOT the queue time) */
    logTimestamp: string;
  };
}

export interface QueuedSession {
  type: "session";
  queuedAt: string;
  /** Idempotency key: `session:<userId>:<startTime>` */
  key: string;
  data: {
    userId: string;
    startTime: string;
    duration: number;
    title: string;
    description?: string;
    tags?: string[];
    projectId?: string;
    isBillable: boolean;
    /** Wall-clock end (absent on items queued by older versions) */
    endTime?: string;
    supervising?: SupervisingTime;
  };
}

export type QueueItem = QueuedUsageLog | QueuedSession;

export interface SyncStatus {
  pendingCount: number;
  isSyncing: boolean;
  lastSyncTime: string | null;
  lastError: string | null;
}

// ── File path ────────────────────────────────────────────────────────

const QUEUE_DIR = path.join(os.homedir(), CONFIG_DIR);
const QUEUE_FILE = path.join(QUEUE_DIR, "offline-queue.json");

// ── In-memory state ──────────────────────────────────────────────────

let queue: QueueItem[] = [];
let isSyncing = false;
let lastSyncTime: string | null = null;
let lastError: string | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
/** Set of idempotency keys currently in the queue (fast duplicate check) */
const keySet = new Set<string>();

// ── Persistence ──────────────────────────────────────────────────────

function ensureDir(): void {
  if (!fs.existsSync(QUEUE_DIR)) {
    fs.mkdirSync(QUEUE_DIR, { recursive: true });
  }
}

function loadFromDisk(): void {
  try {
    ensureDir();
    if (fs.existsSync(QUEUE_FILE)) {
      const raw = fs.readFileSync(QUEUE_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        queue = parsed;
        keySet.clear();
        for (const item of queue) keySet.add(item.key);
      }
    }
  } catch (err) {
    logError("offlineQueue.loadFromDisk", err);
    queue = [];
    keySet.clear();
  }
}

function saveToDisk(): void {
  try {
    ensureDir();
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), "utf-8");
  } catch (err) {
    logError("offlineQueue.saveToDisk", err);
  }
}

// ── Notify renderer ──────────────────────────────────────────────────

function broadcastSyncStatus(): void {
  const status = getSyncStatus();
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send("sync-status-update", status);
    } catch {
      // window may have been destroyed
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Initialise the queue: load from disk and start the periodic flush timer.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initOfflineQueue(): void {
  if (flushTimer) return; // already initialised
  loadFromDisk();
  // Flush every 30 seconds
  flushTimer = setInterval(() => {
    if (queue.length > 0 && !isSyncing) {
      flush().catch(() => {
        /* swallow — flush logs internally */
      });
    }
  }, 30_000);
  broadcastSyncStatus();
}

/**
 * Shut down the queue: stop the timer and persist to disk.
 */
export function destroyOfflineQueue(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  saveToDisk();
}

/**
 * Enqueue a usage log write that failed due to a network error.
 */
export function enqueueUsageLog(
  userId: string,
  appName: string,
  windowTitle: string,
  language: string | null,
  languageExtension: string | null,
  iconUrl: string | null,
  intervalSeconds: number,
  logTimestamp?: string,
): void {
  const ts = logTimestamp || new Date().toISOString();
  const key = `usage_log:${userId}:${ts}`;
  if (keySet.has(key)) return; // duplicate

  const item: QueuedUsageLog = {
    type: "usage_log",
    queuedAt: new Date().toISOString(),
    key,
    data: {
      userId,
      appName,
      windowTitle,
      language,
      languageExtension,
      iconUrl,
      intervalSeconds,
      logTimestamp: ts,
    },
  };

  queue.push(item);
  keySet.add(key);
  saveToDisk();
  broadcastSyncStatus();
}

/**
 * Enqueue a session write that failed due to a network error.
 */
export function enqueueSession(
  userId: string,
  startTime: string,
  duration: number,
  title: string,
  description?: string,
  tags?: string[],
  projectId?: string,
  isBillable: boolean = false,
  endTime?: string,
  supervising?: SupervisingTime,
): void {
  const key = `session:${userId}:${startTime}`;
  if (keySet.has(key)) return; // duplicate

  const item: QueuedSession = {
    type: "session",
    queuedAt: new Date().toISOString(),
    key,
    data: {
      userId,
      startTime,
      duration,
      title,
      description,
      tags,
      projectId,
      isBillable,
      endTime,
      supervising,
    },
  };

  queue.push(item);
  keySet.add(key);
  saveToDisk();
  broadcastSyncStatus();
}

/**
 * Attempt to flush the signed-in user's queued items to Supabase.
 * Items are processed in order; the first network/auth failure aborts the
 * run (remaining items stay queued for the next attempt).
 *
 * Returns the number of items successfully flushed.
 */
export async function flush(): Promise<number> {
  if (isSyncing || queue.length === 0) return 0;

  // Only flush while signed in, and only the signed-in user's items.
  // Without a session every write fails RLS, which would otherwise be
  // treated as permanent and discard the queued data.
  let sessionUserId: string | undefined;
  try {
    const { data } = await supabase.auth.getSession();
    sessionUserId = data.session?.user.id;
  } catch {
    sessionUserId = undefined;
  }
  if (!sessionUserId) return 0;

  isSyncing = true;
  lastError = null;
  broadcastSyncStatus();

  let flushed = 0;
  let i = 0;

  while (i < queue.length) {
    const item = queue[i];

    // Another account's data waits until that account signs in again
    if (item.data.userId !== sessionUserId) {
      i++;
      continue;
    }

    try {
      if (item.type === "usage_log") {
        const d = item.data;
        await logUsage(
          d.userId,
          d.appName,
          d.windowTitle,
          d.language,
          d.languageExtension,
          d.iconUrl,
          d.intervalSeconds,
          d.logTimestamp,
        );
      } else if (item.type === "session") {
        const d = item.data;
        await addSession(
          d.userId,
          d.startTime,
          d.duration,
          d.title,
          d.description,
          d.tags,
          d.projectId,
          d.isBillable,
          d.endTime,
          d.supervising,
        );
      }

      // Success — remove from queue
      queue.splice(i, 1);
      keySet.delete(item.key);
      flushed++;
    } catch (err) {
      const category = classifyError(err);

      if (category === "network" || category === "auth") {
        // Offline or session problem — stop, keep remaining items
        lastError =
          category === "network"
            ? "Network unavailable — will retry automatically."
            : "Not signed in — will retry after sign-in.";
        break;
      }

      // Other errors (e.g. duplicate row, constraint violation) won't
      // succeed on retry. Log and discard so they don't block the queue.
      logError(`offlineQueue.flush [${item.type}] — discarding`, err);
      queue.splice(i, 1);
      keySet.delete(item.key);
      flushed++; // count as "processed" even though it failed permanently
    }
  }

  if (flushed > 0) {
    lastSyncTime = new Date().toISOString();
    saveToDisk();
  }

  isSyncing = false;
  broadcastSyncStatus();
  return flushed;
}

/**
 * Get the current sync status (for IPC / renderer).
 */
export function getSyncStatus(): SyncStatus {
  return {
    pendingCount: queue.length,
    isSyncing,
    lastSyncTime,
    lastError,
  };
}

/**
 * Get the number of items currently in the queue.
 */
export function getPendingCount(): number {
  return queue.length;
}
