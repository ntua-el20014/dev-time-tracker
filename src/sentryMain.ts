/**
 * Sentry configuration for the Electron main process.
 */

import * as SentryMain from "@sentry/electron/main";
import { getEnv } from "./buildEnv";

export function initSentryMain() {
  const isDev = process.env.NODE_ENV === "development";
  const dsn = getEnv("SENTRY_DSN") || "";

  SentryMain.init({
    dsn,
    enabled: !isDev && dsn !== "",
    environment: isDev ? "development" : "production",
    release: getEnv("APP_VERSION"),
    maxBreadcrumbs: 100,
    tracesSampleRate: 0.1,
    beforeSend(event: any, hint: SentryMain.EventHint) {
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
}

export function addBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
  level: SentryMain.SeverityLevel = "info",
) {
  // Breadcrumbs ride along with the next captured error; they must not be
  // sent as events of their own (that would be one event per user action).
  SentryMain.addBreadcrumb({
    message,
    level,
    data,
    timestamp: Date.now() / 1000,
  });
}

export function reportError(error: Error, context?: Record<string, unknown>) {
  if (context) {
    SentryMain.setContext("error-context", context);
  }

  SentryMain.captureException(error);
}