// utils/langMap.ts (attaches handlers)
import { shell, app, ipcMain } from "electron";
import fs from "fs";
import path from "path";
import { getCurrentUser } from "../supabase/api";
import {
  getCustomAppsForUser,
  saveCustomAppsForUser,
  getCustomAppsFilePath,
  resetEditorCache,
  type KnownAppsData,
} from "./editors";

function getUserLangPath(userId: string) {
  return path.join(app.getPath("userData"), `lang-${userId}.json`);
}

function ensureLangJson(userId: string) {
  const userLangPath = getUserLangPath(userId);
  if (!fs.existsSync(userLangPath)) {
    fs.writeFileSync(userLangPath, "{}", "utf-8");
  }
}

function loadUserLangMap(userId: string) {
  ensureLangJson(userId);
  try {
    const raw = fs.readFileSync(getUserLangPath(userId), "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

ipcMain.handle("get-user-lang-map", async (_event, userId?: string) => {
  let uid = userId;
  if (!uid) {
    const user = await getCurrentUser();
    if (!user) return {};
    uid = user.id;
  }
  return loadUserLangMap(uid);
});

ipcMain.handle("open-lang-json", async (_event, userId?: string) => {
  let uid = userId;
  if (!uid) {
    const user = await getCurrentUser();
    if (!user) return;
    uid = user.id;
  }
  const userLangPath = getUserLangPath(uid);
  if (!fs.existsSync(userLangPath)) {
    fs.writeFileSync(userLangPath, "{}", "utf-8");
  }
  shell.openPath(userLangPath);
});

// ── Custom apps per-user JSON ──────────────────────────────────────────

ipcMain.handle("get-custom-apps", async (_event, userId?: string) => {
  let uid = userId;
  if (!uid) {
    const user = await getCurrentUser();
    if (!user) return { editors: [], devTools: [], browsers: [] };
    uid = user.id;
  }
  return getCustomAppsForUser(uid);
});

ipcMain.handle(
  "save-custom-apps",
  async (_event, data: KnownAppsData, userId?: string) => {
    let uid = userId;
    if (!uid) {
      const user = await getCurrentUser();
      if (!user) return false;
      uid = user.id;
    }
    saveCustomAppsForUser(uid, data);
    return true;
  },
);

ipcMain.handle("open-custom-apps-json", async (_event, userId?: string) => {
  let uid = userId;
  if (!uid) {
    const user = await getCurrentUser();
    if (!user) return;
    uid = user.id;
  }
  const filePath = getCustomAppsFilePath(uid);
  shell.openPath(filePath);
});
