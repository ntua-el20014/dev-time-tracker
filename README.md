# Dev Time Tracker

A cloud-powered, cross-platform time tracker built for developers.  
Tracks your coding sessions, editor and language usage, and helps you understand and improve your workflow—with secure cloud sync via Supabase.

---

## 🚀 Features

### **Core Tracking**

- **Automatic Tracking:**  
  Monitors time spent in code editors (like VSCode) and logs active window data every 10 seconds.
- **Session Management:**  
  Start/pause/stop recording sessions, add titles and descriptions, edit or delete past sessions, add colored tags, set per-user idle timeout.

### **Analytics & Visualization**

- **📊 Customizable Charts:**  
  Create interactive charts from your data with multiple chart types (bar, line, pie, doughnut). Group by date, language, editor, tags, day of week, or hour of day. Show total time, session count, or average duration.
- **Detailed Summaries:**  
  View summaries by day or by session, with interactive tables and filtering options.
- **Timeline & Calendar:**  
  Visualize your coding activity with a weekly timeline and a monthly calendar.
- **Editor & Language Stats:**  
  See which editors and programming languages you use most through charts and statistics. Editor and language icons are shown where available.

### **Productivity & Goals**

- **Daily Goals:**  
  Set daily coding time goals with progress tracking and completion status.
- **Goal History:**  
  View your goal completion history and track your consistency over time.
- **Scheduled Sessions:**  
  Plan future coding sessions with optional weekly recurrence and notifications.

### **Organizations & Teams**

- **Organizations:**  
  Create or join organizations, manage members, assign roles (admin/manager/employee).
- **Projects:**  
  Create personal or organization-scoped projects, assign members, track per-project time.
- **Role-Based Access:**  
  Admins and managers can view team activity; employees see only their own data.

### **User Experience**

- **Authentication & Cloud Sync:**  
  Sign in with email/password or GitHub OAuth. All data syncs across devices via Supabase.
- **Connection Status:**  
  Live indicator (Online / Offline / Limited) with graceful degradation.
- **Hotkeys & Tray:**  
  Start/stop and pause tracking with in-app shortcuts (Ctrl+R, Ctrl+P) or from the tray icon, and jump between sidebar sections with Ctrl+1–6. Toggle incognito from any app with Ctrl+Alt+Shift+I.
