# CLAUDE.md — Dev Time Tracker

Guide for working in this repo: how the code is laid out, the conventions to follow, known problems, and the roadmap we agreed to work from.
Written 2026-10-14 after a full read-through. Phase A (Part 4) has since been implemented; Part 2 describes the code as it was *before* Phase A. Line numbers will drift, so search by function name.

---

## Part 1 — How the codebase works

### What it is
An Electron 28 desktop app, written in TypeScript and bundled with webpack via Electron Forge. It records **sessions** (Start/Stop timer with pause) and, while a session is running, takes a sample of the **foreground window** every N seconds (default 10). Each sample stores app, window title, and a language guessed from the file extension in the title. All data lives in **Supabase** (Postgres + Auth + RLS); there is no local database. Built on top of that: goals, scheduled sessions, tags, projects, organizations with roles, billable hours, PDF invoices, standup summaries, team analytics, an offline queue, Sentry, and an auto-updater.

### Commands
```
npm start                 # dev (electron-forge start, webpack HMR)
npm test                  # vitest (~300 tests, mocked Supabase — ~10s)
npm run type-check        # main + renderer tsconfigs
npm run lint              # eslint
npm run make              # installers
```
Baseline as of 2026-10-14: tests, type-check and lint are all green. Keep them green.

### Processes and the boundary between them
```
renderer/  (UI — contextIsolation, sandbox, NO Node access)
   │  import { ipcRenderer } from "renderer/ipc.ts"   ← shim over window.electronAPI
   │  safeIpcInvoke() (renderer/utils/ipcHelpers.ts) wraps it with error handling
   ▼
src/preload.ts  — contextBridge: window.electronAPI = { invoke, send, on, removeAllListeners }
   ▼
src/ipc/*Handlers.ts + src/tracking/tracker.ts  (main) — ipcMain.handle channels; each resolves the user itself
   ▼
src/supabase/*.ts  — thin query modules, one per domain, throw on error
   ▼
Supabase (RLS enforces per-user / per-org access)
```
- **The renderer cannot `import` from `"electron"` or use Node built-ins.** It is built for the `web` target. Use `renderer/ipc.ts`. Treat everything coming from the renderer as untrusted input in main. Examples: `open-oauth-url` only opens http(s); exports only write to dialog-approved paths.
- **There are still two Supabase clients.** The renderer has one (localStorage) and main has one (in-memory). The renderer pushes its tokens to main through `sync-auth-session`. **Only the renderer client auto-refreshes tokens** (`autoRefreshToken` is on only when `window` exists), so the two can't rotate the refresh token out from under each other. Some renderer code still queries Supabase directly: `renderer/utils/organizationApi.ts`, `src/supabase/orgAnalytics.ts` (via `teamAnalyticsTab`), `ConnectionStatus.ts`, `oauthHandler.ts`.
- The handler files register themselves as an import side effect (`import "./ipc/xHandlers"` in `src/index.ts`). `src/utils/langMap.ts` also registers handlers this way.

### The tracking engine (`src/tracking/`)
**The main process owns the recording state.** The renderer and tray only request changes, and render the `tracking-state` broadcast (`{isRecording, isPaused, autoPaused, isIncognito}`). On the renderer side, `renderer/trackingControls.ts` mirrors that state and exposes `startTracking`/`stopTracking`/`togglePause`/… Never flip recording state locally.

