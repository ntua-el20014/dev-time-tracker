# CLAUDE.md — Dev Time Tracker

How this repo is laid out, how its parts work, and the rules to follow when changing it.
Last updated 2026-10-19. Line numbers drift, so search by function name.

**Status:** every planned phase is done (see the legend below). The owner is using the app locally and will report bugs and improvements; work comes from those reports. The first public release comes after that.

---

## What it is
An Electron 28 desktop app, written in TypeScript and bundled with webpack via Electron Forge. It records **sessions** (Start/Stop timer with pause) and, while a session runs, samples the **foreground window** every N seconds (default 10). Each sample yields app, language (from the file extension in the window title) and, for browsers, a page type. Only time totals per app/language/page type are uploaded (per local day and per session), never titles or URLs. All data lives in **Supabase** (Postgres + Auth + RLS); there is no local database.

Built on top: project detection from the focused repo, an agent-aware activity model (active / supervising an AI agent / away), git code stats per session, AI agent sessions and cost (Claude Code, Codex), browser page types, an opt-in always-on mode that saves drafts for review, goals, scheduled sessions, tags, projects, organizations with roles, billing in per-project currencies, PDF invoices, standup summaries, team analytics, an offline queue, Sentry and an auto-updater.

**Feature labels** used in code comments and below: C1 project detection · C2 code stats · C3 agent sessions and Claude Code hooks · C4 activity model · C5 browser categories · C6 per-project activity and agent cost · D1–D4 always-on segments, drafts and the review inbox · U1–U3 the sidebar UI.

## Commands
```
npm start                            # dev (electron-forge start, webpack HMR)
npm test                             # vitest (~660 tests, mocked Supabase, ~15 s)
npm run type-check                   # main + renderer tsconfigs
npm run lint                         # eslint
npm run test:db                      # schema.sql, reset.sql, baseline.sql + migrations in PGlite (no Supabase needed)
npm run db:new-migration -- <name>   # next numbered migration (see "Database changes")
npm run package                      # packaged app in out/
npm run make                         # installers
npm run test:smoke                   # packaged app, isolated profile, over CDP (package first)
npm run test:e2e                     # packaged app vs the real Supabase, 2 test accounts from .env.local (package first)
```
CI runs lint, type-check, `npm test` and `test:db` on every push. Keep all of them green.

## Project structure
```
src/                      Main process
  index.ts                  App lifecycle, window, tray, CSP, OAuth callback, imports every handler file
  preload.ts                contextBridge: window.electronAPI, allowlisted channels only
  buildEnv.ts               getEnv(): runtime env, then values baked in at build time
  updater.ts                Electron autoUpdater + update.electronjs.org (Windows)
  sentryMain.ts / sentryRenderer.ts
  ipc/                      ipcMain.handle channels, one *Handlers.ts per domain
  supabase/                 Query modules, one per domain (throw on error); config.ts = the one client
  tracking/                 The tracking engine (below)
  utils/                    Offline queue, error handling, time formatting, language/app/browser rule files, schema check
  types/database.types.ts   Table types (keep in step with the schema)
renderer/                 UI (sandboxed page, no Node)
  renderer.ts               Entry point: auth bootstrapping, page registration, rail timer, hotkeys, session-info modal
  navigation.ts             Views, sub-views, dirty flags
  trackingControls.ts       Mirror of main's tracking state
  *Tab.ts                   One render*() per page
  components/               Shared UI (timer card, timeline, inbox, modals, notifications, …)
  utils/                    Renderer helpers (escapeHtml, safeIpcInvoke, caches, …)
  styles/                   One CSS file per feature, imported in renderer.ts
shared/                   Pure code used by both sides (billing, currency, code stats, drafts, browser categories, IPC allowlist, types)
database/
  schema.sql                The complete current database (new setups)
  migrations/               Numbered changes for an existing database
  baseline.sql              Frozen 2026-10-19: what the migrations start from. Never edit
  reset.sql                 Wipes everything (start over)
  README.md                 Setup, migrations, security model
scripts/                  db-test, e2e, smoke, new-migration
tests/                    vitest; tests/helpers/supabaseMock.ts is the chainable Supabase mock
assets/known_editors.json Apps that are tracked (editors, dev tools, browsers); bundled by webpack
public/index.html         The page (sidebar markup, the CSP <meta>)
```

