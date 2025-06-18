# Dev Time Tracker

A privacy-focused, cross-platform time tracker built for developers.  
Tracks your coding sessions, editor and language usage, and helps you understand and improve your workflow—all while keeping your data local.

---

## 🚀 Features

- **Automatic Tracking:**  
  Monitors time spent in code editors (like VSCode) and logs active window data every 10 seconds.
- **Session Management:**  
  Start/pause/stop recording sessions, add titles and descriptions, edit or delete past sessions, add colored tags, set idle timeout. Great for tracking focused work periods.
- **User Profiles:**  
  Create multiple user profiles to track different coding activities separately.
- **Global Hotkeys:**  
  Control tracking (start, pause, stop) from anywhere and switch between tabs using keyboard shortcuts.
- **Detailed Summaries:**  
  View summaries by day or by session, with interactive tables and charts.
- **Timeline & Calendar:**  
  Visualize your coding activity with a weekly timeline and a monthly calendar.
- **Editor & Language Stats:**  
  See which editors and programming languages you use most through charts and statistics. Editor and language icons are shown where available.
- **Customizable Themes:**  
  Switch between dark and light mode, pick custom accent color for each one.
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
html/
  renderer.ts         # Main renderer process entry
  summaryTab.ts       # Summary tab logic (summary, sessions)
  logsTab.ts          # Logs tab logic (today's activity)
  profileTab.ts       # Profile tab logic (settings, hotkeys, editors, languages)
  dashboardTab.ts     # Dashboard tab logic (calendar, recent activity, charts)
  components.ts       # Reusable UI components (modal, color picker, etc.)
  utils.ts            # Utility functions for renderer
  styles/             # Modular CSS (see below)
src/
  index.ts            # Electron main process (IPC, window)
  logger.ts           # Database interaction (SQLite)
  config.ts           # User and theme configuration
  utils/              # Utility modules (editors, extractData, langMap, etc.)
populateDummyData.ts  # Script to populate the database with dummy data
```

### CSS Organization

| File                | Purpose                                                                 |
|---------------------|-------------------------------------------------------------------------|
| base.css            | Variables, body, global elements, notification, record/pause buttons    |
| layout.css          | Main container and layout, tab bar, tab content                         |
| table.css           | Table styles, summary tables, icons, edit buttons, filter buttons       |
| modal.css           | Modal overlay, modal content, modal form and actions                    |
| calendar.css        | Calendar widget and grid, calendar day labels and cells                 |
| timeline.css        | Timeline chart container and bars, day labels and hours                 |
| profile.css         | Profile tab sidebar/menu, tag color picker, logout button, color grid   |
| theme.css           | Theme toggle button, theme-specific overrides                           |
| dashboard.css       | Dashboard tab, bubbles, quick stats, calendar, charts                   |
| users.css           | User landing page, user selection, avatars                              |

---

## 📝 TODO / Ideas

See [`TODO.txt`](./TODO.txt) for planned features and ideas, including:
- Daily goals & notifications
- Session tags and export
- Idle detection
- Weekly/monthly reports
- More charts and themes
- Cloud sync and backup
- Keyboard shortcuts
- ...and more!

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

---