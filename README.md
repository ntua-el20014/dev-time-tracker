# Dev Time Tracker

A cloud-backed desktop time tracker for developers who bill their time, including time spent working with AI coding agents.
Start a session, pick a project, and it records where the time went: your own time, time supervising an agent, what the agents did and cost, and what code changed. Billing and invoices are built from that. Data syncs through Supabase.

---

## 🚀 Features

### **Tracking**

- **Sessions:**
  Start, pause and stop a timer from the app, the tray or `Ctrl+R` / `Ctrl+P`. Pick the project before you start. When you stop, confirm the title, project and billable flag. You can edit, tag or delete past sessions.
- **Automatic project detection:**
  Recognises the git repo you're working in from the focused editor (VS Code, Cursor, Windsurf, VSCodium, JetBrains IDEs) or a terminal that shows a path. Link a repo to a project once ("Always use …") and its sessions are filed under that project from then on.
- **Active, Supervising, Away:**
  Without keyboard or mouse input the session doesn't pause right away if an AI agent is still working. That time counts as *supervising*, for up to an hour without input. When you're really away, the session pauses, backdated to your last sign of work, and resumes on input. Each project decides whether supervising time is billed.
- **App activity:**
  Every 10 seconds (configurable) the foreground app is sampled while recording. Its language comes from the file extension in the window title. For a browser, the page type is worked out on your machine (code review, issues, CI, docs, AI chat, Q&A, local dev). Only the totals are uploaded (see *Privacy*).
- **Code changed (git):**
  At Stop, each repo you or an agent worked in gets lines added and removed per language, files changed and commits made during the session. Uncommitted work is included.

### **AI coding agents**

- **Agent sessions:**
  Reads Claude Code and Codex session logs on your machine. For each agent session it keeps start/end, active time, prompts, tool calls, files edited, tokens per model and the reported cost. It's filed under the project linked to that repo. On by default, and you can turn it off or delete what was uploaded in Settings → Integrations.
- **Connect Claude Code (optional):**
  Adds hooks to `~/.claude/settings.json` (after showing you the change and making a backup). Home then shows live chips for your agents (working / waiting for you / idle), and an agent working in the background keeps the session in *Supervising*. Disconnect restores the file byte for byte.

### **Projects & Billing**

- **Projects:**
  Personal or organization projects, each with an hourly rate in its own currency, linked repos, and the last 30 days of your time, agent time and cost, and code changed.
- **Billing:**
  Billable hours and earnings per month, per project, in each project's currency. Totals in different currencies are kept apart. Agent costs (USD, as reported by the agent) are shown next to earnings but aren't part of them.
- **Invoices:**
  PDF invoices for a date range, one currency per invoice. Agent costs can be added as a line item, at cost, on USD invoices.
- **Currencies:**
  Set your default currency in Settings → Preferences. New projects start with it, and each project can use a different one.

### **Analytics & Planning**

- **Home:** Timer with the project picker, today's timeline (supervising time hatched), daily goal, earnings, upcoming scheduled sessions, standup summary, and today's app activity.
- **Sessions:** List (by date or by session, with a review panel for short sessions), Calendar (past and scheduled sessions), and Insights (code changed, browser time by page type, editor and language charts, goal history).
- **Charts:** Custom charts grouped by date, language, editor, tag, weekday or hour.
- **Daily goals and scheduled sessions,** with notifications and weekly recurrence.

### **Teams**

- **Organizations:** Create or join with an invite code, roles (admin / manager / employee), join requests. The Team section only appears once there is someone else in your organization.
- **Team analytics** for admins and managers: hours, top projects, member activity, languages.

### **Everything else**

- Email/password or GitHub sign-in. The session is kept by the main process, encrypted with the OS keychain.
- An offline queue keeps sessions and usage while the network is down and uploads them later.
- Dark and light themes with custom accent colours, tray menu, auto-update on Windows, CSV/JSON/PDF export.

---

## 🔒 Privacy: what leaves your machine

