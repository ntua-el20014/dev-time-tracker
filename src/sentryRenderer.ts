/**
 * Sentry configuration for the Electron renderer process.
 */

import * as SentryRenderer from "@sentry/electron/renderer";
import { getEnv } from "./buildEnv";

export function initSentryRenderer() {
  const isDev = process.env.NODE_ENV === "development";
  const dsn = getEnv("SENTRY_DSN") || "";

  SentryRenderer.init({
    dsn,
    enabled: !isDev && dsn !== "",
    environment: isDev ? "development" : "production",
    release: getEnv("APP_VERSION"),
    maxBreadcrumbs: 100,
    tracesSampleRate: 0.1,
    beforeSend(event: any, hint: SentryRenderer.EventHint) {
      const error = hint.originalException;
      if (error instanceof Error) {
        const message = error.message.toLowerCase();
        if (message.includes("abort") || message.includes("network")) {
          return null;
        }
      }

      return event;
    },
  });

  try {
    const userId = localStorage.getItem("userId");
    if (userId) {
      SentryRenderer.setUser({ id: userId });
    }
  } catch {
    // localStorage may not be available in all renderer contexts.
  }

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    SentryRenderer.captureException(event.reason);
  });
}

export function addBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
  level: SentryRenderer.SeverityLevel = "info",
) {
  // Breadcrumbs ride along with the next captured error; they must not be
  // sent as events of their own (that would be one event per user action).
  SentryRenderer.addBreadcrumb({
    message,
    level,
    data,
    timestamp: Date.now() / 1000,
  });
}

export function setSentryUser(userId: string, email?: string) {
  SentryRenderer.setUser({
    id: userId,
    email,
  });
}

export function clearSentryUser() {
  SentryRenderer.setUser(null);
}

export function setSentryContext(
  contextName: string,
  context: Record<string, unknown>,
) {
  SentryRenderer.setContext(contextName, context);
}

export function reportError(error: Error, context?: Record<string, unknown>) {
  if (context) {
    setSentryContext("error-context", context);
  }

  SentryRenderer.captureException(error);
}