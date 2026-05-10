/**
 * Sentry configuration for the Electron main process.
 */

import * as SentryMain from "@sentry/electron/main";

export function initSentryMain() {
  const isDev = process.env.NODE_ENV === "development";

  SentryMain.init({
    dsn: process.env.SENTRY_DSN || "",
    enabled: !isDev,
    environment: isDev ? "development" : "production",
    release: process.env.npm_package_version,
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
  SentryMain.captureMessage(message, level);
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