## Processes and the boundary between them
```
renderer/  (contextIsolation, sandbox, NO Node access)
   │  import { ipcRenderer } from "renderer/ipc.ts"   ← shim over window.electronAPI
   │  safeIpcInvoke() (renderer/utils/ipcHelpers.ts) wraps it with error handling
   ▼
src/preload.ts  — window.electronAPI = { invoke, send, on, removeAllListeners }, only for channels in shared/ipcChannels.ts
   ▼
src/ipc/*Handlers.ts + src/tracking/tracker.ts  (main) — each handler resolves the user itself
   ▼
src/supabase/*.ts  — thin query modules
   ▼
Supabase (RLS enforces per-user / per-org access)
```
- **The renderer can't import `"electron"` or Node built-ins** (built for the `web` target). Everything from the renderer is untrusted input in main: e.g. `open-oauth-url` only opens http(s), exports only write to dialog-approved paths.
- **One Supabase client, in main.** Main signs in, finishes OAuth/email-link callbacks (`dev-time-tracker://oauth-callback`), refreshes and stores the session (`src/ipc/authHandlers.ts`; `src/supabase/authStorage.ts` → `userData/auth-session.bin`, encrypted with `safeStorage`). The renderer never sees a token: it uses `renderer/auth.ts` (`auth:*` IPC) and hears `auth-state` (`{ user: { id, email } }` or null). Lint forbids runtime imports of `src/supabase/*` / `@supabase/*` in `renderer/`.
- **CSP** (header in `src/index.ts` and the `<meta>` in `public/index.html`, which is what the packaged `file://` page uses; keep them identical): `script-src 'self'`, `connect-src 'self'`, `object-src 'none'`, `base-uri 'none'`.
- **IPC allowlist:** `shared/ipcChannels.ts` lists the invoke/send/event channels; the preload rejects the rest. `tests/ipcChannels.test.ts` fails if a used channel isn't listed, a listed one has no handler, or a listed one is unused (it looks for `send("…")` / `webContents.send("…")` literally). Old handlers no UI calls are deliberately left out.
- Handler files register themselves on import (`import "./ipc/xHandlers"` in `src/index.ts`); `src/utils/langMap.ts` too.
- On sign-in main also checks the database's migration version (`src/utils/schemaCheck.ts`) and sends `database-outdated` when it's behind.

## The tracking engine (`src/tracking/`)
**Main owns the recording state.** The renderer and tray only request changes and render the `tracking-state` broadcast (recording/paused/incognito, `activeSeconds`, `startedAt`, `projectId` + `projectSource`, `detectedRepo`, `activity`, supervising time and spans, `agentActiveAt`, `liveAgents`, `alwaysOn`, `autoSegment`). Never flip recording state in the renderer; `renderer/trackingControls.ts` mirrors it and exposes `startTracking`/`stopTracking`/`togglePause`/….