| Recorded | Uploaded |
|---|---|
| Foreground app, window title, browser URL (every sample) | Only **time per app, language and page type**, per day and per session. Window titles and URLs are never uploaded. |
| Git repos you work in | The repo's remote name (e.g. `github.com/owner/repo`) when you link it to a project, and line/file/commit **counts** per session. Never file paths, file names or commit messages. |
| AI agent session logs | Counts, times, tokens, models, languages and reported cost. Never prompts, replies, file paths or the working directory. |
| Claude Code hook events (if connected) | Nothing. They stay in the app; it only reads the event name, session id, folder and notification type. |

Incognito mode (`Ctrl+Alt+Shift+I`) stops app sampling and project detection. The session timer keeps running.

---

## ⚠️ Platform Notes

| Platform            | Active Window Tracking | Notes |
| ------------------- | ---------------------- | ----- |
| **Windows**         | ✅ Full support        | Uses native Win32 APIs via `@miniben90/x-win`. Auto-update and Connect Claude Code are tested here. |
| **macOS**           | ✅ Full support        | Requires Accessibility permission (prompted on first run). |
| **Linux (X11)**     | ✅ Works               | X11 session required. Browser URLs aren't read, so page types come from titles only. |
| **Linux (Wayland)** | ❌ Not supported       | `@miniben90/x-win` does not support Wayland. Run the app under **XWayland** (e.g. `GDK_BACKEND=x11`). |

> **Custom Apps:** If your editor, terminal or browser isn't recognised, open
> **Settings → Integrations → Open custom-apps.json** and add its executable name.
> Unknown apps aren't recorded at all.

---

## 🏗️ Architecture

An Electron app whose data lives in **Supabase (PostgreSQL)**. The renderer is sandboxed (no Node, strict CSP, no network access): it talks to the main process over an allowlisted IPC bridge, and only the main process holds a Supabase client.

```
┌──────────────────────────────────────────────────────────────────┐
│                          Electron App                            │
│                                                                  │
│  ┌──────────────────┐  IPC (allowlist)  ┌──────────────────────┐ │
│  │ Renderer          │ ◄──────────────► │ Main process          │ │
│  │ (sandboxed UI)    │                  │                       │ │
│  │                   │                  │ tracking/             │ │
│  │ Home              │                  │  timer, idle model,   │ │
│  │ Sessions          │                  │  app sampling, repo   │ │
│  │ Projects          │                  │  detection, git stats,│ │
│  │ Billing           │                  │  agent logs + hooks   │ │
│  │ Team              │                  │ ipc/  (handlers)      │ │
│  │ Settings          │                  │ supabase/ (queries)   │ │
│  └──────────────────┘                   └──────────┬───────────┘ │
└────────────────────────────────────────────────────┼─────────────┘
                                                     ▼
                                           ┌──────────────────┐
                                           │ Supabase          │
                                           │ Auth + RLS        │
                                           │ 16 tables, RPCs   │
                                           └──────────────────┘
```

### Data Flow

1. The **renderer** calls `safeIpcInvoke(channel, args)`. The preload only forwards channels listed in `shared/ipcChannels.ts`.
2. **IPC handlers** (main) work out the signed-in user themselves; they never take a user id from the page.
3. The **Supabase layer** (`src/supabase/`) runs the queries, and Row Level Security enforces who may see what.
4. The **tracker** (main) owns the recording state and broadcasts it to the renderer.

---

## 🗄️ Database Schema

The whole database (tables, functions, triggers, RLS and indexes) is one file, [`database/schema.sql`](./database/schema.sql). See [`database/README.md`](./database/README.md) for setup, reset and the security model.

### Supabase API Reference

