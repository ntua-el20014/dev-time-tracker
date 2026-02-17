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

### Row Level Security (RLS)

Every table has RLS enabled. Key policies:

- **Own data:** Users can fully manage (CRUD) their own sessions, tags, goals, preferences, and personal projects.
- **Organization read:** Admins and managers can view sessions, usage logs, and goals for members in their organization.
- **Organization write:** Only admins can update organization settings and user roles. Admins and managers can create organization projects.
- **Project access:** Project managers can manage members. Organization members can view org projects.

See the complete policy definitions in [`database/schema.sql`](./database/schema.sql).

---

## 🛠️ Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v16+)
- [npm](https://www.npmjs.com/) or [Yarn](https://yarnpkg.com/)
- [Git](https://git-scm.com/)
- A [Supabase](https://supabase.com/) project (free tier works)

### 1. Clone & Install

```bash
git clone https://github.com/ntua-el20014/dev-time-tracker.git
cd dev-time-tracker
npm install
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com/)
2. Run the schema migration in the Supabase SQL Editor:
   - First: paste and run [`database/functions_and_triggers.sql`](./database/functions_and_triggers.sql)
   - Then: paste and run [`database/schema.sql`](./database/schema.sql)
3. Enable **Email/Password** authentication in Supabase → Authentication → Providers
4. _(Optional)_ Enable **GitHub OAuth** under the same providers section
5. Copy your project's **URL** and **anon key** from Supabase → Settings → API

### 3. Configure Environment

Set your Supabase credentials via environment variables or edit [`src/supabase/env.ts`](./src/supabase/env.ts):

```bash
# Environment variables (recommended)
set SUPABASE_URL=https://your-project.supabase.co
set SUPABASE_ANON_KEY=your-anon-key
```

### 4. Run the App

```bash
npm start
```

### 5. Build for Production

```bash
npm run make
```

### Other Commands

| Command              | Description                       |
| -------------------- | --------------------------------- |
| `npm run dev`        | Start in development mode         |
| `npm run type-check` | Run TypeScript type checking      |
| `npm run lint`       | Run ESLint                        |
| `npm run lint:fix`   | Auto-fix lint issues              |
| `npm run clean`      | Remove build artifacts            |
| `npm run build`      | Type-check + build for production |

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
