/**
 * IPC call wrapper with network error handling.
 * Provides consistent error handling for all Supabase-backed IPC calls.
 */
import { ipcRenderer } from "electron";
import { showInAppNotification } from "../components/Notifications";

/**
 * Error types that can occur during IPC calls to Supabase-backed handlers.
 */
export type IpcErrorType = "network" | "auth" | "not-found" | "unknown";

export interface IpcError {
  type: IpcErrorType;
  message: string;
  original?: unknown;
}

/**
 * Classify an error from an IPC call.
 */
function classifyError(error: unknown): IpcError {
  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  const lower = message.toLowerCase();

  // Network / connectivity errors
  if (
    lower.includes("fetch") ||
    lower.includes("network") ||
    lower.includes("enotfound") ||
    lower.includes("econnrefused") ||
    lower.includes("econnreset") ||
    lower.includes("timeout") ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("abort") ||
    lower.includes("dns")
  ) {
    return {
      type: "network",
      message: "Network error. Please check your internet connection.",
      original: error,
    };
  }

  // Auth errors
  if (
    lower.includes("jwt") ||
    lower.includes("auth") ||
    lower.includes("unauthorized") ||
    lower.includes("not authenticated") ||
    lower.includes("session expired") ||
    lower.includes("invalid token") ||
    lower.includes("refresh_token")
  ) {
    return {
      type: "auth",
      message: "Authentication error. Please sign in again.",
      original: error,
    };
  }

  // Not found
  if (lower.includes("not found") || lower.includes("no user")) {
    return {
      type: "not-found",
      message: "The requested data was not found.",
      original: error,
    };
  }

  return { type: "unknown", message, original: error };
}

/**
 * Options for safeIpcInvoke.
 */
interface SafeIpcOptions<T> {
  /** Default value to return on error (avoids throwing) */
  fallback?: T;
  /** Whether to show an in-app notification on error (default: true) */
  showNotification?: boolean;
  /** Custom error message to show (overrides auto-classification) */
  errorMessage?: string;
  /** Whether to rethrow the error after handling (default: false) */
  rethrow?: boolean;
}

/**
 * Safely invoke an IPC channel with automatic error handling.
 * Returns the result on success, or the fallback value on error.
 *
 * @example
 * // With fallback – never throws
 * const sessions = await safeIpcInvoke("get-sessions", [userId], { fallback: [] });
 *
 * // Without fallback – throws on error (caller must catch)
 * const goal = await safeIpcInvoke("get-daily-goal", [userId, today]);
 */
export async function safeIpcInvoke<T = unknown>(
  channel: string,
  args: unknown[] = [],
  options: SafeIpcOptions<T> = {},
): Promise<T> {
  const {
    fallback,
    showNotification: notify = true,
    errorMessage,
    rethrow = false,
  } = options;

  try {
    const result = await ipcRenderer.invoke(channel, ...args);
    return result as T;
  } catch (error) {
    const classified = classifyError(error);

    if (notify) {
      const msg = errorMessage || classified.message;
      showInAppNotification(msg);
    }

    if (rethrow) {
      throw error;
    }

    if (fallback !== undefined) {
      return fallback;
    }

    // If no fallback, throw so caller can handle
    throw error;
  }
}

/**
 * Check if the app is currently online.
 */
export function isOnline(): boolean {
  return navigator.onLine;
}

/**
 * Show a network error notification if offline.
 * Returns true if offline (caller should abort the operation).
 */
export function checkOffline(): boolean {
  if (!navigator.onLine) {
    showInAppNotification(
      "You are offline. Please check your internet connection.",
    );
    return true;
  }
  return false;
}
