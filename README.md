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
- **Global Hotkeys:**  
  Control tracking (start, pause, stop) from anywhere and switch between tabs using keyboard shortcuts.
- **Customizable Themes:**  
  Switch between dark and light mode, pick custom accent colors for each theme. Settings sync across devices.
- **Data Export:**  
  Export sessions to CSV or JSON for external analysis.

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
│  │  Tabs:           │                 │   ├─ session       │ │
│  │   Dashboard      │                 │   ├─ usage         │ │
│  │   Summary        │                 │   ├─ tag           │ │
│  │   Calendar       │                 │   ├─ goal          │ │
│  │   Logs           │                 │   ├─ project       │ │
│  │   Projects       │                 │   ├─ scheduled     │ │
│  │   Organization   │                 │   ├─ preferences   │ │
│  │   Profile        │                 │   ├─ user          │ │
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
                                       │  14 tables       │
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

All data lives in Supabase (PostgreSQL). The schema is defined in [`database/schema.sql`](./database/schema.sql) with triggers and functions in [`database/functions_and_triggers.sql`](./database/functions_and_triggers.sql).

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

Server-side logic defined in [`database/functions_and_triggers.sql`](./database/functions_and_triggers.sql):

| Function                                           | Purpose                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| `handle_new_user()`                                | Auto-creates user profile, personal org, and default preferences on signup |
| `trigger_set_timestamp()`                          | Auto-updates `updated_at` on all tables                                    |
| `calculate_session_duration()`                     | Auto-calculates duration from start/end times                              |
| `set_session_org_id()`                             | Auto-populates `org_id` from user profile on session insert                |
| `set_usage_log_org_id()`                           | Auto-populates `org_id` from user profile on usage log insert              |
| `update_daily_usage_summary()`                     | Upserts aggregated usage data for daily summaries                          |
| `get_current_user_org_id()`                        | SECURITY DEFINER helper to get user's org (bypasses RLS)                   |
| `get_current_user_role()`                          | SECURITY DEFINER helper to get user's role (bypasses RLS)                  |
| `is_user_admin()` / `is_user_admin_or_manager()`   | Role check helpers                                                         |
| `same_org(target_user_id)`                         | Check if two users share the same organization                             |
| `create_project()`                                 | Create project with proper scope/permission checks                         |
| `archive_project()` / `restore_project()`          | Soft-delete and restore projects                                           |
| `approve_join_request()` / `reject_join_request()` | Process org membership requests                                            |
| `create_team_organization()`                       | Create a new team org (admin/manager only)                                 |
| `get_project_stats()`                              | Aggregate project statistics (sessions, time, members)                     |
| `get_user_total_time()` / `get_org_total_time()`   | Total time queries for date ranges                                         |
| `get_upcoming_session_notifications()`             | Upcoming scheduled session alerts                                          |

---

## 🛠️ Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+ recommended)
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
2. In the Supabase **SQL Editor**, run the migration files **in order**:
   - **First:** paste and run [`database/functions_and_triggers.sql`](./database/functions_and_triggers.sql) — creates helper functions, triggers, and RPC procedures
   - **Then:** paste and run [`database/schema.sql`](./database/schema.sql) — creates all 14 tables, RLS policies, indexes, and timestamp triggers
3. Go to **Authentication → Providers** and enable:
   - **Email/Password** (required)
   - **GitHub OAuth** (optional — requires a GitHub OAuth App with callback URL `https://<your-project>.supabase.co/auth/v1/callback`)
4. Go to **Authentication → URL Configuration** and add `dev-time-tracker://callback` to the **Redirect URLs** list (needed for OAuth and password reset flows in Electron)
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

### Troubleshooting

- **Native module errors:** Run `npm run rebuild` to rebuild native dependencies for your Electron version.
- **Auth not working:** Check that your Supabase URL and anon key are correct. Verify email/password provider is enabled in Supabase.
- **RLS errors (permission denied):** Ensure both SQL migration files were run in the correct order (functions first, then schema).
- **OAuth redirect issues:** Add `dev-time-tracker://callback` to your Supabase project's redirect URLs.

---

## 🗂️ Project Structure

```
src/                          # Main process (Electron backend)
  index.ts                      # App entry: window creation, tracking loop, IPC registration
  preload.ts                    # Preload script for secure IPC bridge
  config.ts                     # App configuration
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
    ipcHelp.ts                    # IPC helper functions

renderer/                     # Renderer process (frontend UI)
  renderer.ts                   # Main entry: auth flow, tab initialization, tracking UI
  theme.ts                      # Theme management and switching
  dashboardTab.ts               # Dashboard: calendar, recent activity, quick stats
  summaryTab.ts                 # Summary: charts, sessions, custom analytics
  calendarTab.ts                # Calendar: monthly activity heatmap
  logsTab.ts                    # Logs: today's activity, daily goals
  projectsTab.ts                # Projects: personal and org project management
  organizationTab.ts            # Organization: members, roles, join requests
  profileTab.ts                 # Profile: settings, hotkeys, editor colors, about
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
    AdminPanel.ts                 # Admin data export
    UserRoleManager.ts            # Role management UI
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
  schema.sql                    # Complete schema: tables, RLS, indexes, triggers
  functions_and_triggers.sql    # Functions and trigger definitions

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