| Module             | File | Description |
| ------------------ | ---- | ----------- |
| Auth & Users       | [`api.ts`](./src/supabase/api.ts), [`authStorage.ts`](./src/supabase/authStorage.ts) | Sign in/up, OAuth, profile; encrypted session storage |
| Time Tracking      | [`timeTracking.ts`](./src/supabase/timeTracking.ts) | Sessions (with supervising time, code stats, app usage) |
| Usage              | [`usageLogs.ts`](./src/supabase/usageLogs.ts) | Daily usage summaries, editor/language/browser stats |
| Billing            | [`billableHours.ts`](./src/supabase/billableHours.ts) | Billable hours and earnings per project and currency |
| Project activity   | [`projectActivity.ts`](./src/supabase/projectActivity.ts) | Your time, agent time/cost and code per project |
| Agents & repos     | [`agentSessions.ts`](./src/supabase/agentSessions.ts), [`projectRepositories.ts`](./src/supabase/projectRepositories.ts) | AI agent sessions; repo → project links |
| Projects           | [`cloudProjects.ts`](./src/supabase/cloudProjects.ts) | Personal/org projects, members, archive/restore |
| Organizations      | [`organizations.ts`](./src/supabase/organizations.ts), [`orgRequests.ts`](./src/supabase/orgRequests.ts), [`orgInviteCodes.ts`](./src/supabase/orgInviteCodes.ts), [`orgAnalytics.ts`](./src/supabase/orgAnalytics.ts) | Orgs, members, join requests, invites, team analytics |
| Planning           | [`goals.ts`](./src/supabase/goals.ts), [`scheduledSessions.ts`](./src/supabase/scheduledSessions.ts), [`tags.ts`](./src/supabase/tags.ts) | Daily goals, scheduled sessions, tags |
| Preferences        | [`userPreferences.ts`](./src/supabase/userPreferences.ts) | Theme, accent colours, idle timeout, interval, default currency |

More detail: [Supabase API Reference](./src/supabase/README.md).

### Database Functions & Triggers

