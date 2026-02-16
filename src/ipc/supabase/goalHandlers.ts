import { ipcMain } from "electron";
import * as goals from "../../supabase/goals";
import { getCurrentUser } from "../../supabase/api";

/**
 * Set or update a daily goal
 */
ipcMain.handle(
  "set-daily-goal",
  async (
    _event,
    _userId: number,
    date: string,
    time: number,
    description: string,
  ) => {
    try {
      // Get current authenticated user
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      await goals.setDailyGoal(user.id, date, time, description);
      return true;
    } catch (err) {
      // Error setting daily goal
      return false;
    }
  },
);

/**
 * Get daily goal for a specific date
 */
ipcMain.handle(
  "get-daily-goal",
  async (_event, _userId: number, date: string) => {
    try {
      // Get current authenticated user
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      return await goals.getDailyGoal(user.id, date);
    } catch (err) {
      // Error getting daily goal
      return null;
    }
  },
);

/**
 * Delete a daily goal
 */
ipcMain.handle(
  "delete-daily-goal",
  async (_event, _userId: number, date: string) => {
    try {
      // Get current authenticated user
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      await goals.deleteDailyGoal(user.id, date);
      return true;
    } catch (err) {
      // Error deleting daily goal
      return false;
    }
  },
);

/**
 * Get total time for a specific day (in minutes)
 */
ipcMain.handle(
  "get-total-time-for-day",
  async (_event, _userId: number, date: string) => {
    try {
      // Get current authenticated user
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      return await goals.getTotalTimeForDay(user.id, date);
    } catch (err) {
      // Error getting total time
      return 0;
    }
  },
);

/**
 * Mark a daily goal as completed
 */
ipcMain.handle(
  "complete-daily-goal",
  async (_event, _userId: number, date: string) => {
    try {
      // Get current authenticated user
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      await goals.completeDailyGoal(user.id, date);
      return true;
    } catch (err) {
      // Error completing daily goal
      return false;
    }
  },
);

/**
 * Get all daily goals for the user
 */
ipcMain.handle("get-all-daily-goals", async (_event, _userId: number) => {
  try {
    // Get current authenticated user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    return await goals.getAllDailyGoals(user.id);
  } catch (err) {
    // Error getting all daily goals
    return [];
  }
});
