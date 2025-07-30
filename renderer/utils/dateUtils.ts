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

// Helper to format time in a pretty way (e.g., "14:30:25" or "2:30 PM")
export function prettyTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return isoString;
  }
}

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
