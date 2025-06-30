/* eslint-disable @typescript-eslint/no-explicit-any */
// src/config.ts
import fs from "fs";
import path from "path";
import os from "os";
import {
  CONFIG_DIR,
  CONFIG_FILE,
  DEFAULT_ACCENT_COLORS,
} from "@shared/constants";

const configDir = path.join(os.homedir(), CONFIG_DIR);
const configPath = path.join(configDir, CONFIG_FILE);

export type EditorColorConfig = { [app: string]: string };

function ensureConfigDirExists() {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

export function loadConfig(): any {
  ensureConfigDirExists();
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
  } catch {
    //nothing to do here, just return empty object
  }
  return {};
}

export function saveConfig(cfg: any) {
  ensureConfigDirExists();
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), "utf-8");
}

export function loadEditorColors(userId?: number): EditorColorConfig {
  const cfg = loadConfig();
  if (userId !== undefined) {
    return cfg.userSettings?.[userId]?.editorColors || {};
  }
  return cfg.editorColors || {};
}

export function saveEditorColors(
  editorColors: EditorColorConfig,
  userId?: number
) {
  const cfg = loadConfig();
  if (userId !== undefined) {
    cfg.userSettings = cfg.userSettings || {};
    cfg.userSettings[userId] = cfg.userSettings[userId] || {};
    cfg.userSettings[userId].editorColors = editorColors;
  } else {
    cfg.editorColors = editorColors;
  }
  saveConfig(cfg);
}

export function getAccentColor(
  theme: "dark" | "light" = "dark",
  userId?: number
): string {
  const cfg = loadConfig();
  if (userId !== undefined) {
    const userCfg = cfg.userSettings?.[userId] || {};
    if (theme === "light")
      return userCfg.accentColorLight || DEFAULT_ACCENT_COLORS.light;
    return userCfg.accentColorDark || DEFAULT_ACCENT_COLORS.dark;
  }
  if (theme === "light")
    return cfg.accentColorLight || DEFAULT_ACCENT_COLORS.light;
  return cfg.accentColorDark || DEFAULT_ACCENT_COLORS.dark;
}

export function setAccentColor(
  color: string,
  theme: "dark" | "light" = "dark",
  userId?: number
) {
  const cfg = loadConfig();
  if (userId !== undefined) {
    cfg.userSettings = cfg.userSettings || {};
    cfg.userSettings[userId] = cfg.userSettings[userId] || {};
    if (theme === "light") cfg.userSettings[userId].accentColorLight = color;
    else cfg.userSettings[userId].accentColorDark = color;
  } else {
    if (theme === "light") cfg.accentColorLight = color;
    else cfg.accentColorDark = color;
  }
  saveConfig(cfg);
}

export function getUserTheme(userId: number): "light" | "dark" {
  const cfg = loadConfig();
  return cfg.userSettings?.[userId]?.theme || "dark";
}

export function setUserTheme(theme: "light" | "dark", userId: number) {
  const cfg = loadConfig();
  cfg.userSettings = cfg.userSettings || {};
  cfg.userSettings[userId] = cfg.userSettings[userId] || {};
  cfg.userSettings[userId].theme = theme;
  saveConfig(cfg);
}
