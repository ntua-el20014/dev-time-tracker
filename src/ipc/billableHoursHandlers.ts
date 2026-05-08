import { ipcMain } from "electron";
import * as billableHours from "../supabase/billableHours";
import { getCurrentUser } from "../supabase/api";

/**
 * Get billable hours summary for a specific project
 */
ipcMain.handle(
  "get-project-billable-hours",
  async (_event, projectId: string) => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      const summary = await billableHours.getProjectBillableHours(projectId);
      return summary;
    } catch (error: any) {
      console.error("Error getting project billable hours:", error);
      throw error;
    }
  },
);

/**
 * Get earnings summary for current user and month
 */
ipcMain.handle("get-current-month-earnings", async (_event) => {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    const summary = await billableHours.getCurrentMonthEarnings(user.id);
    return summary;
  } catch (error: any) {
    console.error("Error getting current month earnings:", error);
    throw error;
  }
});

/**
 * Get earnings for a specific date range
 */
ipcMain.handle(
  "get-earnings-for-range",
  async (_event, startDate: string, endDate: string) => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      const summary = await billableHours.getEarningsForRange(
        user.id,
        startDate,
        endDate,
      );
      return summary;
    } catch (error: any) {
      console.error("Error getting earnings for range:", error);
      throw error;
    }
  },
);

/**
 * Get billable hours and earnings for a specific project (enriched with project details)
 */
ipcMain.handle("get-project-earnings", async (_event, projectId: string) => {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    const summary = await billableHours.getProjectBillableHours(projectId);
    return summary;
  } catch (error: any) {
    console.error("Error getting project earnings:", error);
    throw error;
  }
});
