/**
 * Connection Status Indicator
 * Shows a small pill in the top-right corner of the main UI
 * reflecting whether the app is online and can reach Supabase.
 */

import { supabase } from "../../src/supabase/client";
import { showInAppNotification } from "./Notifications";

// ── Types ───────────────────────────────────────────────────────────

export type ConnectionState = "online" | "offline" | "degraded";

interface ConnectionStatusOptions {
  /** How often (ms) to ping Supabase when online. Default 60 000 (1 min). */
  pingInterval?: number;
  /** Element to mount the indicator into. Falls back to document.body. */
  mountTarget?: HTMLElement;
}

// ── State ───────────────────────────────────────────────────────────

let currentState: ConnectionState = navigator.onLine ? "online" : "offline";
let indicatorEl: HTMLElement | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let lastNotifiedState: ConnectionState | null = null;

// ── Listeners ───────────────────────────────────────────────────────

type StateListener = (state: ConnectionState) => void;
const listeners: StateListener[] = [];

export function onConnectionStateChange(fn: StateListener): () => void {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

function notifyListeners() {
  for (const fn of listeners) {
    try {
      fn(currentState);
    } catch {
      // swallow listener errors
    }
  }
}

// ── Core logic ──────────────────────────────────────────────────────

/**
 * Lightweight ping: SELECT 1 via Supabase REST.
 * Returns true if the round-trip succeeds.
 */
async function pingSupabase(): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("user_profiles")
      .select("id")
      .limit(1)
      .maybeSingle();
    return !error;
  } catch {
    return false;
  }
}

async function refreshState(): Promise<void> {
  const browserOnline = navigator.onLine;

  if (!browserOnline) {
    setState("offline");
    return;
  }

  // Browser says online — verify Supabase reachability
  const supabaseOk = await pingSupabase();
  setState(supabaseOk ? "online" : "degraded");
}

function setState(next: ConnectionState): void {
  const prev = currentState;
  currentState = next;
  renderIndicator();

  if (prev !== next) {
    notifyListeners();

    // Show a notification on meaningful transitions (not on initial load)
    if (lastNotifiedState !== null) {
      if (next === "offline") {
        showInAppNotification(
          "You are offline. Some features may be unavailable.",
        );
      } else if (next === "degraded") {
        showInAppNotification("Unable to reach the server. Data may be stale.");
      } else if (prev !== "online" && next === "online") {
        showInAppNotification("Connection restored.");
      }
    }
    lastNotifiedState = next;
  }
}

// ── UI ──────────────────────────────────────────────────────────────

const LABELS: Record<ConnectionState, string> = {
  online: "Online",
  offline: "Offline",
  degraded: "Limited",
};

const TOOLTIP: Record<ConnectionState, string> = {
  online: "Connected to server",
  offline: "No internet connection",
  degraded: "Internet available but server unreachable",
};

function renderIndicator(): void {
  if (!indicatorEl) return;

  // Update state attribute (CSS drives colours)
  indicatorEl.setAttribute("data-state", currentState);
  indicatorEl.title = TOOLTIP[currentState];

  const dot = indicatorEl.querySelector(".conn-dot") as HTMLElement | null;
  const label = indicatorEl.querySelector(".conn-label") as HTMLElement | null;
  if (label) label.textContent = LABELS[currentState];
  if (dot) dot.setAttribute("data-state", currentState);
}

function createIndicator(): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "connection-status";
  wrapper.setAttribute("data-state", currentState);
  wrapper.title = TOOLTIP[currentState];

  wrapper.innerHTML = `
    <span class="conn-dot" data-state="${currentState}"></span>
    <span class="conn-label">${LABELS[currentState]}</span>
  `;

  // Click to force-refresh
  wrapper.addEventListener("click", () => {
    wrapper.classList.add("conn-checking");
    refreshState().finally(() => {
      wrapper.classList.remove("conn-checking");
    });
  });

  return wrapper;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Mount the connection indicator and start monitoring.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initConnectionStatus(opts: ConnectionStatusOptions = {}): void {
  const { pingInterval = 60_000, mountTarget } = opts;

  // Prevent double-init
  if (indicatorEl) return;

  indicatorEl = createIndicator();
  const target =
    mountTarget ?? document.getElementById("mainUI") ?? document.body;
  target.appendChild(indicatorEl);

  // Browser online/offline events
  window.addEventListener("online", () => refreshState());
  window.addEventListener("offline", () => setState("offline"));

  // Periodic Supabase ping
  pingTimer = setInterval(() => refreshState(), pingInterval);

  // Initial check (skip the first notification)
  lastNotifiedState = null;
  refreshState();
}

/**
 * Tear down the indicator and stop monitoring.
 */
export function destroyConnectionStatus(): void {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  indicatorEl?.remove();
  indicatorEl = null;
  lastNotifiedState = null;
}

/**
 * Get current connection state synchronously.
 */
export function getConnectionState(): ConnectionState {
  return currentState;
}