| Function | Purpose |
| -------- | ------- |
| `handle_new_user()` | On signup: profile (unique username), personal org, default preferences |
| `guard_user_profile_change()` | Blocks self-promotion and joining orgs by direct profile updates |
| `set_org_id_from_user()` | Server-side `org_id` on sessions, usage summaries and agent sessions |
| `calculate_session_duration()` | Derives `duration` from `end_time` only when the app didn't set it |
| `update_daily_usage_summary()` | Adds usage time per user / local day / app / language / page type |
| `session_billed_seconds()` | Billed part of a session (supervising time left out where the project doesn't bill it) |
| `get_current_user_org_id()` / `get_current_user_role()` / `is_user_admin*()` | SECURITY DEFINER helpers used by RLS policies |
| `get_user_profile_by_id()` / `get_organization_by_user_id()` / `get_organization_members_by_org_id()` | Lookups limited to yourself and your own org |
| `create_personal_organization()` / `create_team_organization()` | Create organizations |
| `approve_join_request()` / `reject_join_request()` / `remove_org_member()` | Membership (admins) |
| `create_invite_code()` / `join_organization_with_code()` / `revoke_invite_code()` | Invite codes |
| `archive_project()` / `restore_project()` / `get_project_stats()` | Projects |
| `get_org_*()` | Team analytics for admins/managers (viewer's local days) |

---

## 🛠️ Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (22.15.1) and npm
- [Git](https://git-scm.com/) (also used at runtime for code stats)
- A [Supabase](https://supabase.com/) project (the free tier works)
- Optional: `curl` on the PATH, for Connect Claude Code

### 1. Clone & Install

```bash
git clone https://github.com/ntua-el20014/dev-time-tracker.git
cd dev-time-tracker
npm install
```

### 2. Set Up Supabase

1. Create a project at [supabase.com](https://supabase.com/) and wait for provisioning to finish.
2. In the Supabase **SQL Editor**, paste and run [`database/schema.sql`](./database/schema.sql). It is the complete database in one file. To start over later, run [`database/reset.sql`](./database/reset.sql) first (it deletes all data and users). See [`database/README.md`](./database/README.md).
3. **Authentication → Providers**: enable **Email**. **GitHub** is optional (a GitHub OAuth App with callback URL `https://<your-project>.supabase.co/auth/v1/callback`).
4. **Authentication → URL Configuration**: add `dev-time-tracker://oauth-callback` to **Redirect URLs** (GitHub sign-in, email confirmation and password reset return through it).
5. Copy the project's **URL** and **anon key** from **Settings → API**.

### 3. Configure Environment

Put the values in a `.env` file at the repo root (see `.env.example`):

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

They are read at build time and baked into the app, and environment variables with the same names override them at runtime. Only allowlisted, non-secret keys are baked in (`webpack.plugins.ts`). `.env.local` (and `.env.production` for packaged builds) are loaded too.

### 4. Run in Development

```bash
npm start
```

This launches the app with webpack hot reload. Create an account on the sign-in screen; a personal organization and default preferences are created on signup.

### 5. Checks

```bash
npm test               # unit tests (vitest, mocked Supabase)
npm run type-check     # main + renderer
npm run lint
npm run test:db        # database/schema.sql in an in-process Postgres (PGlite)
```

### 6. Build

```bash
npm run package    # packaged app in out/
npm run make       # installers
npm run clean      # remove build artifacts (.webpack, dist, out)
```

### All Commands

| Command                       | Description |
| ----------------------------- | ----------- |
| `npm start` / `npm run dev`   | Development mode with hot reload |
| `npm test` / `npm run test:watch` | Unit tests (vitest) |
| `npm run type-check`          | TypeScript (main + renderer); `:main` / `:renderer` for one |
| `npm run lint` / `lint:fix`   | ESLint |
| `npm run test:db`             | Check `database/schema.sql` in PGlite |
| `npm run test:smoke`          | Smoke-test the packaged app (after `npm run package`) |
| `npm run test:e2e`            | End-to-end test against Supabase with two test accounts from `.env.local` |
| `npm run package` / `make`    | Package / build installers |
| `npm run build`               | Type-check, then build installers |
| `npm run rebuild`             | Rebuild native modules for Electron |
| `npm run clean`               | Remove build artifacts |

### Troubleshooting

- **Native module errors:** run `npm run rebuild`.
- **Auth not working:** check the Supabase URL and anon key, and that the Email provider is enabled.
- **Permission denied / missing column errors:** the database is older than `schema.sql`. There are no migrations yet: rebuild it with `reset.sql` + `schema.sql` (this deletes all data and users).
- **OAuth redirect issues:** add `dev-time-tracker://oauth-callback` to the project's redirect URLs.
- **An app isn't recorded:** add it to `custom-apps.json` (see *Platform Notes*).

---

## 📦 Releasing

- GitHub Actions runs lint, type-check and tests on pushes and pull requests.
- **One-Button Release** (Actions tab, or `gh workflow run release.yml --ref main -f version=patch -f publish=false`):
  - `version`: `patch` / `minor` / `major` or an exact semver; empty uses `package.json`.
  - `release_notes`: optional, otherwise generated from commits since the last tag.
  - `publish`: `true` publishes right away; the default creates a **draft**.
- The workflow builds on Windows (Squirrel installer and update files) and Linux (deb/rpm) and attaches the installers. Publish a draft in the GitHub Releases UI or with `gh release edit vX.Y.Z --draft=false`.
- **Auto-update (Windows):** installed apps update from the latest **published** release through [update.electronjs.org](https://github.com/electron/update.electronjs.org). They check 30 s after start and then hourly, download in the background, and offer "Restart to install" in Settings. A release must have a higher version than the installed one. `UPDATER_ENABLED=false` turns updates off. macOS needs a signed build; Linux has no auto-update.
- **Signing:** Windows when `WINDOWS_CERTIFICATE_FILE` is set (`WINDOWS_CERTIFICATE_PASSWORD`, `WINDOWS_TIMESTAMP_SERVER` optional). macOS when `MACOS_CODESIGN_IDENTITY` is set (notarization: `MACOS_NOTARIZE_APPLE_ID`, `MACOS_NOTARIZE_APPLE_PASSWORD`, `MACOS_NOTARIZE_TEAM_ID`). See [CODE_SIGNING.md](./CODE_SIGNING.md).
- Pushing to `main` never publishes anything by itself.

---

## 🗂️ Project Structure

```
src/                          # Main process
  index.ts                      # App lifecycle, window, tray, auth sync, OAuth
  preload.ts                    # contextBridge: allowlisted IPC only
  buildEnv.ts                   # getEnv(): runtime env, then baked-in values
  tracking/                     # Tracking engine (main owns the recording state)
    tracker.ts                    # Orchestration: timers, idle/lock/sleep, session save, quit
    sessionClock.ts               # Active time, pauses, supervising spans (pure)
    idlePolicy.ts                 # Active / Supervising / Away rules (pure)
    usageSampler.ts               # Foreground window → app, language, page type
    usageBatcher.ts               # Daily usage totals, written once a minute
    workspaceHints.ts, repoResolver.ts, projectAttribution.ts   # Repo → project detection
    codeStats.ts                  # Git stats per session
    agentHeartbeat.ts, agentTranscripts.ts, agentIngest.ts, agents.ts   # AI agent logs
    claudeHooks.ts, claudeHooksConfig.ts, hookReceiver.ts, agentLive.ts # Connect Claude Code
  ipc/                          # IPC handlers, one file per domain
  supabase/                     # Queries, one module per domain (throw on error)
  types/                        # database.types.ts, organization.types.ts
  utils/                        # timeFormat, extractData (language from title), offlineQueue, editors, …

renderer/                     # Sandboxed UI (no Node)
  renderer.ts                   # Entry: auth, page registration, rail timer, Stop dialog
  navigation.ts                 # Sidebar views, sub-views, dirty flags
  trackingControls.ts           # Mirror of main's tracking state
  dashboardTab.ts               # Home
  logsTab.ts                    # Home → App activity
  summaryTab.ts, calendarTab.ts, insightsTab.ts   # Sessions → List / Calendar / Insights
  projectsTab.ts                # Projects
  billingTab.ts                 # Billing
  organizationTab.ts, teamAnalyticsTab.ts         # Team
  settingsTab.ts                # Settings (Preferences, Integrations, Shortcuts, Account & team)
  components/                   # HomeTimer, TodayTimeline, InvoiceModal, ClaudeHooks, …
  utils/                        # safeIpcInvoke, escapeHtml, invoice PDF, …
  styles/                       # One CSS file per feature

shared/                       # Pure code used by both sides
  ipcChannels.ts                # The IPC allowlist
  currency.ts                   # Currencies, money formatting, totals per currency
  billing.ts, projectActivity.ts, codeStats.ts, appUsage.ts, browserCategories.ts

database/
  schema.sql                    # The whole database
  reset.sql                     # Wipes everything (start over)

scripts/                      # db-test, smoke and e2e test runners
assets/known_editors.json     # Apps that are recorded
```

See also the [CSS organization](./renderer/styles/styles.md).

---

## 🔧 Tech Stack

- **Desktop:** Electron 28, TypeScript, Electron Forge + webpack
- **Data:** Supabase (PostgreSQL, Auth, Row Level Security)
- **Charts:** Chart.js · **PDF:** jsPDF
- **Window tracking:** [@miniben90/x-win](https://github.com/miniben-90/x-win)
- **Tests:** vitest, PGlite (database), CDP-driven smoke and e2e tests of the packaged app

---

## 🛡️ License

This project is licensed under the **Business Source License 1.1 (BUSL-1.1)**.

- ✅ You can view and contribute to the code.
- 🚫 You cannot use it in commercial products or production environments.
- 🕒 It will convert to Apache-2.0 on **January 1st, 2035**.

For full license details, see the [LICENSE](./LICENSE) file.

---

## 🤝 Contributing

Pull requests, bug reports and feature suggestions are welcome.
Please open an issue or discussion to get started, and read the [Contributor License Agreement](./CLA.md) first.

---

## 🙏 Acknowledgements

- Built with [Electron](https://www.electronjs.org/) and [TypeScript](https://www.typescriptlang.org/)
- Charts powered by [Chart.js](https://www.chartjs.org/)
- Icons from various open-source icon sets
