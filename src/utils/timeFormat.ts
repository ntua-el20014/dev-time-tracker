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

// ── Local-day helpers ────────────────────────────────────────────────
// "Days" in this app are the user's local calendar days. Never derive a day
// from an ISO timestamp with split("T")[0] — that yields the UTC day.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Local calendar day (YYYY-MM-DD) that a timestamp falls on. */
export function toLocalDateString(timestamp: string | Date): string {
  return getLocalDateString(
    typeof timestamp === "string" ? new Date(timestamp) : timestamp,
  );
}

/**
 * ISO instant of local midnight at the start of a YYYY-MM-DD day, for use as
 * an inclusive lower bound on timestamptz columns. Full timestamps pass through.
 */
export function localDayStartISO(date: string): string {
  return DATE_ONLY.test(date)
    ? new Date(`${date}T00:00:00`).toISOString()
    : date;
}

/**
 * ISO instant of the last millisecond of a local YYYY-MM-DD day, for use as an
 * inclusive upper bound on timestamptz columns. Full timestamps pass through.
 */
export function localDayEndISO(date: string): string {
  return DATE_ONLY.test(date)
    ? new Date(`${date}T23:59:59.999`).toISOString()
    : date;
}

// Pretty date formatting
export function prettyDate(dateStr: string | Date | null | undefined): string {
  if (dateStr == null) return "Unknown date";
  const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  if (isNaN(d.getTime())) return "Unknown date";
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
