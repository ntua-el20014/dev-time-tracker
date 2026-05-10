import { ipcMain } from "electron";
import {
  checkForUpdatesManually,
  downloadUpdateManually,
  getUpdaterState,
  installDownloadedUpdate,
} from "../updater";
import { logError } from "../utils/errorHandler";

ipcMain.handle("updater:get-state", () => {
  return getUpdaterState();
});

ipcMain.handle("updater:check", async () => {
  try {
    return await checkForUpdatesManually();
  } catch (err) {
    logError("updater:check", err);
    return getUpdaterState();
  }
});

ipcMain.handle("updater:download", async () => {
  try {
    return await downloadUpdateManually();
  } catch (err) {
    logError("updater:download", err);
    return getUpdaterState();
  }
});

ipcMain.handle("updater:install", () => {
  try {
    return installDownloadedUpdate();
  } catch (err) {
    logError("updater:install", err);
    return getUpdaterState();
  }
});
