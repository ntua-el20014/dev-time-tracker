// utils/langMap.ts (attaches handlers)
import { shell, app, ipcMain } from "electron";
import fs from "fs";
import path from "path";
import { getCurrentUser } from "../supabase/api";

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

ipcMain.handle("get-user-lang-map", async (_event) => {
  const user = await getCurrentUser();
  if (!user) return {};
  return loadUserLangMap(user.id);
});

ipcMain.handle("open-lang-json", async (_event) => {
  const user = await getCurrentUser();
  if (!user) return;
  const userLangPath = getUserLangPath(user.id);
  if (!fs.existsSync(userLangPath)) {
    fs.writeFileSync(userLangPath, "{}", "utf-8");
  }
  shell.openPath(userLangPath);
});
