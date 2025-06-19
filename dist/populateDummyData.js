"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable @typescript-eslint/no-explicit-any */
var Database = require("better-sqlite3");
var fs = require("fs");
var path = require("path");
var DB_PATH = path.resolve('C:\\Users\\Nikos\\AppData\\Roaming\\dev-time-tracker', 'usage.db');
var db = new Database(DB_PATH);
// --- Utility functions ---
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randomChoice(arr) {
    return arr[randomInt(0, arr.length - 1)];
}
function pad(n) {
    return n < 10 ? '0' + n : n;
}
function toDateString(date) {
    return "".concat(date.getFullYear(), "-").concat(pad(date.getMonth() + 1), "-").concat(pad(date.getDate()));
}
// --- Dummy data ---
var editors = [
    { app: 'VS Code', icon: svgToDataUri('icons/vscode.svg') },
    { app: 'WebStorm', icon: svgToDataUri('icons/webstorm.svg') },
    { app: 'PyCharm', icon: svgToDataUri('icons/pycharm.svg') },
    { app: 'Sublime Text', icon: svgToDataUri('icons/sublime.svg') },
    { app: 'Vim', icon: svgToDataUri('icons/vim.svg') },
];
var languages = [
    { language: 'TypeScript', lang_ext: '.ts' },
    { language: 'JavaScript', lang_ext: '.js' },
    { language: 'Python', lang_ext: '.py' },
    { language: 'HTML', lang_ext: '.html' },
    { language: 'SQL', lang_ext: '.sql' },
    { language: 'Markdown', lang_ext: '.md' },
];
var sessionTitles = [
    'Refactor login flow', 'Fix bug #123', 'Write documentation', 'Implement feature X',
    'Database migration', 'Code review', 'Optimize queries', 'UI improvements'
];
var tags = ['work', 'personal', 'urgent', 'review', 'frontend', 'backend', 'docs'];
var tagColors = [
    '#f0db4f', '#ff6961', '#7ed957', '#4f8cff', '#ffb347',
    '#b19cd9', '#f67280', '#355c7d', '#ffb6b9', '#c1c8e4',
    '#ffe156', '#6a0572', '#ff6f3c', '#00b8a9', '#f6416c',
    '#43dde6', '#e7e6e1', '#f9f871', '#a28089', '#f7b32b',
    '#2d4059', '#ea5455', '#ffd460', '#40514e', '#11999e'
];
// --- Main population logic ---
function populateDummyUsers() {
    db.prepare("INSERT OR IGNORE INTO users (id, username, avatar) VALUES (1, 'Default', ''), (2, 'Bob', '')").run();
}
function populateUsageAndSummary(userId, days) {
    if (days === void 0) { days = 30; }
    for (var i = 0; i < days; ++i) {
        var date = new Date();
        date.setDate(date.getDate() - i);
        var dateStr = toDateString(date);
        // Each day, random number of editor/language combos
        var combos = randomInt(2, 4);
        for (var j = 0; j < combos; ++j) {
            var editor = randomChoice(editors);
            var lang = randomChoice(languages);
            var timeSpent = randomInt(600, 7200); // 10 min to 2 hours
            // Insert into usage_summary
            db.prepare("\n        INSERT INTO usage_summary (app, language, lang_ext, date, icon, time_spent, user_id)\n        VALUES (?, ?, ?, ?, ?, ?, ?)\n        ON CONFLICT(app, language, date, user_id)\n        DO UPDATE SET \n          time_spent = time_spent + excluded.time_spent,\n          icon = CASE WHEN usage_summary.icon IS NULL OR usage_summary.icon = '' THEN excluded.icon ELSE usage_summary.icon END,\n          lang_ext = CASE WHEN excluded.lang_ext IS NOT NULL THEN excluded.lang_ext ELSE usage_summary.lang_ext END\n      ").run(editor.app, lang.language, lang.lang_ext, dateStr, editor.icon, timeSpent, userId);
        }
    }
}
function populateSessions(userId, days) {
    if (days === void 0) { days = 30; }
    for (var i = 0; i < days; ++i) {
        var date = new Date();
        date.setDate(date.getDate() - i);
        var sessionCount = randomInt(1, 3);
        for (var j = 0; j < sessionCount; ++j) {
            var start = new Date(date);
            start.setHours(randomInt(8, 20), randomInt(0, 59), 0, 0);
            var duration = randomInt(600, 5400); // 10 min to 1.5h
            var title = randomChoice(sessionTitles);
            var description = Math.random() > 0.5 ? 'Some notes about this session.' : null;
            db.prepare("\n        INSERT INTO sessions (timestamp, start_time, duration, title, description, user_id)\n        VALUES (?, ?, ?, ?, ?, ?)\n      ").run(start.toISOString(), start.toISOString(), duration, title, description, userId);
        }
    }
}
function populateTags(userId) {
    tags.forEach(function (tag, i) {
        var color = tagColors[i % tagColors.length];
        db.prepare("INSERT OR IGNORE INTO tags (name, user_id, color) VALUES (?, ?, ?)").run(tag, userId, color);
    });
}
function assignTagsToSessions(userId) {
    var sessionRows = db.prepare("SELECT id FROM sessions WHERE user_id = ?").all(userId);
    var tagRows = db.prepare("SELECT id FROM tags WHERE user_id = ?").all(userId);
    sessionRows.forEach(function (session) {
        // Assign 1-3 random tags to each session
        var tagCount = randomInt(1, 3);
        var shuffled = tagRows.slice().sort(function () { return Math.random() - 0.5; });
        for (var i = 0; i < tagCount; ++i) {
            db.prepare("INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES (?, ?)")
                .run(session.id, shuffled[i].id);
        }
    });
}
function svgToDataUri(svgPath) {
    var absPath = path.resolve(__dirname, '..', 'public', svgPath);
    var svg = fs.readFileSync(absPath, 'utf8');
    var base64 = Buffer.from(svg, 'utf8').toString('base64');
    return "data:image/svg+xml;base64,".concat(base64);
}
function populateDailyGoals(userId, days) {
    if (days === void 0) { days = 10; }
    for (var i = 0; i < days; ++i) {
        var date = new Date();
        date.setDate(date.getDate() - i);
        var dateStr = toDateString(date);
        var time = randomInt(30, 180); // 30 to 180 minutes
        var description = randomChoice([
            'Focus on bug fixes',
            'UI improvements',
            'Write tests',
            'Documentation',
            'Refactor modules',
            'Experiment with new tech',
            'Pair programming',
            'Code review',
            'Optimize performance',
            'General coding'
        ]);
        var isCompleted = Math.random() > 0.3 ? 1 : 0; // Most goals completed
        db.prepare("\n      INSERT OR IGNORE INTO daily_goals (user_id, date, time, description, isCompleted)\n      VALUES (?, ?, ?, ?, ?)\n    ").run(userId, dateStr, time, description, isCompleted);
    }
}
// --- Run population ---
console.log('Populating dummy data...');
populateDummyUsers();
[1, 2].forEach(function (userId) {
    populateUsageAndSummary(userId, 30);
    populateSessions(userId, 30);
    populateTags(userId);
    assignTagsToSessions(userId);
    populateDailyGoals(userId, 10); // <-- Add this line
});
console.log('Done!');
// Exit the process
process.exit(0);
// To run: npx ts-node src/populateDummyData.ts
