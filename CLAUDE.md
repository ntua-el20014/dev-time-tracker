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
npm test                  # vitest (260 tests, all mocked Supabase — ~8s)
npm run type-check        # main + renderer tsconfigs
npm run lint              # eslint
npm run make              # installers
```
Baseline as of 2026-10-14: tests, type-check and lint are all green. Keep them green.

### Processes and the boundary between them
```
renderer/  (UI, nodeIntegration=true, contextIsolation=false)
   │  ipcRenderer.invoke(channel, ...args)   ← wrapped by renderer/utils/ipcHelpers.ts safeIpcInvoke()
   ▼
src/ipc/*Handlers.ts  (main)  — ~137 ipcMain.handle channels, each resolves the user itself via getCurrentUser()
   ▼
src/supabase/*.ts  — thin query modules, one per domain, throw on error
   ▼
Supabase (RLS enforces per-user / per-org access)
```
- The preload script `src/preload.ts` is **empty**. The renderer `import`s from `electron` and even from `src/` directly.
- **There are two Supabase clients.** The renderer has one (backed by localStorage). Main has one (backed by an in-memory store). The renderer pushes its tokens to main through the `sync-auth-session` IPC (`src/index.ts`, top). Some renderer code skips IPC and queries Supabase directly: `renderer/utils/organizationApi.ts`, `src/supabase/orgAnalytics.ts` (imported by `teamAnalyticsTab`), `ConnectionStatus.ts`, and `oauthHandler.ts`.
- The handler files register themselves as an import side effect (`import "./ipc/xHandlers"` in `src/index.ts`). `src/utils/langMap.ts` also registers handlers this way.

### The tracking engine (all in `src/index.ts`)
State is held in module-level variables: `sessionStart`, `sessionActiveDuration`, `lastActiveTimestamp`, `isPaused`, `isIncognito`, `trackingInterval`, `intervalSeconds`, `idleTimeoutSeconds`, `cachedUserId`.

| Event | What happens |
|---|---|
| `start-tracking` | Starts `setInterval(trackActiveWindow, intervalSeconds)` and resets the session clock |
| `pause/resume-tracking`, `auto-pause` | Adds elapsed active time to `sessionActiveDuration`; clears or restarts the interval |
| Idle poll (every 2s) | `powerMonitor.getSystemIdleTime() >= idleTimeoutSeconds` → auto-pause. If the pause was automatic (`autoPaused`) and the user is back (idle < 5s, not locked or suspended) → auto-resume |
| `lock-screen`, `suspend` | auto-pause (and block auto-resume until `unlock-screen` / `resume`) |
| `stop-tracking` | Snapshots start, end and active duration, then resets state immediately. If ≥10s, asks the renderer for title/project/billable (`askSessionInfo`: `get-session-info` ↔ `session-info-reply`, 10-min timeout → "Untitled Session" + `session-info-timeout` to the renderer), then `saveSession()` → `addSession()` with `end_time`. On a network error the session goes to the offline queue |
| `before-quit` | Settles any open prompt, then auto-saves a running *or paused* session with a default title |
| Tray | Start/Stop and Pause/Resume send `tray-command` to the renderer, which clicks its own buttons |
| `trackActiveWindow()` | `activeWindow()` (x-win). Matches `execName` against `assets/known_editors.json` plus per-user `custom-apps-<uid>.json` (`src/utils/editors.ts`). **Unknown apps are dropped.** Language comes from `getLanguageDataFromTitle()` (`src/utils/extractData.ts`, linguist extensions, longest match first, plus per-user `lang-<uid>.json`). Then `logUsage()`, retried once, then the offline queue. The app icon goes only to the summary row, once per user/day/app/language |

`logUsage()` (`src/supabase/usageLogs.ts`) makes **two round trips on every tick**: an INSERT into `usage_logs`, then the RPC `update_daily_usage_summary`, which upserts into `daily_usage_summary` keyed by `(user_id, date, app_name, language)` with NULLs not distinct. `date` is the user's **local** day.

**Session time and usage time are two separate measurements and nothing reconciles them.**
- Session `duration` is active time: wall-clock time between Start and Stop, minus pauses. `end_time` is the wall-clock end (set since Phase A; older rows have NULL).
- Usage time is (number of samples where a *known* app was focused) × interval.
- `usage_logs.session_id` exists in the schema but is never written. Session details are found by time range instead (`getUsageDetailsForSession`).
- Daily goals, dashboard "time today" and the language/editor charts read `daily_usage_summary` (usage time). Billing, invoices, standups and project stats read sessions.

### Data model (see `database/schema.sql`, `database/functions_and_triggers.sql`, `database/patches/00N_*.sql`)
Tables:
- `organizations`, `user_profiles` (role: admin/manager/employee), `org_join_requests`, `org_invite_codes`
- `cloud_projects` (scope personal|organization, `hourly_rate`), `project_members`
- `time_tracking_sessions` (`is_billable` NOT NULL after patch 005; since patch 007 the trigger derives `duration` from `end_time` only when `duration` is NULL)
- `usage_logs`, `daily_usage_summary`
- `user_tags`, `session_tags`, `daily_work_goals`, `scheduled_work_sessions`, `scheduled_session_tags`
- `user_preferences` (theme, accent JSON, editor_colors, notification_settings, idle_timeout_seconds, tracking interval)

A new user signup fires a trigger that creates a profile, a personal org, and preferences. Role helpers (`get_current_user_org_id`, `is_user_admin_or_manager`, …) are `SECURITY DEFINER` so RLS doesn't recurse.

Local files:
- `~/.dev-time-tracker/config.json`: legacy settings, mostly dead (`src/config.ts`)
- `~/.dev-time-tracker/offline-queue.json`
- `userData/custom-apps-<uid>.json`
- `userData/lang-<uid>.json`

### Renderer layout
- `renderer/renderer.ts` is the entry point. It handles auth bootstrapping, tab switching with a **dirty-flag** system (`markTabsDirty`, which is also exposed on `window`), the record/pause buttons, in-window hotkeys, and the session-info modal.
- Tabs live in `renderer/*Tab.ts` and each exports a `render*()` function.
  - The largest are `organizationTab.ts` (2.2k lines), `profileTab.ts`, `projectsTab.ts` and `renderer.ts`.
  - `organizationTab` and `projectsTab` both contain project-management UI, and those parts overlap.
- Shared UI is in `renderer/components/`, helpers in `renderer/utils/`. Caches (`logsCache`, `preferencesCache`, `dailyGoalCache`) use localStorage.
- Global state lives on `window`: `isRecording`, `isPaused`, `isIncognito`, `markTabsDirty`, `setupRecordAndPauseBtns`, `showMainUIForUser`.
- UI is built with template strings and `innerHTML` (~148 call sites). `escapeHtml` is copy-pasted into 8 files; the canonical copy is `renderer/utils/domUtils.ts`.
- CSS is one file per feature in `renderer/styles/`, all imported in `renderer.ts`. Theming uses CSS variables (`--accent`).

### Conventions to follow when changing code
- **New data feature:** add a `src/supabase/<domain>.ts` function that throws on error. Add a handler in `src/ipc/<domain>Handlers.ts` that calls `getCurrentUser()` and never takes `userId` from the renderer (exception: admin ops on *other* users). Import the handler file in `src/index.ts`. Call it from the renderer with `safeIpcInvoke(channel, args, { fallback })`.
- **DB change:** add `database/patches/00N_description.sql` (idempotent, `IF NOT EXISTS` / `CREATE OR REPLACE`). Fold the change into `schema.sql` / `functions_and_triggers.sql` too, so fresh installs match, and update `src/types/database.types.ts`.
- **Tests:** go in `tests/` and use the chainable mock in `tests/helpers/supabaseMock.ts`. New query functions should get tests in the same style.
- **Strings into innerHTML:** use `escapeHtml` from `renderer/utils/domUtils.ts`. Don't add another copy.
- **Data changes:** after mutating data, call `markTabsDirty(...)` for the tabs it affects and invalidate the relevant cache.
- **Days are local calendar days.** Use `toLocalDateString` / `localDayStartISO` / `localDayEndISO` from `src/utils/timeFormat.ts`, never `split("T")[0]` on a timestamp.
- **Config that must work in shipped builds:** read it with `getEnv()` (`src/buildEnv.ts`) and add the key to the allowlist in `webpack.plugins.ts`. Never allowlist secrets, because the values ship inside the app.
- Main-process code may use `console`; renderer code should not (lint warns).

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

**Phase A — correctness and safety fixes** — done on branch `phase-a-fixes` (2026-10-14). **Deploy order: run `database/patches/007_data_integrity_fixes.sql` before running a client from this branch** (see A5).
- [x] A1 Local days everywhere: `src/utils/timeFormat.ts` has `toLocalDateString`, `localDayStartISO`, `localDayEndISO`. Use them; never `split("T")[0]` on a timestamp. Applied to usage logs, session filters/dates, standup, billing, invoices, notifications, and renderer defaults. Historical rows keep their UTC dates (the patch explains why there is no backfill).
- [x] A2 `daily_usage_summary` duplicates merged; key is now `UNIQUE NULLS NOT DISTINCT` (patch 007, Postgres 15+)
- [x] A3 `set_usage_log_org_id_trigger` created; `org_id` backfilled from the summary row of that day (patch 007)
- [x] A4 Icons are no longer written to `usage_logs`. They are sent to the summary once per user/day/app/language (`iconForSummary` in `src/index.ts`). Patch 007 has an optional, commented-out cleanup of old blobs.
- [x] A5 Paused sessions saved on quit; quit also settles an open session-info prompt; fixed a `before-quit` infinite loop when no user was available. Auto-resume after an *automatic* pause (idle, lock, sleep) once there's input again, never while locked or asleep. Sleep now pauses tracking. The modal timeout is now 10 min (`SESSION_INFO_TIMEOUT_MS`), and on timeout the renderer closes the modal and says so. Stop frees the tracker immediately, so a new session can start while the prompt is open. `end_time` = wall-clock end, `duration` = active time; the patch changes the trigger so it no longer overwrites `duration`.
  - Not done: a late reply updating the auto-saved row (the 10-min window made it unnecessary).
- [x] A6 Incognito shortcut is now `Ctrl+Alt+Shift+I`, with failed registration logged. Tray has Start/Stop and Pause/Resume, routed through the renderer buttons via the `tray-command` IPC. Hotkey panel and README corrected.
  - Not done: making shortcuts configurable (needs a preferences field and UI; fold into B2).
- [x] A7 `src/buildEnv.ts` `getEnv()` checks runtime env first, then an allowlist baked in by `DefinePlugin` (`webpack.plugins.ts`, loads `.env.local` and `.env`). Used by Sentry, Supabase config and the updater. Sentry `addBreadcrumb` no longer sends an event per breadcrumb. `release.yml` passes the `SENTRY_DSN` secret, which still has to be **created in GitHub**.
- [x] A8 CSP header built from `SUPABASE_CONFIG.URL` plus `*.supabase.co`. The `index.html` meta CSP allows `*.supabase.co`, so a self-hosted domain must be added there by hand.

**Open findings from Phase A**
- **The updater probably can't work with the current makers.** `electron-updater` needs `latest.yml` and NSIS (Windows) / AppImage / DMG artifacts. Forge's Squirrel/zip/deb/rpm makers don't produce them, so the updater stays disabled (opt-in via `UPDATER_ENABLED`). Options: switch to Electron's built-in `autoUpdater` with Squirrel + update.electronjs.org (Forge's path), or move packaging to electron-builder. Needs a decision.
- **Idle time before the auto-pause is still counted** (the 5 idle minutes before detection count as work). Decide this together with C4 ("supervising" time).
- **Team-analytics SQL still buckets sessions by UTC day** (`start_time::DATE` in patch 006). Fixing that needs a stored local date or tz per session.
- `.env.production` is not loaded by the build; only `.env.local` and `.env` are.

**Phase B — structural cleanup (enables everything after)**
- [ ] B1 Extract the tracking engine from `src/index.ts` into `src/tracking/` (state machine, sources, sinks) with unit tests (#22)
- [ ] B2 Single owner for recording state (main), with the renderer subscribing (#16)
- [ ] B3 Batch usage writes: buffer ticks in memory and flush every ~60s as one insert plus one summary upsert. Cuts requests by about 12×.
- [ ] B4 Remove dead code, deduplicate `escapeHtml`, simplify `getAllSessions` (#19–21)
- [ ] B5 (larger, incremental) Preload + `contextBridge` typed API; turn off `nodeIntegration`; one Supabase client (#10, #11)

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