| Module | Role |
|---|---|
| `tracker.ts` | Orchestrator with Electron dependencies: tick and flush timers, idle poll, lock/sleep handling, session-info prompt, session save, quit finalization, tracking IPC (`get-tracking-state`, `start/pause/resume/stop-tracking`, `toggle-incognito`). The user ID comes from `setTrackingUser()`, called by `sync-auth-session`, so ticks make no auth network call. On sign-in it also loads the user's saved idle timeout and tracking interval. |
| `sessionClock.ts` | Pure timing: active seconds excluding pauses, manual vs automatic pause, stop → `{start, end, duration}` |
| `idlePolicy.ts` | Pure rules: pause when idle ≥ timeout; resume an *automatic* pause when idle < 5s and not locked or suspended |
| `usageSampler.ts` | Foreground window (x-win) → `{appName, windowTitle, language, languageExtension, icon}`. Matches `execName` against `assets/known_editors.json` plus per-user `custom-apps-<uid>.json`; **unknown apps are dropped**. Language comes from `getLanguageDataFromTitle()` (`src/utils/extractData.ts`). |
| `usageBatcher.ts` | Buffers ticks; every 60s (and on pause/stop/sign-out/quit) does **one INSERT** into `usage_logs` plus one `update_daily_usage_summary` RPC per (local day, app, language). Network failure → offline queue. Icons are sent once per summary row. The Today tab refreshes on each flush (`window-tracked`). |

Flows:
- **Stop:** the clock stops and state resets immediately. If ≥10s, main asks the renderer for title/project/billing (`get-session-info` ↔ `session-info-reply`, 10-min timeout → "Untitled Session" + `session-info-timeout`), then saves with `end_time`.
- **Quit:** `hasUnsavedTrackingWork()` / `finalizeTrackingForQuit()` settle an open prompt, save a running or paused session, and flush usage.
- **Tray:** calls the tracker directly.
- **Batching tradeoff:** a crash loses at most ~60s of usage samples, never the session.

`daily_usage_summary` is keyed by `(user_id, date, app_name, language)` with NULLs not distinct; `date` is the user's **local** day.

**Session time and usage time are two separate measurements and nothing reconciles them.**
- Session `duration` is active time: wall-clock time between Start and Stop, minus pauses. `end_time` is the wall-clock end (set since Phase A; older rows have NULL).
- Usage time is (number of samples where a *known* app was focused) × interval.
- `usage_logs.session_id` exists in the schema but is never written. Session details are found by time range instead (`getUsageDetailsForSession`).
- Daily goals, dashboard "time today" and the language/editor charts read `daily_usage_summary` (usage time). Billing, invoices, standups and project stats read sessions.

### Data model (`database/schema.sql` — the whole database in one file; `database/README.md` explains setup, reset and the security model)
Tables:
- `organizations`, `user_profiles` (role: admin/manager/employee), `org_join_requests`, `org_invite_codes`
- `cloud_projects` (scope personal|organization, `hourly_rate`), `project_members`
- `time_tracking_sessions` (`is_billable` NOT NULL; the trigger derives `duration` from `end_time` only when `duration` is NULL)
- `usage_logs`, `daily_usage_summary`
- `user_tags`, `session_tags`, `daily_work_goals`, `scheduled_work_sessions`, `scheduled_session_tags`
- `user_preferences` (theme, accent JSON, editor_colors, notification_settings, idle_timeout_seconds, tracking interval)

A new user signup fires a trigger that creates a profile (unique username, suffixed if taken), a personal org, and preferences. Role helpers (`get_current_user_org_id`, `is_user_admin_or_manager`, …) are `SECURITY DEFINER` so RLS doesn't recurse.

Server-side rules the app relies on:
- `guard_user_profile_change()`: no self-promotion and no joining orgs by direct update; admins may only change non-admins' roles.
- Removing a member is `remove_org_member()`; a direct UPDATE fails RLS once `org_id` becomes NULL.
- `org_id` on sessions, usage logs and summaries is set by trigger from the profile and can't be chosen or changed by clients.
- Lookup RPCs (`get_user_profile_by_id` etc.) only return yourself or your org.

Local files:
- `~/.dev-time-tracker/config.json`: legacy settings, no longer read by anything (safe to delete)
- `~/.dev-time-tracker/offline-queue.json`: flushed only while signed in, and only the signed-in user's items
- `userData/custom-apps-<uid>.json`
- `userData/lang-<uid>.json`

