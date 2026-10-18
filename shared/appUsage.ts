/**
 * Foreground time during a session, per app, language and browser category
 * (C5). Stored as time_tracking_sessions.app_usage. Never window titles.
 */
export interface AppUsageEntry {
  app: string;
  language: string | null;
  category: string | null;
  seconds: number;
}

/** Entries kept per session (≈ 80 bytes each; the column allows 64 KB). */
export const MAX_APP_USAGE_ENTRIES = 200;

/**
 * Adds one sample to a session's usage (in place). Once the list is full,
 * new language/category combinations count toward an existing entry of the
 * same app, or are dropped if the app has none.
 */
export function addAppUsage(
  list: AppUsageEntry[],
  sample: { app: string; language: string | null; category?: string | null },
  seconds: number,
): void {
  if (!(seconds > 0)) return;
  const language = sample.language ?? null;
  const category = sample.category ?? null;
  const same = list.find(
    (e) => e.app === sample.app && e.language === language && e.category === category,
  );
  if (same) {
    same.seconds += seconds;
  } else if (list.length < MAX_APP_USAGE_ENTRIES) {
    list.push({ app: sample.app, language, category, seconds });
  } else {
    const sameApp = list.find((e) => e.app === sample.app);
    if (sameApp) sameApp.seconds += seconds;
  }
}

export interface AppUsageByApp {
  app: string;
  seconds: number;
  /** This app's entries, most time first */
  parts: AppUsageEntry[];
}

/** Usage grouped by app, most time first. Tolerates malformed rows. */
export function groupAppUsage(list: unknown): AppUsageByApp[] {
  if (!Array.isArray(list)) return [];
  const byApp = new Map<string, AppUsageByApp>();
  for (const raw of list) {
    const e = raw as Partial<AppUsageEntry> | null;
    if (!e || typeof e.app !== "string" || typeof e.seconds !== "number") continue;
    const entry: AppUsageEntry = {
      app: e.app,
      language: e.language ?? null,
      category: e.category ?? null,
      seconds: e.seconds,
    };
    const group = byApp.get(entry.app) ?? { app: entry.app, seconds: 0, parts: [] };
    group.seconds += entry.seconds;
    group.parts.push(entry);
    byApp.set(entry.app, group);
  }
  const groups = [...byApp.values()];
  for (const g of groups) g.parts.sort((a, b) => b.seconds - a.seconds);
  return groups.sort((a, b) => b.seconds - a.seconds);
}
