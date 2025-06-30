// Application constants
export const APP_NAME = "dev-time-tracker";
export const APP_VERSION = "1.0.0";

// Tracking configuration
export const DEFAULT_TRACKING_INTERVAL_SECONDS = 10;
export const DEFAULT_IDLE_TIMEOUT_SECONDS = 300; // 5 minutes

// Database
export const DB_NAME = "usage.db";

// UI Constants
export const CHART_COLORS = [
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

export const DEFAULT_ACCENT_COLORS = {
  light: "#007acc",
  dark: "#0078d4",
};

// File paths
export const CONFIG_DIR = ".dev-time-tracker";
export const CONFIG_FILE = "config.json";

// Themes
export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

// User limits
export const MAX_USERNAME_LENGTH = 50;
export const MAX_SESSION_TITLE_LENGTH = 100;
export const MAX_SESSION_DESCRIPTION_LENGTH = 500;
