import { supabase } from "./config";
import type { Database } from "../types/database.types";
import {
  toLocalDateString,
  localDayStartISO,
  localDayEndISO,
} from "../utils/timeFormat";

type UsageLogsInsert = Database["public"]["Tables"]["usage_logs"]["Insert"];

/**
 * Log usage activity for an application.
 *
 * `iconUrl` (a data URL) is only written to the daily summary row, never to
 * the per-tick usage_logs row. Callers should pass it once per app/day and
 * null afterwards — the summary keeps the existing icon when given null.
 */
export async function logUsage(
  userId: string,
  appName: string,
  windowTitle: string,
  language?: string | null,
  languageExtension?: string | null,
  iconUrl?: string | null,
  intervalSeconds: number = 1,
  timestamp?: string,
  category?: string | null,
) {
  const logTime = timestamp || new Date().toISOString();
  const date = toLocalDateString(logTime); // user's local calendar day

  const usageData: UsageLogsInsert = {
    user_id: userId,
    app_name: appName,
    window_title: windowTitle,
    language: language || null,
    language_extension: languageExtension || null,
    category: category || null,
    timestamp: logTime,
  };

  // 1. Insert usage log
  const { data, error } = await supabase
    .from("usage_logs")
    .insert(usageData as any)
    .select()
    .single();

  if (error) {
    throw error;
  }

  // 2. Update daily summary using the database function
  const { error: summaryError } = await (supabase as any).rpc(
    "update_daily_usage_summary",
    {
      p_user_id: userId,
      p_date: date,
      p_app_name: appName,
      p_language: language || null,
      p_language_extension: languageExtension || null,
      p_icon_url: iconUrl || null,
      p_time_spent_seconds: intervalSeconds,
      p_category: category || null,
    },
  );

  if (summaryError) {
    // Don't throw - usage log was saved successfully
    // Summary will be updated on next request or can be recalculated
  }

  return data;
}

/**
 * Insert many usage_logs rows in one request (used by the tracking batcher).
 * Icons are not stored per row; see addUsageToDailySummary.
 */
export async function insertUsageLogs(
  records: Array<{
    userId: string;
    appName: string;
    windowTitle: string;
    language: string | null;
    languageExtension: string | null;
    category?: string | null;
    timestamp: string;
  }>,
) {
  if (records.length === 0) return;
  const rows: UsageLogsInsert[] = records.map((r) => ({
    user_id: r.userId,
    app_name: r.appName,
    window_title: r.windowTitle,
    language: r.language || null,
    language_extension: r.languageExtension || null,
    category: r.category || null,
    timestamp: r.timestamp,
  }));

  const { error } = await supabase.from("usage_logs").insert(rows as any);
  if (error) {
    throw error;
  }
}

/**
 * Add time to one daily_usage_summary row (upsert). Throws on error.
 * `date` must be the user's local calendar day.
 */
export async function addUsageToDailySummary(increment: {
  userId: string;
  date: string;
  appName: string;
  language: string | null;
  languageExtension: string | null;
  category?: string | null;
  icon: string | null;
  seconds: number;
}) {
  const { error } = await (supabase as any).rpc("update_daily_usage_summary", {
    p_user_id: increment.userId,
    p_date: increment.date,
    p_app_name: increment.appName,
    p_language: increment.language || null,
    p_language_extension: increment.languageExtension || null,
    p_icon_url: increment.icon || null,
    p_time_spent_seconds: increment.seconds,
    p_category: increment.category || null,
  });
  if (error) {
    throw error;
  }
}

/**
 * Helper to map raw daily_usage_summary rows to the shape the renderer expects.
 * DB columns: app_name, icon_url, language_extension, time_spent_seconds
 * Renderer expects: app, icon, lang_ext, time_spent (LogEntry) / total_time (DailySummaryRow)
 */
function mapSummaryRow(row: any) {
  return {
    ...row,
    app: row.app_name ?? row.app,
    icon: row.icon_url ?? row.icon,
    lang_ext: row.language_extension ?? row.lang_ext,
    time_spent: row.time_spent_seconds ?? row.time_spent ?? 0,
    total_time: row.time_spent_seconds ?? row.total_time ?? 0,
  };
}