- **Sidebar layout:**  
  Home (project picker + timer, today's timeline, goal, earnings), Sessions (List / Calendar / Insights), Projects, Billing (billable hours, earnings, invoices), Settings, and Team, which appears once your organization has other members (or someone is waiting to join).
- **Customizable Themes:**  
  Switch between dark and light mode, pick custom accent colors for each theme. Settings sync across devices.
- **Data Export:**  
  Export sessions to CSV or JSON for external analysis.

---

## ⚠️ Platform Notes

| Platform            | Active Window Tracking | Notes                                                                                                                                                                                                                          |
| ------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Windows**         | ✅ Full support        | Uses native Win32 APIs via `@miniben90/x-win`                                                                                                                                                                                  |
| **macOS**           | ✅ Full support        | Requires Accessibility permission (prompted on first run)                                                                                                                                                                      |
| **Linux (X11)**     | ✅ Works               | X11 session required                                                                                                                                                                                                           |
| **Linux (Wayland)** | ❌ Not supported       | `@miniben90/x-win` does not support the Wayland protocol. As a workaround, run the app under **XWayland** (e.g., launch with `GDK_BACKEND=x11`). Pure Wayland compositors without XWayland will not report active window data. |

> **Custom Apps:** If your editor, terminal, or browser isn't recognized automatically, open  
> **Settings → Integrations → Open custom-apps.json** and add its executable name.  
> Changes take effect on the next tracking tick—no restart required.

---

## 🏗️ Architecture

Dev Time Tracker is a **100% cloud-backed** Electron app. All data is stored in **Supabase (PostgreSQL)**.

```
┌──────────────────────────────────────────────────────────────┐
│                     Electron App                             │
│                                                              │
│  ┌─────────────────┐    IPC Bridge    ┌────────────────────┐ │
│  │   Renderer       │ ◄─────────────► │   Main Process     │ │
│  │   (Frontend)     │                 │                    │ │
│  │                  │                 │  IPC Handlers      │ │
│  │  Sidebar:        │                 │   ├─ session       │ │
│  │   Home           │                 │   ├─ usage         │ │
│  │   Sessions       │                 │   ├─ tag           │ │
│  │    (List/Cal/    │                 │   ├─ goal          │ │
│  │     Insights)    │                 │   ├─ project       │ │
│  │   Projects       │                 │   ├─ scheduled     │ │
│  │   Billing, Team  │                 │   ├─ preferences   │ │
│  │   Settings       │                 │   ├─ user          │ │
│  │                  │                 │   ├─ organization  │ │
│  │  Components:     │                 │   └─ export        │ │
│  │   Charts         │                 │                    │ │
│  │   Modals         │                 │  Supabase API      │ │
│  │   ConnectionBar  │                 │   ├─ timeTracking  │ │
│  │   SessionReview  │                 │   ├─ usageLogs     │ │
│  │   Onboarding     │                 │   ├─ tags          │ │
│  │   ...            │                 │   ├─ goals         │ │
│  │                  │                 │   ├─ organizations │ │
│  └─────────────────┘                  │   ├─ cloudProjects │ │
│                                       │   ├─ userPrefs     │ │
│                                       │   └─ scheduledSess │ │
│                                       └────────┬───────────┘ │
└────────────────────────────────────────────────┼─────────────┘
                                                 │
                                                 ▼
                                       ┌─────────────────┐
                                       │    Supabase      │
                                       │   (PostgreSQL)   │
                                       │                  │
                                       │  Auth + RLS      │
                                       │  15 tables       │
                                       │  Triggers & RPCs │
                                       └─────────────────┘
```

### Data Flow

1. **Renderer** sends requests via `ipcRenderer.invoke()` (wrapped with `safeIpcInvoke` for error handling)
2. **IPC Handlers** (main process) resolve the authenticated user internally via `getCurrentUser()`
3. **Supabase API layer** executes queries against PostgreSQL with Row Level Security
4. Responses flow back through IPC to the renderer

---

## 🗄️ Database Schema

All data lives in Supabase (PostgreSQL). The whole database (tables, functions, triggers, RLS and indexes) is defined in one file, [`database/schema.sql`](./database/schema.sql). See [`database/README.md`](./database/README.md) for setup, reset and the security model.

### Supabase API Reference

The Supabase API layer lives in `src/supabase/` and provides 76 exported functions across 11 modules:

| Module             | File                                                          | Description                                             |
| ------------------ | ------------------------------------------------------------- | ------------------------------------------------------- |
| Auth & Users       | [`api.ts`](./src/supabase/api.ts)                             | Sign in/up, OAuth, password reset, profile CRUD         |
| Client             | [`client.ts`](./src/supabase/client.ts)                       | Singleton Supabase client with Electron storage adapter |
| Time Tracking      | [`timeTracking.ts`](./src/supabase/timeTracking.ts)           | Start/end/add sessions, filters, batch delete           |
| Usage Logs         | [`usageLogs.ts`](./src/supabase/usageLogs.ts)                 | Log activity, daily summaries, editor/language stats    |
| Tags               | [`tags.ts`](./src/supabase/tags.ts)                           | Tag CRUD, session tagging by ID or name                 |
| Goals              | [`goals.ts`](./src/supabase/goals.ts)                         | Daily work goals, completion tracking                   |
| Scheduled Sessions | [`scheduledSessions.ts`](./src/supabase/scheduledSessions.ts) | Plan future sessions, notifications, recurrence         |
| User Preferences   | [`userPreferences.ts`](./src/supabase/userPreferences.ts)     | Theme, accent colors, editor colors, idle timeout       |
| Projects           | [`cloudProjects.ts`](./src/supabase/cloudProjects.ts)         | Personal/org projects, members, archive/restore         |
| Organizations      | [`organizations.ts`](./src/supabase/organizations.ts)         | Org CRUD, member management, role updates               |
| Join Requests      | [`orgRequests.ts`](./src/supabase/orgRequests.ts)             | Request/approve/reject organization membership          |

For full function signatures and parameter documentation, see the [Supabase API Reference](./src/supabase/README.md).

### Database Functions & Triggers

Server-side logic in [`database/schema.sql`](./database/schema.sql):

| Function                                                  | Purpose                                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| `handle_new_user()`                                       | On signup: profile (unique username), personal org, default preferences    |
| `guard_user_profile_change()`                             | Blocks self-promotion and joining orgs by direct profile updates           |
| `set_org_id_from_user()`                                  | Server-side `org_id` on sessions, usage logs and summaries                 |
| `calculate_session_duration()`                            | Derives `duration` from `end_time` only when the app didn't set it         |
| `update_daily_usage_summary()`                            | Upserts usage time per user / local day / app / language                   |
| `get_current_user_org_id()` / `get_current_user_role()`   | SECURITY DEFINER helpers used by RLS policies                              |
| `is_user_admin()` / `is_user_admin_or_manager()`          | Role checks                                                                |
| `get_user_profile_by_id()` / `get_organization_by_user_id()` / `get_organization_members_by_org_id()` | Lookups limited to yourself and your own org |
| `create_personal_organization()` / `create_team_organization()` | Create organizations                                                 |
| `approve_join_request()` / `reject_join_request()`        | Process org membership requests (admins)                                   |
| `remove_org_member()`                                     | Remove a non-admin member (admins)                                         |
| `create_invite_code()` / `join_organization_with_code()` / `revoke_invite_code()` | Invite codes                                       |
| `archive_project()` / `restore_project()`                 | Soft-delete and restore projects                                           |
| `get_project_stats()`                                     | Project statistics (sessions, time, members)                               |
| `get_org_*()`                                             | Team analytics for admins/managers                                         |

---

## 🛠️ Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (22.15.1)
- [npm](https://www.npmjs.com/) (comes with Node.js)
- [Git](https://git-scm.com/)
- A [Supabase](https://supabase.com/) project (free tier works)

### 1. Clone & Install

```bash
git clone https://github.com/ntua-el20014/dev-time-tracker.git
cd dev-time-tracker
npm install
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com/) and wait for provisioning to complete

---

## Releasing (subsequent releases)

Follow these minimal steps to publish a new release using your existing automated workflows (no workflow changes required).

1. Commit & push any changes to `main` (CI runs on push):

```bash
git add -A
git commit -m "chore(release): prepare release"  # only if you have changes to commit
git push origin main
```

2. Trigger the One-Button Release workflow (`.github/workflows/release.yml`).

Recommended (GitHub CLI):

```bash
# version: patch | minor | major | or exact semver (e.g. 1.0.1)
# release_notes: optional string
# publish: true to publish, false to keep draft (default)
gh workflow run release.yml --ref main -f version=patch -f release_notes="Optional notes" -f publish=false
```

Notes:

- `version` is where you manually input the bump type or exact semver (e.g. `patch`, `minor`, `major`, or `1.0.1`).
- If you leave `version` empty, ensure `package.json` already has the desired version and tag exists (the workflow will create the release from that).

3. Release Draft to Real with GitHub UI

- Open the Draft.
- Check everything (title, versions, release notes etc.)
- Click "Publish release" button.

CLI alternative (one-liner)

Publish an existing draft release by tag:

```bash
gh release edit v1.0.0 --draft=false
```

2. In the Supabase **SQL Editor**, paste and run [`database/schema.sql`](./database/schema.sql). It is the complete database in one file. To start over later, run [`database/reset.sql`](./database/reset.sql) first (it deletes all data and users). See [`database/README.md`](./database/README.md).
3. Go to **Authentication → Providers** and enable:
   - **Email/Password** (required)
   - **GitHub OAuth** (optional — requires a GitHub OAuth App with callback URL `https://<your-project>.supabase.co/auth/v1/callback`)
4. Go to **Authentication → URL Configuration** and add `dev-time-tracker://oauth-callback` to the **Redirect URLs** list (needed for GitHub sign-in, email confirmation and password reset)
5. Copy your project's **URL** and **anon key** from **Settings → API**

### 3. Configure Environment

Set your Supabase credentials via environment variables or by editing [`src/supabase/env.ts`](./src/supabase/env.ts):

```bash
# Windows (PowerShell)
$env:SUPABASE_URL = "https://your-project.supabase.co"
$env:SUPABASE_ANON_KEY = "your-anon-key"

# Windows (CMD)
set SUPABASE_URL=https://your-project.supabase.co
set SUPABASE_ANON_KEY=your-anon-key

# Linux / macOS
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_ANON_KEY=your-anon-key
```

> **Tip:** For persistent configuration, you can hardcode the values directly in [`src/supabase/env.ts`](./src/supabase/env.ts). Environment variables take priority when set.

### 4. Run in Development

```bash
npm start          # or: npm run dev
```

This launches the Electron app with Webpack hot-reload. The app will show a sign-in screen — create an account to get started. A personal organization and default preferences are auto-created on first signup.

### 5. Type Checking & Linting

```bash
npm run type-check            # Full TypeScript check (main + renderer)
npm run type-check:main       # Main process only
npm run type-check:renderer   # Renderer only
npm run lint                  # ESLint
npm run lint:fix              # ESLint with auto-fix
```

### 6. Build for Production

```bash
npm run make       # Type-check + package into distributable
npm run package    # Package without creating installer
npm run clean      # Remove build artifacts (.webpack, dist, out)
```

### Release Prep

- GitHub Actions runs lint, type checking, and tests on pushes and pull requests.
- A manual package preview workflow builds installers on Linux, Windows, and macOS without publishing them.
- **Auto-update (Windows):**
  - The installed app uses Electron's built-in updater with [update.electronjs.org](https://github.com/electron/update.electronjs.org), which serves the latest **published** GitHub release of this public repo. There's no server to run.
  - It checks 30s after start and then hourly, downloads in the background, and offers "Restart to install" in Settings → Preferences.
  - macOS needs a signed build (set `UPDATER_ENABLED=true` for it). Linux has no auto-update.
  - Set `UPDATER_ENABLED=false` to turn updates off; `UPDATER_GITHUB_REPO` / `UPDATER_FEED_URL` change the source.
- Windows signing is enabled when `WINDOWS_CERTIFICATE_FILE` is set. Optional extras: `WINDOWS_CERTIFICATE_PASSWORD` and `WINDOWS_TIMESTAMP_SERVER`.
- macOS signing is enabled when `MACOS_CODESIGN_IDENTITY` is set. Notarization needs `MACOS_NOTARIZE_APPLE_ID`, `MACOS_NOTARIZE_APPLE_PASSWORD`, and `MACOS_NOTARIZE_TEAM_ID`.

### Release Workflow

- One-button release: use the Actions tab → **One-Button Release** → _Run workflow_.
  - Inputs:
    - `version` (optional): `patch`/`minor`/`major` or exact semver; leave empty to use `package.json` version.
    - `release_notes` (optional): overrides autogenerated notes.
    - `publish` (optional): set `true` to publish immediately; default `false` (creates a draft).
- By default the workflow auto-generates release notes from commits since the last tag. You can override them with `release_notes` when running the workflow.
- The workflow creates a **draft** release, builds on Windows (Squirrel installer + update files) and Linux (deb/rpm), and attaches the installers. Installed apps only update from **published** releases, so a draft reaches nobody until you publish it.
- To publish a release later: either run the workflow with `publish=true` or publish the draft in the GitHub Releases UI.
- Local version bump and tag (optional):

```bash
npm version patch    # bump package.json and create a git tag
git push origin main --follow-tags
```

Commits and pushes to `main` will NOT auto-publish the app — publishing only happens when you run the One-Button Release workflow or publish a release in GitHub.

### All Commands

| Command                       | Description                                     |
| ----------------------------- | ----------------------------------------------- |
| `npm start` / `npm run dev`   | Start in development mode with hot-reload       |
| `npm run type-check`          | Run TypeScript type checking (all projects)     |
| `npm run type-check:main`     | Type-check main process only                    |
| `npm run type-check:renderer` | Type-check renderer only                        |
| `npm run lint`                | Run ESLint                                      |
| `npm run lint:fix`            | Auto-fix lint issues                            |
| `npm run clean`               | Remove build artifacts                          |
| `npm run build`               | Type-check + build for production               |
| `npm run make`                | Package into distributable (platform installer) |
| `npm run package`             | Package without creating installer              |
| `npm run rebuild`             | Rebuild native modules for Electron             |
| `npm test`                    | Unit tests (vitest)                             |
| `npm run test:db`             | Check `database/schema.sql` in an in-process Postgres |
| `npm run test:smoke`          | Smoke-test the packaged app (after `npm run package`) |
| `npm run test:e2e`            | End-to-end test against Supabase with two test accounts from `.env.local` |

### Troubleshooting

- **Native module errors:** Run `npm run rebuild` to rebuild native dependencies for your Electron version.
- **Auth not working:** Check that your Supabase URL and anon key are correct. Verify email/password provider is enabled in Supabase.
- **RLS errors (permission denied):** Make sure the whole of `database/schema.sql` ran without errors.
- **OAuth redirect issues:** Add `dev-time-tracker://oauth-callback` to your Supabase project's redirect URLs.

---

## 🗂️ Project Structure

```
src/                          # Main process (Electron backend)
  index.ts                      # App entry: window, tray, auth sync, OAuth, IPC registration
  preload.ts                    # Preload script for secure IPC bridge
  buildEnv.ts                   # Build-time config (getEnv: runtime env, then baked-in values)
  tracking/                     # Tracking engine (main process owns recording state)
    tracker.ts                    # Orchestration: timers, idle/lock/sleep, session save, IPC
    sessionClock.ts               # Pure session timing (active time, pauses)
    idlePolicy.ts                 # Pure idle pause/resume rules
    usageSampler.ts               # Foreground window → usage sample
    usageBatcher.ts               # Batched usage writes (one insert per minute)
  ipc/                          # IPC handlers (invoked by renderer via channels)
    sessionHandlers.ts            # Start/stop/edit/delete sessions
    usageHandlers.ts              # Usage logs and summaries
    tagHandlers.ts                # Tag CRUD and session tagging
    goalHandlers.ts               # Daily work goals
    scheduledSessionHandlers.ts   # Scheduled session management
    preferencesHandlers.ts        # Theme, accent colors, idle timeout
    projectHandlers.ts            # Project CRUD, members, archive/restore
    userHandlers.ts               # User profile and role management
    organizationHandlers.ts       # Organization management
    exportHandlers.ts             # CSV/JSON data export
  supabase/                     # Supabase API layer (data access)
    client.ts                     # Supabase client initialization
    env.ts                        # Supabase URL and anon key config
    api.ts                        # General API helpers
    timeTracking.ts               # Session queries
    usageLogs.ts                  # Usage log queries and daily summaries
    tags.ts                       # Tag queries
    goals.ts                      # Goal queries
    scheduledSessions.ts          # Scheduled session queries
    userPreferences.ts            # Preferences queries
    cloudProjects.ts              # Project queries (personal + org)
    organizations.ts              # Organization queries
    orgRequests.ts                # Org join request queries
  types/                        # TypeScript type definitions
    database.types.ts             # Auto-generated Supabase types
    organization.types.ts         # Organization-related types
  utils/                        # Shared utilities
    timeFormat.ts                 # Time formatting
    extractData.ts                # Data extraction and processing
    langMap.ts                    # Language mapping (file extension → language)
    editors.ts                    # Editor detection
    fileOps.ts                    # File operations (CSV/ZIP export helpers)

renderer/                     # Renderer process (frontend UI)
  renderer.ts                   # Main entry: auth flow, page registration, tracking UI, rail timer
  navigation.ts                 # Sidebar views, sub-views, and per-page dirty flags
  trackingControls.ts           # Mirror of main's tracking state + start/stop/pause requests
  theme.ts                      # Theme management and switching
  dashboardTab.ts               # Home: daily goal, earnings, calendar widget, quick stats, standup
  logsTab.ts                    # Home → App activity: time per app/language today
  summaryTab.ts                 # Sessions → List: charts, sessions, custom analytics
  calendarTab.ts                # Sessions → Calendar: scheduled sessions
  insightsTab.ts                # Sessions → Insights: editor/language breakdown, goal history
  projectsTab.ts                # Projects: personal and org projects (create, rates, archive, members)
  billingTab.ts                 # Billing: billable hours and earnings by month, invoices
  organizationTab.ts            # Team → Organization: members, roles, invites, join requests
  teamAnalyticsTab.ts           # Team → Analytics (admins/managers)
  settingsTab.ts                # Settings: preferences, integrations, shortcuts, account & team
  components.ts                 # Reusable UI components barrel
  components/                   # UI component modules
    LandingPage.ts                # Auth: sign-in, sign-up, onboarding
    ConnectionStatus.ts           # Online/offline/limited status indicator
    Charts.ts                     # Chart.js wrapper and chart creation
    Modals.ts                     # Modal dialogs
    DetailsModal.ts               # Session/usage detail modals
    SessionReviewPanel.ts         # Review and batch-delete short sessions
    CustomDropdown.ts             # Searchable dropdown component
    Pickers.ts                    # Color and date pickers
    Notifications.ts              # Toast notifications
    Onboarding.ts                 # First-run setup wizard
    OSInfo.ts                     # OS information display
  summary/                      # Summary tab sub-modules
    summaryByDateView.ts          # Group-by-date summary view
    summaryBySessionView.ts       # Group-by-session summary view
    summaryState.ts               # Summary tab state management
    utils/                        # Summary-specific utilities
  utils/                        # Frontend utility modules
    index.ts                      # Barrel export
    ipcHelpers.ts                 # safeIpcInvoke wrapper for error-resilient IPC
    dateUtils.ts                  # Date and time utilities
    domUtils.ts                   # DOM manipulation helpers
    chartHelpers.ts               # Chart configuration and helpers
    colorUtils.ts                 # Color manipulation
    dropdownUtils.ts              # Dropdown utilities
    userUtils.ts                  # User/auth utilities
    organizationApi.ts            # Organization API calls from renderer
    oauthHandler.ts               # GitHub OAuth flow
    passwordValidator.ts          # Password strength validation
    sessionExporter.ts            # Session data export
    performance.ts                # Performance monitoring
  styles/                       # Modular CSS (22 files)

shared/                       # Shared between main and renderer
  constants.ts                  # App-wide constants
  types/                        # Shared type definitions
    index.ts                      # Main shared types
    assets.d.ts                   # Asset type declarations

database/                     # Database migration files
  schema.sql                    # Complete database: tables, functions, triggers, RLS, indexes
  reset.sql                     # Wipes all app objects, data and users (start over)

assets/                       # Static assets
  known_editors.json            # Editor detection database
```

### 🎨 Styles

View the [CSS organization](./renderer/styles/styles.md) for details on how styles are structured and used.

---

## 🔧 Tech Stack

- **Desktop Framework:** Electron 28
- **Frontend:** TypeScript, HTML, CSS
- **Backend:** Node.js (Electron main process)
- **Database:** PostgreSQL via Supabase (100% cloud)
- **Authentication:** Supabase Auth (email/password + GitHub OAuth)
- **Authorization:** PostgreSQL Row Level Security (RLS)
- **Charts:** Chart.js
- **Build System:** Electron Forge + Webpack
- **Styling:** CSS Custom Properties (CSS Variables) for theming
- **Window Tracking:** [@miniben90/x-win](https://github.com/nicholasadamou/x-win) for active window detection

---

## 📝 TODO / Ideas

See [`TODO.txt`](./TODO.txt) for planned features and ideas.

---

## 🛡️ License

This project is licensed under the **Business Source License 1.1 (BUSL-1.1)**.

- ✅ You can view and contribute to the code.
- 🚫 You cannot use it in commercial products or production environments.
- 🕒 It will convert to Apache-2.0 on **January 1st, 2035**.

For full license details, see the [LICENSE](./LICENSE) file.

---

## 🤝 Contributing

Pull requests, bug reports, and feature suggestions are welcome!  
Please open an issue or discussion to get started.
Don't forget to read the [Contributor License Agreement](./CLA.md) before doing so.

---

## 🙏 Acknowledgements

- Built with [Electron](https://www.electronjs.org/) and [TypeScript](https://www.typescriptlang.org/)
- Charts powered by [Chart.js](https://www.chartjs.org/)
- Icons from various open-source icon sets

---
