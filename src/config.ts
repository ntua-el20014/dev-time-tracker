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

export function loadEditorColors(): EditorColorConfig {
  const cfg = loadConfig();
  return cfg.editorColors || {};
}

export function saveEditorColors(editorColors: EditorColorConfig) {
  const cfg = loadConfig();
  cfg.editorColors = editorColors;
  saveConfig(cfg);
}
