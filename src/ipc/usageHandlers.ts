import { ipcMain } from "electron";
import * as usage from "../backend/usage";
import type { DailySummaryFilters } from "@shared/types";

ipcMain.handle("get-logs", async (_event, userId: number, date?: string) => {
  try {
    return usage.getSummary(userId, date);
  } catch (err) {
    console.error("[Get Logs Error]", err);
    return [];
  }
});

ipcMain.handle(
  "get-logged-days-of-month",
  async (_event, userId: number, year: number, month: number) => {
    try {
      return usage.getLoggedDaysOfMonth(userId, year, month);
    } catch (err) {
      console.error("[Get Logged Days Of Month Error]", err);
      return [];
    }
  }
);

ipcMain.handle("get-editor-usage", async (_event, userId: number) => {
  try {
    return usage.getEditorUsage(userId);
  } catch (err) {
    console.error("[Get Editor Usage Error]", err);
    return [];
  }
});

ipcMain.handle(
  "get-daily-summary",
  async (_event, userId: number, filters?: DailySummaryFilters) => {
    try {
      return usage.getDailySummary(userId, filters);
    } catch (err) {
      console.error("[Get Daily Summary Error]", err);
      return [];
    }
  }
);

ipcMain.handle("get-language-usage", async (_event, userId: number) => {
  try {
    return usage.getLanguageUsage(userId);
  } catch (err) {
    console.error("[Get Language Usage Error]", err);
    return [];
  }
});

ipcMain.handle(
  "get-language-summary-by-date-range",
  async (_event, userId: number, startDate: string, endDate: string) => {
    return usage.getLanguageSummaryByDateRange(userId, startDate, endDate);
  }
);

// --- Daily Goals ---
ipcMain.handle(
  "set-daily-goal",
  (_event, userId: number, date: string, time: number, description: string) => {
    usage.setDailyGoal(userId, date, time, description);
    return true;
  }
);

ipcMain.handle("get-daily-goal", (_event, userId: number, date: string) => {
  return usage.getDailyGoal(userId, date);
});

ipcMain.handle("delete-daily-goal", (_event, userId: number, date: string) => {
  usage.deleteDailyGoal(userId, date);
  return true;
});

ipcMain.handle(
  "get-total-time-for-day",
  (_event, userId: number, date: string) => {
    return usage.getTotalTimeForDay(userId, date);
  }
);

ipcMain.handle(
  "complete-daily-goal",
  (_event, userId: number, date: string) => {
    usage.completeDailyGoal(userId, date);
    return true;
  }
);

ipcMain.handle("get-all-daily-goals", (_event, userId: number) => {
  return usage.getAllDailyGoals(userId);
});

ipcMain.handle("get-user-editors", async (_event, userId) => {
  return usage.getUserEditors(userId);
});
ipcMain.handle("get-user-lang-exts", async (_event, userId) => {
  return usage.getUserLangExts(userId);
});