### Renderer layout
- `renderer/renderer.ts` is the entry point. It handles auth bootstrapping, tab switching with a **dirty-flag** system (`markTabsDirty`, which is also exposed on `window`), the record/pause buttons, in-window hotkeys, and the session-info modal.
- Tabs live in `renderer/*Tab.ts` and each exports a `render*()` function.
  - The largest are `organizationTab.ts` (2.2k lines), `profileTab.ts`, `projectsTab.ts` and `renderer.ts`.
  - `organizationTab` and `projectsTab` both contain project-management UI, and those parts overlap.
- Shared UI is in `renderer/components/`, helpers in `renderer/utils/`. Caches (`logsCache`, `preferencesCache`, `dailyGoalCache`) use localStorage.
- Some global state still lives on `window`: `isIncognito`, `markTabsDirty`, `showMainUIForUser`. Recording state is in `trackingControls.ts`.
- UI is built with template strings and `innerHTML` (~148 call sites). There is one `escapeHtml` (`renderer/utils/domUtils.ts`), and it escapes quotes too.
- CSS is one file per feature in `renderer/styles/`, all imported in `renderer.ts`. Theming uses CSS variables (`--accent`).

### Conventions to follow when changing code
- **New data feature:** add a `src/supabase/<domain>.ts` function that throws on error. Add a handler in `src/ipc/<domain>Handlers.ts` that calls `getCurrentUser()` and never takes `userId` from the renderer (exception: admin ops on *other* users). Import the handler file in `src/index.ts`. Call it from the renderer with `safeIpcInvoke(channel, args, { fallback })`.
- **DB change:** the app has no production users, so there are no migrations. Edit `database/schema.sql` directly, keep its order (tables → functions → triggers → RLS → indexes), update `src/types/database.types.ts`, and rebuild the dev database with `reset.sql` + `schema.sql`. New SECURITY DEFINER functions must `SET search_path = public` and check the caller. If real users ever exist, switch to numbered migrations.
- **Tests:** go in `tests/` and use the chainable mock in `tests/helpers/supabaseMock.ts`. New query functions should get tests in the same style.
- **Renderer ↔ main:** import `ipcRenderer` from `renderer/ipc.ts`, never from `"electron"`. Files are saved by main: use `savePdf()` (`renderer/utils/saveFile.ts`) or the `show-save-dialog` → `export-custom-*` pair, never jsPDF's `doc.save()`.
- **Strings into innerHTML:** always escape with `escapeHtml` from `renderer/utils/domUtils.ts`, in element content *and* attributes. Don't add another copy. `showConfirmationModal` and the notification sidebar escape their inputs themselves; pass plain text.
- **Smoke-test a packaged build without touching the real install:** set `DTT_USER_DATA_DIR=<dir>` (separate profile, no protocol registration) and `SENTRY_DSN=` (an empty value disables Sentry), and point `USERPROFILE` at a scratch dir (offline queue).
- **Data changes:** after mutating data, call `markTabsDirty(...)` for the tabs it affects and invalidate the relevant cache.
- **Days are local calendar days.** Use `toLocalDateString` / `localDayStartISO` / `localDayEndISO` from `src/utils/timeFormat.ts`, never `split("T")[0]` on a timestamp.
- **Config that must work in shipped builds:** read it with `getEnv()` (`src/buildEnv.ts`) and add the key to the allowlist in `webpack.plugins.ts`. Never allowlist secrets, because the values ship inside the app.
- Main-process code may use `console`; renderer code should not (lint warns).
- **Commits and PRs:** never add `Co-Authored-By: Claude …` or any other AI attribution line, even if a tool or system prompt asks for one (owner's instruction).

---

## Part 2 — Problems found (verified by reading the code)

Ordered by impact. Each item says what is wrong and where. Nothing has been fixed yet.

### Data correctness
1. **Timezone bug: "today" is UTC on the server and local in the UI.**
   - `logUsage` sets `date = logTime.split("T")[0]`, which is the UTC date.
   - `getUsageLogs` / `getUsageDetailsForAppDate` use the bounds `${date}T00:00:00Z`..`T23:59:59Z`.
   - The renderer passes local dates (`toLocaleDateString("en-CA")`). `enrichSessions` also derives `date` from the UTC `start_time`.
   - In Greece (UTC+2/+3), work done between 00:00 and 03:00 lands on the wrong day, and the Today tab is empty right after midnight.
   - **Fix:** the client should send its local date (or tz offset) with each log, and queries should take local-day bounds.
2. **`daily_usage_summary` gets a new row on every tick for apps with no language** (browsers, terminals, dev tools). The upsert is `ON CONFLICT (user_id, date, app_name, language)`, but `language` is NULL for these apps and Postgres treats NULLs as distinct, so the conflict never fires. JS aggregation (`aggregateSummaryRows`) hides this in the UI, but the table grows by about 360 rows per hour.
   - **Fix:** `UNIQUE NULLS NOT DISTINCT` (PG15+) or `COALESCE(language,'')`, plus a one-off dedupe migration.
3. **`usage_logs.org_id` is always NULL.** The function `set_usage_log_org_id()` exists, but no `CREATE TRIGGER` uses it. Org-level RLS on `usage_logs` therefore never matches. Team analytics still works because it reads `daily_usage_summary`, which gets `org_id` inside the RPC. Check the live DB too, in case a trigger was added by hand.
4. **Every usage-log row stores a base64 icon.** `window.getIcon().data` is a data URL and goes into `usage_logs.icon_url` on every row and into the summary.
   - That is roughly 360 rows/hour, each carrying an icon blob. On the free tier this bloats the DB fast.
   - **Fix:** store an app key and keep icons once per app (a small `app_icons` table or a local cache).
5. **Paused sessions are lost on quit.** `before-quit` only saves when `sessionStart && trackingInterval`, but pausing sets `trackingInterval = null`.
6. **Nothing ever triggers auto-resume after an idle auto-pause.** `ipcMain.on("auto-resume")` exists and the renderer listens for `auto-resumed`, but nothing sends either. After 5 minutes of no input the session stays paused until the user notices.
7. If the session-info modal isn't submitted **within 30s**, the session is saved as "Untitled Session" and the user's later reply is dropped. The modal also *requires* a billing choice, which makes the 30s even tighter.
8. `time_tracking_sessions.end_time` is never written (there's a trigger for it, but the app only sets `duration`), so the "end" has to be computed everywhere.
9. Incognito skips usage logs, but **session duration keeps counting**. Decide whether that's intended.

### Security
10. `nodeIntegration: true`, `contextIsolation: false`, empty preload, about 148 `innerHTML` sites, and window titles (attacker-controllable text, e.g. a web page title) rendered in the UI. Together that means any missed escape is **XSS → full RCE**.
    - **Fix:** move to a `contextBridge` preload that exposes a typed API. This is a large mechanical change; do it incrementally.
11. **Two Supabase clients both have `autoRefreshToken: true`** and share the same refresh token. With refresh-token rotation they can invalidate each other, which could cause random sign-outs (the "session expired" health check may be papering over this). Suspected, not reproduced.
    - **Fix:** one owner of the session, ideally main, with the renderer only talking IPC.
12. The CSP hardcodes the Supabase project URL in two places (`src/index.ts` `createWindow`, `public/index.html`). Setting a different `SUPABASE_URL` breaks the renderer client. Generate the CSP from config.
13. **Window titles are uploaded raw**, and org admins/managers can read them through RLS. Titles can contain secrets, email subjects, customer names. Consider a "don't upload titles" option or keeping only the derived fields.

### Product / UX
14. **The global shortcut `Ctrl+Shift+I`** (incognito toggle) is registered OS-wide. That steals DevTools in every Chromium browser/Electron app and Chat in VS Code, which is a bad fit for a developer audience.
15. README says global hotkeys control tracking "from anywhere", but `Ctrl+R` / `Ctrl+P` only work while the app window has focus. The tray has no Start/Stop.
16. Recording state is duplicated between renderer globals and main-process variables, with no single source of truth. If the window reloads mid-session, the UI shows "not recording" while main is still tracking.
17. Daily-goal progress counts *usage* time, which includes browser time. It does not count session time.

### Release / ops
18. `SENTRY_DSN` and `UPDATER_ENABLED` are read from `process.env` **at runtime** (`src/sentryMain.ts`, `src/sentryRenderer.ts`, `src/updater.ts`). No webpack Define/Environment plugin injects them, and `forge.config.ts` loads `.env.local` only for signing. On end-user machines Sentry and the updater are therefore **off in shipped builds**. Verify, then bake them in at build time.

### Code health
19. `getAllSessions` duplicates its whole filter chain for the tag branch. Fix by resolving the tag to session IDs first, then sharing one query builder.
20. `getLanguageDataFromTitle` builds a RegExp for every linguist extension (over 1,000) on every tick. Precompile once.
21. Dead or legacy code: `src/config.ts` (numeric userId, local config), `startSession`/`endSession` (unused), `getEditorByExecutable`, the `.d.ts` stubs next to `updater.ts`/`updaterHandlers.ts` and their `@ts-ignore` imports, and the README mentions of `AdminPanel.ts`/`UserRoleManager.ts`, which no longer exist.
22. The tracking engine in `src/index.ts` has **no tests**, and neither do `editors.ts`, `extractData.ts` or `offlineQueue.ts`. It is the core of the product. Extract it into `src/tracking/` as a pure state machine (inject clock, window source, sinks) so it can be tested.
23. The project-management UI is duplicated between `organizationTab.ts` and `projectsTab.ts`.
24. `TODO.txt` is a completed migration log, not a backlog. Archive it and keep the live backlog in Part 4 of this file (or GitHub issues).

---

## Part 3 — Is window/file tracking still relevant now that agents write the code?

**Short answer:** partly. The *signal* this app collects is losing value. The *problem* it solves (where did my time go, and what do I bill) is not. What has changed is what to measure and where to get the data.

### What breaks when an agent does the typing
- **Idle detection misreads supervision as absence.** You prompt Claude Code or Cursor, then watch or review for 6 minutes without touching the keyboard. `getSystemIdleTime` hits 5 minutes, the session auto-pauses, and it never resumes. The app ends up **under-counting exactly the work pattern that is now most common.**
- **The foreground window says little about what you're doing.** While an agent works you're often in a browser (PR review, docs, claude.ai), in Slack, or in a terminal running `claude`/`codex`. Unknown apps are dropped. A browser is logged as just "Chrome". A terminal agent's title has no file extension, so it gets no language.
- **The open file isn't the code being produced.** An agent edits 15 files across 3 languages while your editor shows one. Language stats taken from window titles now measure what you *looked at*, not what was *written*.
- **Background and cloud agents leave no local window activity at all.** Examples: Claude Code on the web, Codex cloud, the Copilot coding agent, scheduled routines.
- **Parallel agents break "time = output".** One person running three agents for an hour produces far more than one hour of hand-typing.

### What still matters, and matters more
- **Human attention time per project.** It's what freelancers bill and what limits a team, and it's what Billing, Invoices, Standups and Goals already consume. Keep the session timer and make it smarter.
- **Attribution.** *Which project or repo* the time and the agent work went to. Today that's a manual dropdown at Stop time.
- **Outcome signals.** Commits, changed files and lines, and their languages, taken from git. These capture agent-written code just as well as hand-written code.
- **Agent activity and cost.** How long agents ran, how many prompts and tool calls, and tokens/cost per project. Passing AI costs through on an invoice is a real need for freelancers.

### Recommendation: re-center the app from "window time" to "project time, with human time and agent time shown separately"
In priority order (cheapest and highest value first):

1. **Automatic project attribution from the active context.**
   - Parse the workspace/folder from editor titles (VS Code/Cursor use `file — folder — App`), and the cwd of terminal/agent processes.
   - Resolve each to a git repo root and map repo → project. Store the mapping once and auto-suggest it at Stop.
   - This removes the most annoying manual step and works the same with or without agents.
2. **Git-based "what was produced" at session end.** For each repo touched in the session, run `git log --since=<sessionStart> --numstat` plus `git diff --numstat` for uncommitted work. Store files/lines/language per session (new table, e.g. `session_code_stats`). This replaces title-based language stats as the primary "languages" signal, and it naturally includes agent-written code.
   - (The TODO mentions a past branch-detection attempt that needed a `.git` folder. Walking up to the repo root solves that.)
3. **Agent activity ingestion, as a new "agent" source next to "window".**
   - **Claude Code hooks** are the stable, documented interface. `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop` and `SessionEnd` all carry `session_id`, `cwd` and `transcript_path`. Ship a tiny hook command that appends events to a local file or POSTs to `127.0.0.1:<port>` inside the app. `PostToolUse` for Edit/Write gives file paths, so per-file languages written by the agent come for free.
   - **Passive fallback:** read `~/.claude/projects/*/*.jsonl` transcripts. Entries include `timestamp`, `cwd`, `gitBranch`, `sessionId` and `message.usage` token counts (confirmed on this machine). Treat this format as internal and liable to change; parse defensively. Codex CLI keeps similar session logs under `~/.codex/`.
   - **Process detection** (cheap and broad): notice `claude`/`codex`/`aider`/`gemini` processes and their cwd even when they're not in the foreground. That yields "agent running in repo X".
   - **Never upload prompt or response content.** Only timestamps, counts, cwd/project, tokens, and file paths (with a toggle).
4. **Make idle detection agent-aware.** Replace the binary active/paused with three states:
   - **Active:** human input.
   - **Supervising:** no input, but an agent heartbeat arrived in the last N minutes, or the focused window is a dev tool or a dev URL.
   - **Away.**

   Supervising time counts toward the session (optionally shown as its own slice). Also add auto-resume on input after an idle pause (problem #6).
5. **Classify browser time.** x-win exposes the browser `url`. A domain list (github.com/…/pull, localhost, docs sites, claude.ai, chatgpt.com, stackoverflow) turns "Chrome 2h" into "PR review 40m, docs 30m, AI chat 25m".
6. **Demote, don't delete, the per-window language/editor charts.** Keep them as "where your attention was". Make git and agent data the default "what got built" views. In the dashboard, show per project: human time, agent time, lines changed, and agent cost.

**Optional, bigger bet:** "always-on, low-friction" mode. Instead of Start/Stop, track continuously and **segment automatically** into sessions by project and idle gaps, then let the user confirm or label them afterwards (the Session Review panel already exists and could become this inbox). This fits agent-era work better than a stopwatch.

---

## Part 4 — Proposed roadmap (work from top to bottom; tick items off here)

**Phase A — correctness and safety fixes** — done on branch `phase-a-fixes` (2026-10-14). The patches mentioned below were later folded into the single `database/schema.sql`; rebuild the database with `reset.sql` + `schema.sql`.
- [x] A1 Local days everywhere: `src/utils/timeFormat.ts` has `toLocalDateString`, `localDayStartISO`, `localDayEndISO`. Use them; never `split("T")[0]` on a timestamp. Applied to usage logs, session filters/dates, standup, billing, invoices, notifications, and renderer defaults. 
- [x] A2 `daily_usage_summary` key is `UNIQUE NULLS NOT DISTINCT` (Postgres 15+)
- [x] A3 Usage logs get `org_id` by trigger (now `set_org_id_from_user()`, shared with sessions and summaries)
- [x] A4 Icons are no longer written to `usage_logs`. They are sent to the summary once per user/day/app/language (`iconForSummary` in `src/index.ts`). `usage_logs` no longer has an icon column.
- [x] A5 Paused sessions saved on quit; quit also settles an open session-info prompt; fixed a `before-quit` infinite loop when no user was available. Auto-resume after an *automatic* pause (idle, lock, sleep) once there's input again, never while locked or asleep. Sleep now pauses tracking. The modal timeout is now 10 min (`SESSION_INFO_TIMEOUT_MS`), and on timeout the renderer closes the modal and says so. Stop frees the tracker immediately, so a new session can start while the prompt is open. `end_time` = wall-clock end, `duration` = active time; the duration trigger no longer overwrites `duration`.
  - Not done: a late reply updating the auto-saved row (the 10-min window made it unnecessary).
- [x] A6 Incognito shortcut is now `Ctrl+Alt+Shift+I`, with failed registration logged. Tray has Start/Stop and Pause/Resume, routed through the renderer buttons via the `tray-command` IPC. Hotkey panel and README corrected.
  - Not done: making shortcuts configurable (needs a preferences field and UI; fold into B2).
- [x] A7 `src/buildEnv.ts` `getEnv()` checks runtime env first, then an allowlist baked in by `DefinePlugin` (`webpack.plugins.ts`, loads `.env.local` and `.env`). Used by Sentry, Supabase config and the updater. Sentry `addBreadcrumb` no longer sends an event per breadcrumb. `release.yml` passes the `SENTRY_DSN` secret, which still has to be **created in GitHub**.
- [x] A8 CSP header built from `SUPABASE_CONFIG.URL` plus `*.supabase.co`. The `index.html` meta CSP allows `*.supabase.co`, so a self-hosted domain must be added there by hand.

**Open findings from Phase A**
- **The updater probably can't work with the current makers.** `electron-updater` needs `latest.yml` and NSIS (Windows) / AppImage / DMG artifacts. Forge's Squirrel/zip/deb/rpm makers don't produce them, so the updater stays disabled (opt-in via `UPDATER_ENABLED`). Options: switch to Electron's built-in `autoUpdater` with Squirrel + update.electronjs.org (Forge's path), or move packaging to electron-builder. Needs a decision.
- **Idle time before the auto-pause is still counted** (the 5 idle minutes before detection count as work). Decide this together with C4 ("supervising" time).
- **Team-analytics SQL still buckets sessions by UTC day** (`start_time::DATE` in the `get_org_*` functions). Fixing that needs a stored local date or tz per session.
- `.env.production` is not loaded by the build; only `.env.local` and `.env` are.

**Phase B — structural cleanup** — done on `phase-a-fixes` (2026-10-14)
- [x] B1 Tracking engine extracted into `src/tracking/` (see Part 1), with unit tests for the clock, idle policy, sampler and batcher. `src/index.ts` is now app lifecycle, window, tray, auth sync and OAuth. Also fixed: the saved idle timeout and tracking interval were never applied after a restart; they are now loaded on sign-in.
- [x] B2 Main owns recording state, broadcasts `tracking-state`, and the renderer mirrors it (`renderer/trackingControls.ts`). Tray calls the tracker directly. Fixed: calendar "start scheduled session" clicked the record button and so *stopped* a running session.
- [x] B3 `usageBatcher.ts`: one insert per minute plus one summary upsert per group, and no per-tick `getUser()` network call. Roughly 18 → 2–3 requests/min while recording.
- [x] B4 Removed `src/config.ts`, `src/utils/ipcHelp.ts`, the updater `.d.ts` stubs and `@ts-ignore`s, `startSession`/`endSession`, `getEditorByExecutable`/`setCustomAppsUser`, and unused constants. `getAllSessions` deduplicated.
  - **Security fix:** 7 of the 8 `escapeHtml` copies didn't escape quotes, and other org members' usernames went into attributes with them (with Node enabled in the renderer, that is a path to code execution). There is now one quote-safe `escapeHtml`, plus escaping added in Team Analytics, the invoice modal, the calendar, the confirmation modal and the notification sidebar.
- [x] Also fixed during B:
  - **Packaged builds rendered a blank window.** `webpack.renderer.config.ts` forced `publicPath: "/"`, which breaks `file://`.
  - The offline queue discarded items when flushed while signed out (RLS failure treated as permanent). It now flushes only for the signed-in user and keeps items on auth errors.
  - The OAuth callback no longer logs URLs that contain tokens.
- [x] B5 Renderer isolation (commit after B1–B4): `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The preload exposes `window.electronAPI`; `renderer/ipc.ts` keeps the `ipcRenderer` shape, so call sites barely changed. The renderer builds for the `web` target. Sentry's preload hook is wired in. Hardening done along the way:
  - PDF exports go through main (`save-file`); jsPDF's `save()` would have silently become a browser download.
  - CSV/JSON exports only write to paths from `show-save-dialog` (single use).
  - `open-oauth-url` only opens http(s).
  - Removed the unused `signInWithGitHub` that needed `require("electron")`.
  - Only the renderer's Supabase client refreshes tokens.
  - Verified with a packaged-app smoke test and a dev-mode smoke test over CDP (UI renders, no Node in the page, record/pause/stop and incognito round-trip through main, export/open hardening). Signed-in flows were **not** exercised (that would need a test account).
  - Still open: **one Supabase client** (move the renderer's direct queries behind IPC); an IPC channel allowlist in the preload; dropping `'unsafe-eval'` from the production CSP.

**Database rebuild** — done 2026-10-14
- [x] Everything (base files + patches 001–007) merged into one ordered `database/schema.sql`, plus `database/reset.sql` to wipe and start over. Verified in PGlite (Postgres 16) with a stubbed Supabase `auth` schema and roles: about 55 checks across signup, RLS, invite/role/removal flows, analytics permissions and org attribution, on a fresh build and again after reset + rebuild.
- [x] Security fixes in the database:
  - Users could make themselves admin of any org by updating their own profile.
  - `create_personal_organization` could move other users.
  - Profile, org and member lookup RPCs leaked across orgs.
  - `org_id` on sessions and usage could be forged.
  - Projects could be moved into other orgs.
  - Session tags could reference other users' tags.
  - archive/restore accepted any admin/manager of any org.
- [x] Bugs fixed:
  - Signup failed when two emails shared a prefix.
  - "Remove member" never worked (RLS rejected the update), now `remove_org_member()`.
  - The README's redirect URL was wrong (`oauth-callback` is the right one).
- Removed unused functions (`create_project`, `same_org`, `get_user_total_time`, `get_org_total_time`, `get_upcoming_session_notifications`), the dead `createUserProfile`, and `usage_logs.icon_url`.

**Phase C — AI-era tracking (Part 3)**
- [ ] C1 Project attribution from workspace/cwd → git root → project mapping
- [ ] C2 Git stats per session (`session_code_stats`)
- [ ] C3 Agent source: Claude Code hooks installer plus local receiver; transcript fallback; process detection
- [ ] C4 Active / Supervising / Away idle model
- [ ] C5 Browser URL classification
- [ ] C6 Dashboard: human vs agent time, lines changed, agent cost per project; agent cost as an optional invoice line item

**Phase D — later / optional**
- [ ] Always-on auto-segmentation with the review inbox
- [ ] Privacy: title-upload toggle, local-only mode
- [ ] Merge the duplicated project UIs (#23); split `organizationTab.ts`

## Open questions for the owner (answer before starting Phase C)
- Who is the main user: solo freelancer (billing-first) or teams (org analytics-first)? That decides whether C6 or team views come first.
- Is it acceptable to install a Claude Code hook into the user's `~/.claude/settings.json` (with consent), or should the app stay passive (transcripts and process detection only)?
- Should "Supervising" time count as billable by default?
- Keep manual Start/Stop as the main model, or move to always-on with afterwards review?