/**
 * Aggregate mapped summary rows by a key, summing time fields.
 * Used to merge rows that differ only by language into a single app entry.
 */
function aggregateSummaryRows(rows: any[], keyFn: (row: any) => string): any[] {
  const map = new Map<string, any>();
  for (const row of rows) {
    const key = keyFn(row);
    if (map.has(key)) {
      const existing = map.get(key)!;
      // The icon is stored on one of an app's rows only (sent once per run)
      if (!existing.icon && row.icon) {
        existing.icon = row.icon;
        existing.icon_url = row.icon_url;
      }
      existing.time_spent += row.time_spent;
      existing.total_time += row.total_time;
      existing.time_spent_seconds =
        (existing.time_spent_seconds || 0) + (row.time_spent_seconds || 0);
    } else {
      map.set(key, { ...row });
    }
  }
  return Array.from(map.values());
}

export interface CategoryTime {
  /** Browser category (C5); null = unclassified */
  category: string | null;
  seconds: number;
}

/** Seconds per category, most first. */
function sumByCategory(rows: { category?: string | null; seconds: number }[]): CategoryTime[] {
  const by = new Map<string | null, number>();
  for (const r of rows) {
    const key = r.category ?? null;
    by.set(key, (by.get(key) ?? 0) + (r.seconds || 0));
  }
  return [...by]
    .map(([category, seconds]) => ({ category, seconds }))
    .filter((c) => c.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);
}

/**
 * Get usage summary for a specific date. Apps with categorised time
 * (browsers, C5) also get `categories`: seconds per category.
 */
export async function getUsageSummary(userId: string, date: string) {
  const { data, error } = await supabase
    .from("daily_usage_summary")
    .select(
      "date, app_name, icon_url, language, language_extension, category, time_spent_seconds",
    )
    .eq("user_id", userId)
    .eq("date", date)
    .order("time_spent_seconds", { ascending: false });

  if (error) {
    throw error;
  }
  const mapped = (data || []).map(mapSummaryRow);
  // Aggregate by app so multiple languages don't create duplicate rows
  const apps = aggregateSummaryRows(mapped, (r) => r.app);
  for (const app of apps) {
    const rows = mapped.filter((r: any) => r.app === app.app);
    if (rows.some((r: any) => r.category)) {
      app.categories = sumByCategory(
        rows.map((r: any) => ({ category: r.category, seconds: r.time_spent })),
      );
    }
    delete app.category;
  }
  return apps.sort((a: any, b: any) => b.time_spent - a.time_spent);
}

/**
 * Browser time per category within local days [startDate, endDate] (C5):
 * rows of the given browser apps; their unclassified time has category null.
 */
export async function getBrowserUsage(
  userId: string,
  startDate: string,
  endDate: string,
  browserNames: string[],
): Promise<CategoryTime[]> {
  if (browserNames.length === 0) return [];
  const { data, error } = await supabase
    .from("daily_usage_summary")
    .select("category, time_spent_seconds")
    .eq("user_id", userId)
    .in("app_name", browserNames)
    .gte("date", startDate)
    .lte("date", endDate);
  if (error) throw error;
  return sumByCategory(
    (data || []).map((r: any) => ({ category: r.category, seconds: r.time_spent_seconds })),
  );
}

/**
 * Get raw usage logs for a specific date with optional filters
 */
export async function getUsageLogs(
  userId: string,
  date: string,
  filters?: {
    app?: string;
    language?: string;
    limit?: number;
    offset?: number;
  },
) {
  const startOfDay = localDayStartISO(date);
  const endOfDay = localDayEndISO(date);

  let query = supabase
    .from("usage_logs")
    .select(
      "app_name, window_title, language, language_extension, timestamp",
    )
    .eq("user_id", userId)
    .gte("timestamp", startOfDay)
    .lte("timestamp", endOfDay)
    .order("timestamp", { ascending: false });

  if (filters?.app) {
    query = query.eq("app_name", filters.app);
  }
  if (filters?.language) {
    query = query.eq("language", filters.language);
  }
  if (filters?.limit) {
    query = query.limit(filters.limit);
  }
  if (filters?.offset) {
    query = query.range(
      filters.offset,
      filters.offset + (filters.limit || 100) - 1,
    );
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }
  return (data || []).map(mapUsageLogRow);
}

