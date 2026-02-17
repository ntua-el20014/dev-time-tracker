/**
 * Centralized error handling utilities for the main process.
 *
 * Provides:
 * - Consistent error logging with context
 * - Error classification (auth, network, unknown)
 * - Retry with exponential backoff for transient failures
 */

// ── Error Classification ────────────────────────────────────────────

export type ErrorCategory = "auth" | "network" | "unknown";

export function classifyError(error: unknown): ErrorCategory {
  const message = extractMessage(error);
  const lower = message.toLowerCase();

  if (
    lower.includes("jwt") ||
    lower.includes("auth") ||
    lower.includes("unauthorized") ||
    lower.includes("not authenticated") ||
    lower.includes("session expired") ||
    lower.includes("invalid token") ||
    lower.includes("refresh_token") ||
    lower.includes("user not authenticated")
  ) {
    return "auth";
  }

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
    return "network";
  }

  return "unknown";
}

/**
 * Extract a human-readable message from any thrown value.
 */
function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    if ("message" in error && typeof (error as any).message === "string") {
      return (error as any).message;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }
  return String(error ?? "Unknown error");
}

// ── Logging ─────────────────────────────────────────────────────────

/**
 * Log an error with context. Always writes to stderr (console.error)
 * so it appears in Electron's dev-tools console and any log collectors.
 */
export function logError(context: string, error: unknown): void {
  const category = classifyError(error);
  const message = extractMessage(error);
  const timestamp = new Date().toISOString();

  // eslint-disable-next-line no-console
  console.error(
    `[${timestamp}] [${category.toUpperCase()}] ${context}: ${message}`,
  );

  // In development, also log the stack trace for unknown errors
  if (category === "unknown" && error instanceof Error && error.stack) {
    // eslint-disable-next-line no-console
    console.error(error.stack);
  }
}

// ── Retry ───────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 3 */
  maxAttempts?: number;
  /** Base delay in ms before first retry. Default: 1000 */
  baseDelayMs?: number;
  /** Maximum delay in ms (caps exponential growth). Default: 10000 */
  maxDelayMs?: number;
  /** Only retry for these error categories. Default: ["network"] */
  retryOn?: ErrorCategory[];
  /** Optional context string for logging retries */
  context?: string;
}

/**
 * Execute an async function with exponential backoff retry.
 * Only retries on transient (network) errors by default.
 *
 * @example
 * await withRetry(() => logUsage(userId, app, title, lang), {
 *   context: "trackActiveWindow",
 *   maxAttempts: 3,
 * });
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 10_000,
    retryOn = ["network"],
    context = "withRetry",
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const category = classifyError(error);

      // Don't retry non-retryable errors (e.g., auth or unknown)
      if (!retryOn.includes(category)) {
        throw error;
      }

      if (attempt < maxAttempts) {
        const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
        logError(
          `${context} (attempt ${attempt}/${maxAttempts}, retrying in ${delay}ms)`,
          error,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        logError(
          `${context} (attempt ${attempt}/${maxAttempts}, giving up)`,
          error,
        );
      }
    }
  }

  throw lastError;
}
