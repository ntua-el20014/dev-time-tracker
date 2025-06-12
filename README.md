# Dev Time Tracker

A privacy-focused, cross-platform time tracker built for developers.  
Tracks your coding sessions, editor and language usage, and helps you understand and improve your workflow—all while keeping your data local.

---

## 🚀 Features

- **Automatic Tracking:**  
  Monitors time spent in code editors (like VSCode) and logs active window data every 10 seconds.
- **Session Management:**  
  Start/pause/stop recording sessions, add titles and descriptions, edit or delete past sessions, add tags, set idle timeout. Great for tracking focused work periods.
- **Detailed Summaries:**  
  View summaries by day or by session, with interactive tables and charts.
- **Timeline & Calendar:**  
  Visualize your coding activity with a weekly timeline and a monthly calendar.
- **Editor & Language Stats:**  
  See which editors and programming languages you use most.
- **Customizable Themes:**  
  Switch between dark and light mode, pick custom accent color for each one.
- **Local-First:**  
  All data is stored locally—your privacy is respected.

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
  summaryTab.ts       # Summary tab logic
  logsTab.ts          # Logs tab logic
  profileTab.ts       # Profile tab logic
  components.ts       # Reusable UI components (modal, OS info, etc.)
  utils.ts            # Utility functions
  styles/             # Modular CSS (see below)
src/
  index.ts            # Electron main process
  logger.ts           # Database and tracking logic
  ...
```

### CSS Organization

| File                | Purpose                                 |
|---------------------|-----------------------------------------|
| base.css            | Variables, body, global elements        |
| layout.css          | Layout, container, tabs                 |
| table.css           | Tables, summary, filters                |
| modal.css           | Modal dialogs                           |
| calendar.css        | Calendar widget                         |
| timeline.css        | Timeline chart                          |
| profile.css         | Profile tab sidebar/menu                |
| theme.css           | Theme toggle and overrides              |

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

---

## 🙏 Acknowledgements

- Built with [Electron](https://www.electronjs.org/) and [TypeScript](https://www.typescriptlang.org/)

---