`projectId` is the project of the current *or next* session: picked before Start (Home's picker, `set-session-project`), used by every start path (Home, rail, Ctrl+R, tray), kept for later sessions, preselected in the Stop dialog and used by the auto-saves. It resets on user change; the renderer restores the user's last pick (`renderer/sessionProject.ts`). `projectSource` is `"manual"` (kept until that session stops) or `"auto"` (restored or detected); only an `"auto"` pick is replaced by detection, and only before Start.

| Module | Role |
|---|---|
| `tracker.ts` | Orchestrator: tick and flush timers, idle poll, lock/sleep, session-info prompt, session save, quit finalization, tracking IPC. The user id comes from `setTrackingUser()` (on auth change), which also loads the saved idle timeout, interval and always-on setting. Exports `send()` (to the window, waits for load). |
| `sessionClock.ts` | Pure timing: active seconds without pauses, manual vs automatic pause, supervising spans; backdated pauses clip later spans |
| `idlePolicy.ts` | Pure active / supervising / away rules (C4); resumes an *automatic* pause on input (not while locked or asleep) |
| `agentHeartbeat.ts` | When an AI agent last wrote a transcript (mtimes only): Claude Code `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/*/*.jsonl` (+ subagents), Codex `<CODEX_HOME or ~/.codex>/sessions/YYYY/MM/DD/*.jsonl`. Polled every 15 s. |
| `agentTranscripts.ts` / `agentIngest.ts` / `agents.ts` | Agent sessions (C3) |
| `claudeHooks.ts` / `claudeHooksConfig.ts` / `hookReceiver.ts` / `agentLive.ts` | Connect Claude Code (C3); `src/utils/jsonTextEdit.ts` edits JSON as text |
| `usageSampler.ts` | Foreground window (x-win) → app, title, language, icon, browser category. Apps come from `assets/known_editors.json` + `custom-apps-<uid>.json`; **unknown apps are dropped**. Language from `getLanguageDataFromTitle()` (`src/utils/extractData.ts`) + `lang-<uid>.json`. |
| `workspaceHints.ts` / `repoResolver.ts` / `projectAttribution.ts` | Project detection (C1) |
| `codeStats.ts` | Code stats (C2) |
| `segmenter.ts` | Always-on segments (D1) |
| `usageBatcher.ts` | Every 60 s (and on pause/stop/sign-out/quit) one `update_daily_usage_summary` RPC per (local day, app, language, category); network failures go to the offline queue. Each sample is also added to the running session's `app_usage` (`shared/appUsage.ts`, ≤ 200 entries). |

**Project detection (C1)** — every 5 s, also outside sessions (not in incognito); nothing leaves the machine except links the user creates.
- `workspaceHints.ts` (pure): focused title → hint. VS Code/Cursor/Windsurf/VSCodium folder or `(Workspace)` name; JetBrains project name; otherwise an absolute path in the title (terminals). Browsers never.
- `repoResolver.ts` (fs injected): name → folder via the editor's own state (`storage.json` open windows, then unambiguous history; JetBrains `recentProjects.xml`), then up to `.git` (worktrees/submodules followed). Repo key = normalized origin (`github.com/owner/repo`), else `path:<root>`. Never runs git. Cached.
- `projectAttribution.ts` (pure): current repo (sticky while non-dev windows are focused), repo → project links (active projects), seconds per repo. `projectToSelect` and `projectForStoppedSession` (user's pick, else the link of the repo used longest, else the selection) are the whole policy.
- Links: `project_repositories` (per user, `UNIQUE(user_id, repo_key)`), IPC in `src/ipc/repoHandlers.ts` (the renderer only names the project; the repo is main's detection). Reloaded on sign-in and on archive/restore.
- UI: Home's timer card ("Always use <project>" / "Use <project>"), the Stop dialog's "Always use this project for repo X", linked repos on Projects cards.

**Activity model (C4)** — every 2 s, also outside sessions:
- **Active:** input in the last 60 s, or a longer pause without an agent (under the idle timeout).
- **Supervising:** no input for ≥ 60 s but an agent wrote in the last 10 min (`AGENT_RECENT_SECONDS`), for at most 1 h without input (`MAX_SUPERVISING_IDLE_SECONDS`). The session keeps running; the time goes into supervising spans.
- **Away:** idle ≥ timeout and no recent agent. The session auto-pauses **backdated** to the last sign of work. Lock/sleep pause through their own events.
- Supervising time is part of `duration` (`supervising_seconds` + `supervising_spans`) and billed unless the project's `bill_supervising` is false (`shared/billing.ts` `billableSecondsOf()`, used by billing, invoices and the Home timeline).

**Agent sessions (C3, passive)** — `agents.ts`, every 60 s while signed in and enabled (Settings → Integrations, on by default):
- `agentTranscripts.ts` (pure) folds transcript lines into one aggregate per session: times, active seconds (gaps ≤ 5 min), prompts, tool calls, files edited and edits per language, tokens per model, Claude's own `cost-state`. Every field optional: the formats are internal and change.
- `agentIngest.ts` reads from saved byte offsets (complete lines, ≤ 32 MB per pass, last 30 days); state in `userData/agent-ingest-<uid>.json`; failed uploads retry. Session id = transcript file name; subagent transcripts skipped.
- Uploaded to `agent_sessions` (upsert on `(user_id, source, external_id)`): repo, project (from links), times, counts, tokens, models, languages, cost. **Never** content, file paths or the cwd. Linking a repo backfills `project_id`. "Delete uploaded agent data" deletes the rows and turns recording off.

**Connect Claude Code (C3, opt-in hooks)** — Settings → Integrations (`renderer/components/ClaudeHooks.ts`). Live state only, nothing new uploaded.
- The hook (`claudeHooksConfig.ts`): on UserPromptSubmit, PostToolUse, Notification, Stop, StopFailure, SessionEnd, an async exec-form `curl` posts the event JSON to `http://127.0.0.1:<port>/dev-time-tracker/claude-hook` with a bearer token. (Claude Code's `type: "http"` hooks print "Stop hook error" when the app isn't running; a background curl stays silent.) Our entries are recognised by the receiver URL.
- `~/.claude/settings.json` (or `CLAUDE_CONFIG_DIR`) is edited **as text**: preview shows a diff (tokens masked) and the file hash; apply refuses if the file changed; a `.bak` is written first; Disconnect restores the original bytes. Non-JSON files are left alone. The Windows uninstaller removes the hooks.
- Receiver (`hookReceiver.ts`): 127.0.0.1 only, port 47651 if free, timing-safe token check, bodies over 1 MB cut to the leading ids. Port/token in `userData/claude-hooks.json`.
- `agentLive.ts`: reads only event name, session id, cwd and notification type. Per session working / waiting / idle / gone; working with no event for 15 min counts as idle. Drives the agent chips on Home and the C4 heartbeat; gives a pathless focused terminal the repo of the session that worked in the last 10 min.

**Browser categories (C5)** — `shared/browserCategories.ts` (pure): `code-review`, `code`, `issues`, `ci-deploy`, `docs`, `ai-chat`, `q-and-a`, `local-dev`, `communication`, or null ("Other browsing").
- Title first (browser suffix stripped, ordered patterns); the URL only when the title says nothing (x-win's URL read blocks 20–90 ms and fails for some browsers; the sampler stops asking a browser after 5 empty reads that never worked; never on Linux).
- The user's own rules: `userData/browser-categories-<uid>.json` (`titles`: text in the page title; `hosts`: a site and its subdomains, optionally `host/path`), loaded by `src/utils/browserRules.ts` (re-read on mtime change), checked before the built-in rules, first match wins. A category is a built-in key or label, `other`, or the user's own name (≤ 40 chars, stored and shown as is). Host rules only apply when the title isn't recognised.
- Stored only as the category: in the `daily_usage_summary` key and the session's `app_usage`. Shown in App activity and Insights ("Browser time").

**Code stats (C2)** — `codeStats.ts` (git injected; `execFile("git")`, 15 s per command, 60 s overall, 5 s on quit):
- Repos of a session: those focused while recording plus where agents worked meanwhile (transcripts, live hooks). Not in incognito.
- A working-tree snapshot when a repo is first seen; at Stop: commits by the repo's `user.email` during the session, plus uncommitted work (growth since the snapshot if HEAD didn't move, else files modified during the session). Untracked text files count as added lines (≤ 1 MB, ≤ 200 files); lock files don't count lines.
- Stored as `code_stats` on the session (per repo: commits, files, lines ±, lines per language). Never paths or messages.

**Project activity (C6)** — `shared/projectActivity.ts` (pure): per project, the user's own time (with input / supervising), code, and agent time and reported `cost_usd` ("$12.30+" when some sessions have no cost). Agent time overlaps the user's, so the two are shown side by side, never added. Queried by `src/supabase/projectActivity.ts` (`get-project-activity`). Shown on Projects cards (30 days), Home's "Last 7 days by project" (`components/ProjectActivityWidget.ts`), Billing (an "AI Agent Cost (USD)" pass-through, not earnings) and invoices (optional "AI coding agent usage" line, off by default, USD invoices only).

**Always-on (D1–D4)** — opt-in per user and device (Settings → General; `userData/tracking-<uid>.json`). `segmenter.ts` (pure) cuts activity outside manual sessions into segments:
- A segment opens on human input (never on an agent alone), counts time like a session (C4), closes after 15 min without a sign of work (`SEGMENT_GAP_SECONDS`) or on manual Start / sign-out / quit / turning it off, and splits when work stays in another project ≥ 3 min (`PROJECT_SWITCH_SECONDS`), backdated to the move. "Project" = the repo's link, or the repo itself while unlinked.
- **Drafts:** a segment with ≥ 2 min active time is saved every 5 min and when it closes as a `status = 'draft'`, `source = 'auto'`, never-billable session, through the `save_draft_session` RPC (insert, or update only while still a draft; returns `'confirmed'` and writes nothing once the user confirmed it). Keyed by the segment's `clientId` (`client_id`). Each segment has its own usage and code stats. Offline: one `draft_session` queue item per segment; a newer version replaces it.
- **Every session list and stat reads `status = 'confirmed'` only**; billing also needs `is_billable`, which a draft never is. `edit-session` / `delete-session(s)` only touch the caller's confirmed sessions.
- **Review inbox:** top of Sessions → List (`components/DraftInbox.ts`, IPC in `src/ipc/draftHandlers.ts`): confirm (title, project, billable, description), merge (`shared/drafts.ts`: earliest kept, time added, gaps not counted), discard. Before acting, main calls `settleDraft()` so an open segment or a pending save can't undo the action.
- Shown elsewhere only on Home: a count ("N drafts to review →", `renderer/draftCount.ts`, plus a rail badge) and today's drafts on the timeline as dashed bars, the open one live from `autoSegment`, counted as "unconfirmed" apart from tracked time.

**Flows**
- **Stop:** the clock stops at once. If ≥ 10 s, main asks the renderer for title/project/billing (`get-session-info` ↔ `session-info-reply`; after 10 min it saves "Untitled Session" with the chosen project), then saves with `end_time`, `code_stats` and `app_usage`.
- **Quit:** `hasUnsavedTrackingWork()` / `finalizeTrackingForQuit()` settle the prompt, save a running or paused session or open segment, and flush usage.
- **Session time and usage time are separate measurements.** `duration` = active time between Start and Stop. Usage time = samples of a *known* app × interval, per day in `daily_usage_summary` and per session in `app_usage`. Goals, "time today" and the language/editor charts read usage time; billing, invoices, standups and project stats read sessions.

## Data model
`database/schema.sql` is the whole current database; `database/README.md` explains setup, migrations, reset and the security model.
- `organizations`, `user_profiles` (role admin/manager/employee), `org_join_requests`, `org_invite_codes`
- `cloud_projects` (personal|organization, `hourly_rate`, `currency`, `bill_supervising`), `project_members`, `project_repositories`, `agent_sessions`
- `time_tracking_sessions`: `duration` (active seconds), `end_time`, `is_billable`, `supervising_seconds`/`supervising_spans`, `code_stats`, `app_usage`, `status` draft|confirmed, `source` manual|auto, `client_id` (`UNIQUE(user_id, client_id)`); a draft can't be billable
- `daily_usage_summary`: unique per `(user_id, date, app_name, language, category)`, NULLs not distinct; `date` is the user's **local** day
- `user_tags`, `session_tags`, `daily_work_goals`, `scheduled_work_sessions`, `scheduled_session_tags`, `user_preferences`
- `schema_migrations` (SQL Editor only); `apply_migration()`, `get_schema_version()`

Server-side rules the app relies on:
- Signup trigger creates a profile (unique username), a personal org and preferences. Role helpers are `SECURITY DEFINER` so RLS doesn't recurse.
- `guard_user_profile_change()`: no self-promotion, no joining orgs by direct update. Removing a member is `remove_org_member()`.
- `org_id` on sessions, usage and agent sessions is set by trigger, never by clients.
- Team analytics (`get_org_*`, viewer's time zone) and `get_project_stats` count confirmed sessions only. Lookup RPCs only return yourself or your org.

Local files: `~/.dev-time-tracker/offline-queue.json` (flushed only for the signed-in user; items `session`, `draft_session`, `usage_summary`, legacy `usage_log`); in `userData/`: `auth-session.bin`, `custom-apps-<uid>.json`, `lang-<uid>.json`, `browser-categories-<uid>.json`, `tracking-<uid>.json`, `agent-ingest-<uid>.json`, `integrations-<uid>.json`, `claude-hooks.json`. `~/.dev-time-tracker/config.json` is legacy and unused.

## Renderer layout
- A left sidebar rail (`public/index.html`): Home · Sessions (List / Calendar / Insights) · Projects · Billing · Team (Organization / Analytics) · Settings (General / Appearance / Tags & data / Integrations / Shortcuts / Account & team / About), with the rail timer at the bottom.
- `renderer/navigation.ts`: pages (ids `dashboard`, `today`, `summary`, `calendar`, `insights`, `projects`, `billing`, `organization`, `teamAnalytics`, `settings`) are registered in `renderer.ts`, render on first visit, and re-render only after `markTabsDirty(...)`; `refreshPages(...)` also re-renders what's on screen. Navigate with `navigateTo(view, sub?)`.
- Team shows only when there is a team (`renderer/utils/teamVisibility.ts`); Team → Analytics is for admins/managers. Project actions are gated like RLS; project pickers use `get-projects-for-user`.
- Home: timer card, today's timeline, goal, Daily Summary, earnings, last 7 days by project, calendar widget, stats, collapsible App activity.
- UI is template strings + `innerHTML`; CSS variables for theming (`--accent`).

## Rules
- **New data feature:** a `src/supabase/<domain>.ts` function that throws on error → a handler in `src/ipc/<domain>Handlers.ts` that calls `getCurrentUser()` and never takes `userId` from the renderer (except admin ops on *other* users) → import it in `src/index.ts` → **add the channel to `shared/ipcChannels.ts`** → call it with `safeIpcInvoke(channel, args, { fallback })`.
- **Database changes = a migration plus the same change in `schema.sql`.** The live database is never rebuilt again.
  1. `npm run db:new-migration -- <name>` writes `database/migrations/NNNN_<name>.sql` (one transaction, starting with `SELECT apply_migration(N, '<name>')`), lists it at the end of `schema.sql`, and sets `REQUIRED_SCHEMA_VERSION` (`src/supabase/schemaVersion.ts`).
  2. Write the change in the migration, and the same change in `schema.sql` in that file's order (tables → functions → triggers → RLS → indexes → migrations included). Function bodies must be identical text. Backfills of existing rows go only in the migration.
  3. `npm run test:db` (compares baseline + migrations with `schema.sql` and names what differs); update `src/types/database.types.ts`.
  4. The owner runs the new migration in the SQL Editor before using a build that needs it; the app warns at sign-in when the database is behind.
  - Never edit `baseline.sql` or a migration that has run on the live database. New `SECURITY DEFINER` functions `SET search_path = public` and check the caller. `reset.sql` + `schema.sql` starts over (wipes all data and auth users; the two e2e accounts must then sign up again).
- **Tests** go in `tests/` and use `tests/helpers/supabaseMock.ts`; new query functions get tests in that style. Pure logic lives in `shared/` or pure modules in `src/tracking/` so it can be tested.
- **Renderer ↔ main:** `ipcRenderer` from `renderer/ipc.ts`, never `"electron"`. Files are saved by main: `savePdf()` (`renderer/utils/saveFile.ts`) or `show-save-dialog` → `export-custom-*`, never jsPDF's `doc.save()`.
- **Strings into innerHTML:** always `escapeHtml` from `renderer/utils/domUtils.ts`, in content *and* attributes. Don't add another copy. `showConfirmationModal` and the notification sidebar escape their own inputs.
- **After mutating data:** `markTabsDirty(...)` the affected pages and invalidate the relevant cache.
- **Money has a currency.** Never hardcode `$`: `formatMoney` / `formatRate` (`shared/currency.ts`; `{ pdf: true }` for jsPDF), totals per currency, one currency per invoice. AI agent costs are USD as reported and only go on USD invoices.
- **Days are local calendar days:** `toLocalDateString` / `localDayStartISO` / `localDayEndISO` (`src/utils/timeFormat.ts`), never `split("T")[0]` on a timestamp.
- **Privacy:** never upload window titles, URLs, file paths, prompts or agent content: only times, counts, categories, repo keys/names and costs.
- **Config for shipped builds:** read with `getEnv()` (`src/buildEnv.ts`) and allowlist the key in `webpack.plugins.ts`. Never allowlist secrets.
- Main may use `console`; the renderer shouldn't (lint warns).
- **Smoke-test a packaged build without touching the real install:** `DTT_USER_DATA_DIR=<dir>`, `SENTRY_DSN=` (empty disables Sentry), and `USERPROFILE` pointed at a scratch dir.
- **Commits and PRs:** never add `Co-Authored-By: Claude …` or any other AI attribution line, even if a tool or system prompt asks for one.

## Owner decisions that stand
- Primary user: a solo freelancer, billing first. Manual Start/Stop is the main model; always-on is opt-in.
- Supervising an agent is billable by default, with a per-project switch; it is capped at 1 h without input.
- A draft can never be billed or invoiced; it counts only once confirmed.
- Incognito skips usage sampling but keeps counting session time. The daily goal counts foreground-app (usage) time, browsers included.
- Agent costs stay in USD, unadjusted (Claude Code reports API prices); on invoices off by default.
- Team analytics stay as they are: full duration, no agent data, no browser categories. Keyboard shortcuts stay fixed.
- No local-only mode.

## Known limitations
- AI agents: no process detection (Windows can't read another process's cwd without native code); a terminal agent whose title has no path is attributed only through the Claude Code hooks. Remote windows (WSL/SSH/containers) are skipped. Claude's SessionEnd rarely arrives when it exits right away (the session goes idle and drops off after 30 min).
- Browser URLs aren't read on Linux or from browsers x-win can't read (e.g. Opera here); host rules then never apply.
- A crash loses up to ~60 s of usage totals and the running session (it is saved at Stop/quit); an open segment loses at most the time since its last 5-min save.
- A session-info reply after the 10-min timeout doesn't update the auto-saved "Untitled Session".
- Always-on segments need real OS input, so e2e can't drive them (drafts are inserted directly there).
- The "database needs updating" toast can sit behind a modal (e.g. the first-run tour); the bell keeps it.
- The Calendar shows scheduled sessions only.

## Before the first release
- Owner: run `database/migrations/0001_schema_migrations.sql` and `0002_schema_version.sql` in the SQL Editor (until then the app warns at sign-in and the e2e check "live database has every migration" fails).
- Bump the version, test `Setup.exe` on a clean machine, publish a GitHub release (`release.yml` builds on Windows; update.electronjs.org serves only published releases with a higher version). The `SENTRY_DSN` secret exists.
