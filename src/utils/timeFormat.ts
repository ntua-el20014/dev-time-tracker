// Formats seconds as "Xh Ym Zs", omitting 0h or 0m
export function formatTimeSpent(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  let result = "";
  if (h > 0) result += `${h}h `;
  if (m > 0) result += `${m}m `;
  if (s > 0 || (!h && !m)) result += `${s}s`;

  return result.trim();
}

// Formats a date to YYYY-MM-DD format
export function getLocalDateString(date = new Date()): string {
  return date.toLocaleDateString("en-CA"); // YYYY-MM-DD format
}

// Pretty date formatting
export function prettyDate(dateStr: string | Date): string {
  const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Week utilities
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

export function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
