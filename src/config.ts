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

export function loadEditorColors(): EditorColorConfig {
  ensureConfigDirExists();
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveEditorColors(config: EditorColorConfig) {
  ensureConfigDirExists();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}
