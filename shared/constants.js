"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SESSION_DESCRIPTION_LENGTH = exports.MAX_SESSION_TITLE_LENGTH = exports.MAX_USERNAME_LENGTH = exports.THEMES = exports.CONFIG_FILE = exports.CONFIG_DIR = exports.DEFAULT_ACCENT_COLORS = exports.CHART_COLORS = exports.DB_NAME = exports.DEFAULT_IDLE_TIMEOUT_SECONDS = exports.DEFAULT_TRACKING_INTERVAL_SECONDS = exports.APP_VERSION = exports.APP_NAME = void 0;
// Application constants
exports.APP_NAME = "dev-time-tracker";
exports.APP_VERSION = "1.0.0";
// Tracking configuration
exports.DEFAULT_TRACKING_INTERVAL_SECONDS = 10;
exports.DEFAULT_IDLE_TIMEOUT_SECONDS = 300; // 5 minutes
// Database
exports.DB_NAME = "usage.db";
// UI Constants
exports.CHART_COLORS = [
    "#ff6384",
    "#36a2eb",
    "#cc65fe",
    "#ffce56",
    "#4bc0c0",
    "#ff9f40",
    "#9966ff",
    "#ff6384",
    "#c9cbcf",
    "#4bc0c0",
];
exports.DEFAULT_ACCENT_COLORS = {
    light: "#007acc",
    dark: "#0078d4",
};
// File paths
exports.CONFIG_DIR = ".dev-time-tracker";
exports.CONFIG_FILE = "config.json";
// Themes
exports.THEMES = ["light", "dark"];
// User limits
exports.MAX_USERNAME_LENGTH = 50;
exports.MAX_SESSION_TITLE_LENGTH = 100;
exports.MAX_SESSION_DESCRIPTION_LENGTH = 500;