/**
 * Get daily summaries across date range with optional filters
 */
export async function getDailySummary(
  userId: string,
  filters?: {
    startDate?: string;
    endDate?: string;
    app?: string;
    language?: string;
    limit?: number;
    offset?: number;
  },
) {
  let query = supabase
    .from("daily_usage_summary")
    .select(
      "date, app_name, icon_url, language, language_extension, time_spent_seconds",
    )
    .eq("user_id", userId)
    .order("date", { ascending: false });

  if (filters?.startDate) {
    query = query.gte("date", filters.startDate);
  }
  if (filters?.endDate) {
    query = query.lte("date", filters.endDate);
  }
  if (filters?.app) {
    query = query.eq("app_name", filters.app);
  }
  if (filters?.language) {
    query = query.eq("language", filters.language);
  }
  if (filters?.limit) {
    query = query.limit(filters.limit);
  }
  if (filters?.offset) {
    query = query.range(
      filters.offset,
      filters.offset + (filters.limit || 200) - 1,
    );
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }
  const mapped = (data || []).map(mapSummaryRow);
  // Aggregate by (date, app) so multiple languages don't create duplicate rows
  return aggregateSummaryRows(mapped, (r) => `${r.date}|${r.app}`);
}

/**
 * Get editor usage statistics
 */
export async function getEditorUsage(userId: string) {
  const { data, error } = await supabase
    .from("daily_usage_summary")
    .select(
      "app_name, language, language_extension, icon_url, time_spent_seconds",
    )
    .eq("user_id", userId)
    .not("language", "is", null)
    .order("time_spent_seconds", { ascending: false });

  if (error) {
    throw error;
  }
  const mapped = (data || []).map(mapSummaryRow);
  // Aggregate by app so multiple languages don't create duplicate editor entries
  return aggregateSummaryRows(mapped, (r) => r.app).sort(
    (a: any, b: any) => b.total_time - a.total_time,
  );
}

/**
 * Get language usage statistics aggregated across all apps
 */
export async function getLanguageUsage(userId: string) {
  const { data, error } = await supabase
    .from("daily_usage_summary")
    .select("language, app_name, time_spent_seconds")
    .eq("user_id", userId)
    .not("language", "is", null);

  if (error) {
    throw error;
  }

  // Aggregate by language
  const languageMap = new Map<
    string,
    { total_time: number; apps: Set<string> }
  >();

  (data || []).forEach((item: any) => {
    const lang = item.language as string;
    if (!languageMap.has(lang)) {
      languageMap.set(lang, { total_time: 0, apps: new Set() });
    }
    const langData = languageMap.get(lang)!;
    langData.total_time += item.time_spent_seconds || 0;
    langData.apps.add(item.app_name);
  });

  return Array.from(languageMap.entries())
    .map(([language, stats]) => ({
      language,
      total_time: stats.total_time,
      app_count: stats.apps.size,
    }))
    .sort((a, b) => b.total_time - a.total_time);
}

/**
 * Helper to map raw usage_logs rows to the shape the renderer expects.
 * DB columns: app_name, window_title, icon_url, language_extension, timestamp
 * Renderer expects: app, title, icon, lang_ext, time
 */
function mapUsageLogRow(row: any) {
  const ts = row.timestamp ? new Date(row.timestamp) : null;
  return {
    ...row,
    app: row.app_name ?? row.app,
    title: row.window_title ?? row.title,
    icon: row.icon_url ?? row.icon,
    lang_ext: row.language_extension ?? row.lang_ext,
    time: ts
      ? ts.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : "",
  };
}

/**
 * Get detailed usage for a specific app on a specific date
 */
export async function getUsageDetailsForAppDate(
  userId: string,
  app: string,
  date: string,
) {
  const startOfDay = localDayStartISO(date);
  const endOfDay = localDayEndISO(date);

  const { data, error } = await supabase
    .from("usage_logs")
    .select(
      "app_name, window_title, language, language_extension, timestamp",
    )
    .eq("user_id", userId)
    .eq("app_name", app)
    .gte("timestamp", startOfDay)
    .lte("timestamp", endOfDay)
    .order("timestamp", { ascending: false });

  if (error) {
    throw error;
  }
  return (data || []).map(mapUsageLogRow);
}

