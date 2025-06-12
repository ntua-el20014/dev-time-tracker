/* eslint-disable @typescript-eslint/no-explicit-any */
// Escapes HTML special characters
export function escapeHtml(text: string) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Returns YYYY-MM-DD format for a Date
export function getLocalDateString(date: Date): string {
  return date.toLocaleDateString('en-CA');
}

// Returns array of Dates for the week (Monday to Sunday) containing startDate
export function getWeekDates(startDate: Date): Date[] {
  const date = new Date(startDate);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date);
  monday.setDate(diff);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const weekDay = new Date(monday);
    weekDay.setDate(monday.getDate() + i);
    dates.push(weekDay);
  }
  return dates;
}

// Returns the Monday of the week for a given date
export function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Helper to filter daily data for a specific week
export function filterDailyDataForWeek(dailyData: any[], weekMonday: Date): any[] {
  const weekDates = getWeekDates(weekMonday).map(d => getLocalDateString(d));
  return dailyData.filter(row => weekDates.includes(row.date));
}
