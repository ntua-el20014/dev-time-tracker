import { ipcMain } from "electron";
import * as goals from "../supabase/goals";
import { getCurrentUser } from "../supabase/api";
import { logError } from "../utils/errorHandler";

/**
 * Set or update a daily goal
 */
ipcMain.handle(
  "set-daily-goal",
  async (_event, date: string, time: number, description: string) => {
    try {
      // Get current authenticated user
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      await goals.setDailyGoal(user.id, date, time, description);
      return true;
    } catch (err) {
      logError("set-daily-goal", err);
      return false;
    }
  },
);

/**
 * Get daily goal for a specific date
 */
ipcMain.handle("get-daily-goal", async (_event, date: string) => {
  try {
    // Get current authenticated user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    return await goals.getDailyGoal(user.id, date);
  } catch (err) {
    logError("get-daily-goal", err);
    return null;
  }
});

/**
 * Delete a daily goal
 */
ipcMain.handle("delete-daily-goal", async (_event, date: string) => {
  try {
    // Get current authenticated user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    await goals.deleteDailyGoal(user.id, date);
    return true;
  } catch (err) {
    logError("delete-daily-goal", err);
    return false;
  }
});

/**
 * Get total time for a specific day (in minutes)
 */
ipcMain.handle("get-total-time-for-day", async (_event, date: string) => {
  try {
    // Get current authenticated user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    return await goals.getTotalTimeForDay(user.id, date);
  } catch (err) {
    logError("get-total-time-for-day", err);
    return 0;
  }
});

/**
 * Mark a daily goal as completed
 */
ipcMain.handle("complete-daily-goal", async (_event, date: string) => {
  try {
    // Get current authenticated user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    await goals.completeDailyGoal(user.id, date);
    return true;
  } catch (err) {
    logError("complete-daily-goal", err);
    return false;
  }
});

/**
 * Get all daily goals for the user
 */
ipcMain.handle("get-all-daily-goals", async (_event) => {
  try {
    // Get current authenticated user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    return await goals.getAllDailyGoals(user.id);
  } catch (err) {
    logError("get-all-daily-goals", err);
    return [];
  }
});
