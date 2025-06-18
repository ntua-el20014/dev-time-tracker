// Formats seconds as "Xh Ym Zs", omitting 0h or 0m
export function formatTimeSpent(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  let result = '';
  if (h > 0) result += `${h}h `;
  if (m > 0) result += `${m}m `;
    if (s > 0 || (!h && !m)) result += `${s}s`;
    
  return result.trim();
}

// Formats a date to YYYY-MM-DD format
export function getLocalDateString(date = new Date()): string {
  return date.toLocaleDateString('en-CA'); // YYYY-MM-DD format
}