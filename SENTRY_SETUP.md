# Sentry Error Logging Setup

## Overview

The app now uses **Sentry** for comprehensive error logging and performance monitoring. Sentry automatically captures:

- Unhandled exceptions in both main and renderer processes
- Promise rejections
- User actions (breadcrumbs) for debugging context
- Performance metrics
- Replay of user sessions (masked for privacy)

## Setup Instructions

### 1. Create a Sentry Project

1. Go to [sentry.io](https://sentry.io) and create an account (free tier available)
2. Create a new organization or use an existing one
3. Create a new project, select **Electron** as the platform
4. Copy your DSN (Data Source Name) — looks like: `https://xxxxx@xxxxx.ingest.sentry.io/12345`

### 2. Configure the DSN

Set the `SENTRY_DSN` environment variable before running the app:

**Windows (PowerShell):**

```powershell
$env:SENTRY_DSN="https://YOUR_DSN_HERE@ingest.sentry.io/YOUR_PROJECT_ID"
npm start
```

**Windows (CMD):**

```cmd
set SENTRY_DSN=https://YOUR_DSN_HERE@ingest.sentry.io/YOUR_PROJECT_ID
npm start
```

**Linux/macOS:**

```bash
export SENTRY_DSN="https://YOUR_DSN_HERE@ingest.sentry.io/YOUR_PROJECT_ID"
npm start
```

### 3. For Production Builds

Add to your CI/CD pipeline or `.env.production`:

```env
SENTRY_DSN=https://YOUR_DSN_HERE@ingest.sentry.io/YOUR_PROJECT_ID
```

## How It Works

### Error Capture

- **Main Process:** Catches `uncaughtException` and `unhandledRejection` events
- **Renderer Process:** Catches window `unhandledrejection` events
- **Network Errors:** Filtered out (expected when offline) to avoid spam
- **Auth Errors:** Reported to Sentry for debugging failed auth flows

### Breadcrumbs

The app automatically logs breadcrumbs for important actions:

```typescript
addBreadcrumb("Session started");
addBreadcrumb("User logged in", { userId: "123" });
addBreadcrumb("Sync failed", { error: "Network timeout" }, "warning");
```

When an error occurs, Sentry includes the breadcrumb trail so you can see exactly what the user was doing.

### User Context

When a user logs in, Sentry is automatically updated with their user ID:

```typescript
setSentryUser(userId);
// When user logs out:
clearSentryUser();
```

This helps you filter and search issues by user.

### Development vs Production

- **Development:** Sentry is **disabled** (no data sent)
- **Production:** Sentry is **enabled** (errors reported)

This prevents cluttering your Sentry dashboard with dev test errors.

## Accessing Sentry Dashboard

1. Log in to [sentry.io](https://sentry.io)
2. Go to your project
3. View:
   - **Issues:** Grouped by error type, most recent first
   - **Releases:** Track errors by app version
   - **Performance:** Monitor app performance
   - **Replays:** Watch user sessions where errors occurred (privacy-masked)

## Key Metrics to Monitor

| Metric             | Purpose                                 |
| ------------------ | --------------------------------------- |
| **Error Rate**     | % of sessions with errors               |
| **Affected Users** | How many users hit this bug             |
| **Release Health** | Track errors per app version            |
| **Performance**    | App transaction times                   |
| **Session Replay** | Recreate the steps leading to the error |

## Example: Debugging an Issue

1. User reports: "Sessions won't save"
2. Check Sentry Issues → see 10 similar errors in last 24h
3. Click an issue → see breadcrumb trail: "User logged in" → "Session started" → "Failed to save session"
4. Click "Replay" → watch exactly what happened before the error
5. Check error context → see network error: "Failed to fetch from Supabase"
6. Find the cause → Supabase connection timeout, needs retry logic

## Privacy & Data

- **User Data:** Not captured (no window/document content, URLs masked)
- **Replays:** Only recorded for error sessions, 5% of normal sessions
- **Breadcrumbs:** Custom data only (user IDs, action names)
- **Storage:** Sentry stores data on their secure servers

## Troubleshooting

### Sentry Not Capturing Errors

- Check `SENTRY_DSN` is set: `echo $env:SENTRY_DSN` (PowerShell)
- Verify you're in production mode: `process.env.NODE_ENV`
- Check Sentry dashboard → Settings → Client Keys to confirm DSN is active

### Too Many Errors Being Reported

- Adjust `beforeSend()` in [src/sentry.ts](src/sentry.ts) to filter more errors
- Increase `tracesSampleRate` to sample fewer errors (e.g., 0.01 = 1%)

### Sensitive Data Leaking

- Check breadcrumb data — don't log passwords, tokens, PII
- Session replay is masked by default but review settings if needed

## For Developers

To manually report an error:

```typescript
import { reportError, addBreadcrumb } from "../src/sentry";

try {
  // Some operation
} catch (error) {
  addBreadcrumb("Operation failed", { step: "save" }, "error");
  reportError(error as Error, { context: "session-save" });
}
```

## Resources

- [Sentry Docs](https://docs.sentry.io/)
- [Sentry Electron Guide](https://docs.sentry.io/platforms/javascript/guides/electron/)
- [Sentry Performance Monitoring](https://docs.sentry.io/product/performance/)
- [Session Replay](https://docs.sentry.io/product/session-replay/)
