/**
 * Sentry configuration for the Electron renderer process.
 */

import * as SentryRenderer from "@sentry/electron/renderer";

export function initSentryRenderer() {
  const isDev = process.env.NODE_ENV === "development";

  SentryRenderer.init({
    dsn: process.env.SENTRY_DSN || "",
    enabled: !isDev,
    environment: isDev ? "development" : "production",
    release: process.env.npm_package_version,
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
  SentryRenderer.captureMessage(message, level);
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