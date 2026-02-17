import { ipcMain } from "electron";
import * as usageLogs from "../supabase/usageLogs";
import { getCurrentUser } from "../supabase/api";
import type { DailySummaryFilters } from "@shared/types";
import { logError } from "../utils/errorHandler";

/**
 * Get usage logs/summary for a specific date
 */
ipcMain.handle("get-logs", async (_event, date?: string) => {
  try {
    // Get current authenticated user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    const dateStr = date || new Date().toISOString().split("T")[0];
    return await usageLogs.getUsageSummary(user.id, dateStr);
  } catch (err) {
    logError("get-logs", err);
    return [];
  }
});

/**
 * Get all days with logged usage for a specific month
 */
ipcMain.handle(
  "get-logged-days-of-month",
  async (_event, year: number, month: number) => {
    try {
      // Get current authenticated user
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      return await usageLogs.getLoggedDaysOfMonth(user.id, year, month);
    } catch (err) {
      logError("get-logged-days-of-month", err);
      return [];
    }
  },
);

/**
 * Get editor usage statistics
 */
ipcMain.handle("get-editor-usage", async (_event) => {
  try {
    // Get current authenticated user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    return await usageLogs.getEditorUsage(user.id);
  } catch (err) {
    logError("get-editor-usage", err);
    return [];
  }
});

/**
 * Get daily summary with optional filters
 */
ipcMain.handle(
  "get-daily-summary",
  async (_event, filters?: DailySummaryFilters) => {
    try {
      // Get current authenticated user
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      // Convert filters to Supabase format
      const supabaseFilters: any = {};
      if (filters) {
        if (filters.startDate) supabaseFilters.startDate = filters.startDate;
        if (filters.endDate) supabaseFilters.endDate = filters.endDate;
        if (filters.app) supabaseFilters.app = filters.app;
        if (filters.language) supabaseFilters.language = filters.language;
      }

      return await usageLogs.getDailySummary(user.id, supabaseFilters);
    } catch (err) {
      logError("get-daily-summary", err);
      return [];
    }
  },
);

/**
 * Get language usage statistics
 */
ipcMain.handle("get-language-usage", async (_event) => {
  try {
    // Get current authenticated user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    return await usageLogs.getLanguageUsage(user.id);
  } catch (err) {
    logError("get-language-usage", err);
    return [];
  }
});

/**
 * Get language summary by date range
 */
ipcMain.handle(
  "get-language-summary-by-date-range",
  async (_event, startDate: string, endDate: string) => {
    try {
      // Get current authenticated user
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      return await usageLogs.getLanguageSummaryByDateRange(
        user.id,
        startDate,
        endDate,
      );
    } catch (err) {
      logError("get-language-summary-by-date-range", err);
      return [];
    }
  },
);

/**
 * Get detailed usage data for a specific app on a specific date
 */
ipcMain.handle(
  "get-usage-details-for-app-date",
  async (_event, app: string, date: string) => {
    try {
      // Get current authenticated user
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      return await usageLogs.getUsageDetailsForAppDate(user.id, app, date);
    } catch (err) {
      logError("get-usage-details-for-app-date", err);
      return [];
    }
  },
);

/**
 * Get detailed usage data for a specific session
 */
ipcMain.handle(
  "get-usage-details-for-session",
  async (_event, sessionId: number | string) => {
    try {
      // Get current authenticated user
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      const sessionIdStr = String(sessionId);
      return await usageLogs.getUsageDetailsForSession(user.id, sessionIdStr);
    } catch (err) {
      logError("get-usage-details-for-session", err);
      return null;
    }
  },
);

/**
 * Get user's distinct editors/apps
 */
ipcMain.handle("get-user-editors", async (_event) => {
  try {
    // Get current authenticated user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    return await usageLogs.getUserEditors(user.id);
  } catch (err) {
    logError("get-user-editors", err);
    return [];
  }
});

/**
 * Get user's distinct language extensions
 */
ipcMain.handle("get-user-lang-exts", async (_event) => {
  try {
    // Get current authenticated user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    return await usageLogs.getUserLangExts(user.id);
  } catch (err) {
    logError("get-user-lang-exts", err);
    return [];
  }
});
