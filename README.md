# Dev Time Tracker

A privacy-focused, cross-platform time tracker built for developers.  
Tracks your coding sessions, editor and language usage, and helps you understand and improve your workflow—all while keeping your data local.

---

## 🚀 Features

### **Core Tracking**
- **Automatic Tracking:**  
  Monitors time spent in code editors (like VSCode) and logs active window data every 10 seconds.
- **Session Management:**  
  Start/pause/stop recording sessions, add titles and descriptions, edit or delete past sessions, add colored tags, set idle timeout. Great for tracking focused work periods.
- **User Profiles:**  
  Create multiple user profiles to track different coding activities separately.

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

### **User Experience**
- **Global Hotkeys:**  
  Control tracking (start, pause, stop) from anywhere and switch between tabs using keyboard shortcuts.
- **Customizable Themes:**  
  Switch between dark and light mode, pick custom accent colors for each theme.
- **Admin Panel:**  
  Export/import database, backup and restore functionality.

### **Privacy & Data**
- **Local-First:**  
  All data is stored locally—your privacy is respected.
- **Database Population Script:**  
  Easily populate your database with realistic dummy data for testing and development.

---

## 📸 Screenshots

<!-- Add screenshots here if available -->

---

## 🛠️ Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v16+ recommended)
- [Yarn](https://yarnpkg.com/) or [npm](https://www.npmjs.com/)
- [Git](https://git-scm.com/)

### Installation

```bash
git clone https://github.com/yourusername/dev-time-tracker.git
cd dev-time-tracker
yarn install
# or
npm install
```

### Running the App

```bash
yarn start
# or
npm start
```

### Populating the Database with Dummy Data

```bash
npm run populate
```
This will fill your database with sample users, sessions, tags (with colors), and usage data.

### Building for Production

```bash
yarn make
# or
npm run make
```

---

## 🗂️ Project Structure

```
renderer/
  renderer.ts         # Main renderer process entry
  summaryTab.ts       # Summary tab logic (summary, sessions, custom charts)
  logsTab.ts          # Logs tab logic (today's activity, daily goals)
  profileTab.ts       # Profile tab logic (settings, hotkeys, editors, languages, admin)
  dashboardTab.ts     # Dashboard tab logic (calendar, recent activity, quick stats)
  components.ts       # Reusable UI components (modal, charts, color picker, etc.)
  utils.ts            # Utility functions for renderer
  admin.ts            # Admin panel functionality (export/import/backup)
  theme.ts            # Theme management and switching
  userLanding.ts      # User selection and management
  styles/             # Modular CSS files
    base.css            # Base styling and variables
    charts.css          # Chart and visualization styling
    dashboard.css       # Dashboard-specific styles
    goals.css           # Daily goals styling
    layout.css          # Main layout and navigation
    modal.css           # Modal and popup styling
    profile.css         # Profile tab styling
    table.css           # Data table styling
    theme.css           # Theme switching components
    timeline.css        # Timeline chart styling
    users.css           # User management styling
    calendar.css        # Calendar widget styling
src/
  backend/
    db.ts               # Database connection and table creation
    usage.ts            # Usage logging and summary queries
    sessions.ts         # Session and tag management
    types.ts            # Shared TypeScript types/interfaces
    users.ts            # User management
  ipc/
    usageHandlers.ts      # IPC handlers for usage/statistics
    sessionHandlers.ts    # IPC handlers for sessions and tags
    userHandlers.ts       # IPC handlers for user management
    adminHandlers.ts      # IPC handlers for admin functions
  index.ts            # Electron main process (window, app events, misc IPC)
  config.ts           # User and theme configuration
  utils/              # Utility modules (editors, extractData, langMap, etc.)
    timeFormat.ts       # Time formatting utilities
    extractData.ts      # Data extraction and processing
populateDummyData.ts  # Script to populate the database with dummy data
```

### 🎨 Styles

View the [CSS organization](./renderer/styles/styles.md) for details on how styles are structured and used.

---

## 🔧 Tech Stack

- **Frontend:** HTML, TypeScript, CSS
- **Backend:** Node.js, SQLite3
- **Desktop Framework:** Electron
- **Charts:** Chart.js
- **Build System:** Electron Forge with Webpack
- **Database:** SQLite (local storage)
- **Styling:** CSS Custom Properties (CSS Variables) for theming

---

## 📝 TODO / Ideas

See [`TODO.txt`](./TODO.txt) for planned features and ideas, including

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