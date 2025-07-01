// Re-export date utilities from shared location
export {
  formatTimeSpent,
  getLocalDateString,
  prettyDate,
  getWeekDates,
  getMonday,
} from "../../src/utils/timeFormat";
import { getLocalDateString, getWeekDates } from "../../src/utils/timeFormat";
import type { DailySummaryRow } from "@shared/types";

// Helper to filter daily data for a specific week
export function filterDailyDataForWeek(
  dailyData: DailySummaryRow[],
  weekMonday: Date
): DailySummaryRow[] {
  const weekDates = getWeekDates(weekMonday).map((d: Date) =>
    getLocalDateString(d)
  );
  return dailyData.filter((row) => weekDates.includes(row.date));
}
