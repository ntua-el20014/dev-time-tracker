/**
 * Sync Status Indicator (renderer-side)
 *
 * Shows a small badge next to the Connection Status pill when there are
 * offline-queued writes waiting to be synced to Supabase.
 *
 * Listens for:
 *   - `sync-status-update` IPC event from main process
 *   - Manual refresh via `refreshSyncStatus()`
 *
 * Also triggers an immediate flush when the browser comes back online.
 */

import { ipcRenderer } from "electron";
import { onConnectionStateChange, ConnectionState } from "./ConnectionStatus";

// ── Types (mirror main-process SyncStatus) ──────────────────────────

export interface SyncStatus {
  pendingCount: number;
  isSyncing: boolean;
  lastSyncTime: string | null;
  lastError: string | null;
}

// ── State ───────────────────────────────────────────────────────────

let badgeEl: HTMLElement | null = null;
let currentStatus: SyncStatus = {
  pendingCount: 0,
  isSyncing: false,
  lastSyncTime: null,
  lastError: null,
};
let unsubConnection: (() => void) | null = null;

// ── Render ──────────────────────────────────────────────────────────

function render(): void {
  if (!badgeEl) return;

  const { pendingCount, isSyncing } = currentStatus;

  if (pendingCount === 0 && !isSyncing) {
    badgeEl.style.display = "none";
    return;
  }

  badgeEl.style.display = "inline-flex";

  const dot = badgeEl.querySelector(".sync-dot") as HTMLElement | null;
  const label = badgeEl.querySelector(".sync-label") as HTMLElement | null;

  if (isSyncing) {
    if (dot) {
      dot.setAttribute("data-state", "syncing");
    }
    if (label) {
      label.textContent = `Syncing${pendingCount > 0 ? ` (${pendingCount})` : ""}…`;
    }
    badgeEl.title = "Flushing queued data to server…";
  } else {
    if (dot) {
      dot.setAttribute("data-state", "pending");
    }
    if (label) {
      label.textContent = `${pendingCount} pending`;
    }
    badgeEl.title = `${pendingCount} event${pendingCount !== 1 ? "s" : ""} pending sync — click to retry`;
  }
}

function createBadge(): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "sync-status";
  wrapper.style.display = "none";

  wrapper.innerHTML = `
    <span class="sync-dot" data-state="pending"></span>
    <span class="sync-label"></span>
  `;

  // Click to force-flush
  wrapper.addEventListener("click", () => {
    ipcRenderer.invoke("flush-offline-queue").catch(() => {
      /* swallow — main process logs errors */
    });
  });

  return wrapper;
}

// ── IPC listener ────────────────────────────────────────────────────

function onSyncStatusUpdate(_event: unknown, status: SyncStatus): void {
  currentStatus = status;
  render();
}

// ── Connection state integration ────────────────────────────────────

function onConnectionChange(state: ConnectionState): void {
  if (state === "online" && currentStatus.pendingCount > 0) {
    // We just came back online and have queued data — trigger immediate flush
    ipcRenderer.invoke("flush-offline-queue").catch(() => {});
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Mount the sync status badge and start listening for updates.
 * Should be called after `initConnectionStatus()`.
 */
export function initSyncStatus(): void {
  if (badgeEl) return; // already mounted

  badgeEl = createBadge();

  // Mount next to the connection status pill (inside #mainUI or body)
  const target = document.getElementById("mainUI") ?? document.body;
  target.appendChild(badgeEl);

  // Listen for main-process sync broadcasts
  ipcRenderer.on("sync-status-update", onSyncStatusUpdate);

  // Subscribe to connection state changes for auto-flush
  unsubConnection = onConnectionStateChange(onConnectionChange);

  // Fetch initial status
  refreshSyncStatus();
}

/**
 * Tear down the badge and remove listeners.
 */
export function destroySyncStatus(): void {
  ipcRenderer.removeListener("sync-status-update", onSyncStatusUpdate);
  if (unsubConnection) {
    unsubConnection();
    unsubConnection = null;
  }
  badgeEl?.remove();
  badgeEl = null;
}

/**
 * Manually query the main process for the current sync status.
 */
export async function refreshSyncStatus(): Promise<SyncStatus> {
  try {
    const status = await ipcRenderer.invoke("get-sync-status");
    currentStatus = status;
    render();
    return status;
  } catch {
    return currentStatus;
  }
}

/**
 * Get the current sync status synchronously (last known value).
 */
export function getSyncStatusLocal(): SyncStatus {
  return currentStatus;
}
