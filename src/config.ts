/* eslint-disable @typescript-eslint/no-explicit-any */
// src/main/config.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.dev-time-tracker');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export type EditorColorConfig = { [app: string]: string };

function ensureConfigDirExists() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): any {
  ensureConfigDirExists();
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch {
    //nothing to do here, just return empty object
  }
  return {};
}

export function saveConfig(cfg: any) {
  ensureConfigDirExists();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
}

export function loadEditorColors(userId?: number): EditorColorConfig {
  const cfg = loadConfig();
  if (userId !== undefined) {
    return (cfg.userSettings?.[userId]?.editorColors) || {};
  }
  return cfg.editorColors || {};
}

export function saveEditorColors(editorColors: EditorColorConfig, userId?: number) {
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

export function getAccentColor(theme: 'dark' | 'light' = 'dark', userId?: number): string {
  const cfg = loadConfig();
  if (userId !== undefined) {
    const userCfg = cfg.userSettings?.[userId] || {};
    if (theme === 'light') return userCfg.accentColorLight || '#007acc'; // Default light blue for light mode
    return userCfg.accentColorDark || '#f0db4f'; // Default yellow for dark mode
  }
  if (theme === 'light') return cfg.accentColorLight || '#007acc';
  return cfg.accentColorDark || '#f0db4f';
}

export function setAccentColor(color: string, theme: 'dark' | 'light' = 'dark', userId?: number) {
  const cfg = loadConfig();
  if (userId !== undefined) {
    cfg.userSettings = cfg.userSettings || {};
    cfg.userSettings[userId] = cfg.userSettings[userId] || {};
    if (theme === 'light') cfg.userSettings[userId].accentColorLight = color;
    else cfg.userSettings[userId].accentColorDark = color;
  } else {
    if (theme === 'light') cfg.accentColorLight = color;
    else cfg.accentColorDark = color;
  }
  saveConfig(cfg);
}

export function getUserTheme(userId: number): 'light' | 'dark' {
  const cfg = loadConfig();
  return (cfg.userSettings?.[userId]?.theme) || 'dark';
}

export function setUserTheme(theme: 'light' | 'dark', userId: number) {
  const cfg = loadConfig();
  cfg.userSettings = cfg.userSettings || {};
  cfg.userSettings[userId] = cfg.userSettings[userId] || {};
  cfg.userSettings[userId].theme = theme;
  saveConfig(cfg);
}