/**
 * A session and the usage logged during it: { session, usage }. Usage is
 * found by the session's time range (usage_logs.session_id isn't written).
 */
export async function getUsageDetailsForSession(
  userId: string,
  sessionId: string,
) {
  // First get the session time range
  const { data: session, error: sessionError } = await supabase
    .from("time_tracking_sessions")
    .select(
      "id, title, description, start_time, end_time, duration, supervising_seconds, code_stats",
    )
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (sessionError) {
    throw sessionError;
  }
  if (!session) {
    throw new Error("Session not found");
  }

  const startTime = (session as any).start_time;
  const duration = (session as any).duration || 0;
  // end_time is the wall-clock end (includes pauses); older sessions lack it,
  // so fall back to start + active duration.
  const endTime =
    (session as any).end_time ||
    new Date(new Date(startTime).getTime() + duration * 1000).toISOString();

  const { data, error } = await supabase
    .from("usage_logs")
    .select(
      "app_name, window_title, language, language_extension, timestamp",
    )
    .eq("user_id", userId)
    .gte("timestamp", startTime)
    .lte("timestamp", endTime)
    .order("timestamp", { ascending: false });

  if (error) {
    throw error;
  }
  return { session, usage: (data || []).map(mapUsageLogRow) };
}

/**
 * Get all days with logged usage for a specific month
 */
export async function getLoggedDaysOfMonth(
  userId: string,
  year: number,
  month: number,
) {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  // Get the actual last day of the month (handles Feb, 30-day months, leap years)
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const { data, error } = await supabase
    .from("daily_usage_summary")
    .select("date")
    .eq("user_id", userId)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });

  if (error) {
    throw error;
  }

  // Get unique dates
  const uniqueDates = new Set((data || []).map((item: any) => item.date));
  return Array.from(uniqueDates);
}

/**
 * Get language summary aggregated by language within a date range
 */
export async function getLanguageSummaryByDateRange(
  userId: string,
  startDate: string,
  endDate: string,
) {
  const { data, error } = await supabase
    .from("daily_usage_summary")
    .select("language, language_extension, time_spent_seconds")
    .eq("user_id", userId)
    .gte("date", startDate)
    .lte("date", endDate)
    .not("language", "is", null);

  if (error) {
    throw error;
  }

  // Aggregate by language and lang_ext
  const languageMap = new Map<
    string,
    { language: string; lang_ext: string; total_time: number }
  >();

  (data || []).forEach((item: any) => {
    const key = `${item.language}|${item.language_extension || ""}`;
    if (!languageMap.has(key)) {
      languageMap.set(key, {
        language: item.language,
        lang_ext: item.language_extension || "",
        total_time: 0,
      });
    }
    const langData = languageMap.get(key)!;
    langData.total_time += item.time_spent_seconds || 0;
  });

  return Array.from(languageMap.values()).sort(
    (a, b) => b.total_time - a.total_time,
  );
}

/**
 * Get distinct editors (apps) used by the user
 */
export async function getUserEditors(userId: string) {
  const { data, error } = await supabase
    .from("daily_usage_summary")
    .select("app_name, icon_url")
    .eq("user_id", userId)
    .not("icon_url", "is", null)
    .neq("icon_url", "");

  if (error) {
    throw error;
  }

  // Get distinct app-icon pairs
  const editorMap = new Map<string, { app: string; icon: string }>();
  (data || []).forEach((item: any) => {
    if (!editorMap.has(item.app_name)) {
      editorMap.set(item.app_name, { app: item.app_name, icon: item.icon_url });
    }
  });

  return Array.from(editorMap.values());
}

/**
 * Get distinct language extensions used by the user
 */
export async function getUserLangExts(userId: string) {
  const { data, error } = await supabase
    .from("daily_usage_summary")
    .select("language_extension")
    .eq("user_id", userId)
    .not("language_extension", "is", null)
    .neq("language_extension", "");

  if (error) {
    throw error;
  }

  // Get distinct lang_exts
  const extsSet = new Set(
    (data || []).map((item: any) => item.language_extension),
  );
  return Array.from(extsSet).map((lang_ext) => ({ lang_ext }));
}
