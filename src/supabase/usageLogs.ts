import { supabase } from "./config";

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

export interface AppDayUsage {
  language: string | null;
  language_extension: string | null;
  /** Browser category (C5); null = unclassified */
  category: string | null;
  seconds: number;
}

/**
 * One app's time on a local day, per language and browser category, most
 * first (from daily_usage_summary).
 */
export async function getUsageDetailsForAppDate(
  userId: string,
  app: string,
  date: string,
): Promise<AppDayUsage[]> {
  const { data, error } = await supabase
    .from("daily_usage_summary")
    .select("language, language_extension, category, time_spent_seconds")
    .eq("user_id", userId)
    .eq("app_name", app)
    .eq("date", date)
    .order("time_spent_seconds", { ascending: false });

  if (error) {
    throw error;
  }
  return (data || []).map((r: any) => ({
    language: r.language ?? null,
    language_extension: r.language_extension ?? null,
    category: r.category ?? null,
    seconds: r.time_spent_seconds || 0,
  }));
}

/**
 * A session with what it was spent on: { session }, where session.app_usage
 * is the foreground time per app/language/category.
 */
export async function getUsageDetailsForSession(
  userId: string,
  sessionId: string,
) {
  const { data: session, error } = await supabase
    .from("time_tracking_sessions")
    .select(
      "id, title, description, start_time, end_time, duration, supervising_seconds, code_stats, app_usage",
    )
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (error) {
    throw error;
  }
  if (!session) {
    throw new Error("Session not found");
  }
  return { session };
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
