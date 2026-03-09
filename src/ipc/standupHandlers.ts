import { ipcMain } from "electron";
import * as timeTracking from "../supabase/timeTracking";
import * as usageLogs from "../supabase/usageLogs";
import { getCurrentUser } from "../supabase/api";
import { supabase } from "../supabase/config";
import { logError } from "../utils/errorHandler";

export interface StandupData {
  dateRange: { start: string; end: string };
  totalHours: number;
  totalSessions: number;
  /** Top languages sorted by time descending */
  languages: Array<{ name: string; minutes: number }>;
  /** Top editors/apps sorted by time descending */
  editors: Array<{ name: string; minutes: number }>;
  /** Projects worked on with time */
  projects: Array<{ name: string; minutes: number; sessions: number }>;
  /** Top sessions by duration */
  topSessions: Array<{
    title: string;
    date: string;
    durationMinutes: number;
    project?: string;
  }>;
  /** Pre-formatted standup text */
  standupText: string;
}

/**
 * Generate a standup summary for a given date range.
 * Aggregates sessions, languages, editors, and projects.
 */
ipcMain.handle(
  "generate-standup-summary",
  async (
    _event,
    options: { startDate: string; endDate: string },
  ): Promise<StandupData | null> => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      const { startDate, endDate } = options;

      // Fetch sessions in date range
      const rawSessions = await timeTracking.getAllSessions(user.id, {
        startDate,
        endDate,
      });

      // Enrich sessions with project names
      const projectIds = [
        ...new Set(rawSessions.map((s: any) => s.project_id).filter(Boolean)),
      ];
      const projectMap: Record<string, string> = {};
      if (projectIds.length > 0) {
        const { data: projects } = await supabase
          .from("cloud_projects")
          .select("id, name")
          .in("id", projectIds);
        for (const p of projects || []) {
          projectMap[(p as any).id] = (p as any).name;
        }
      }

      // Fetch language summary for date range
      const langSummary = await usageLogs.getLanguageSummaryByDateRange(
        user.id,
        startDate,
        endDate,
      );

      // Fetch daily summary for date range (for editor breakdown)
      const dailySummary = await usageLogs.getDailySummary(user.id, {
        startDate,
        endDate,
      });

      // Aggregate editors from daily summary
      const editorTotals: Record<string, number> = {};
      for (const row of dailySummary as any[]) {
        const app = row.app || row.app_name;
        if (app) {
          editorTotals[app] =
            (editorTotals[app] || 0) + (row.total_time || row.time_spent || 0);
        }
      }

      // Aggregate projects from sessions
      const projectTotals: Record<
        string,
        { minutes: number; sessions: number }
      > = {};
      let totalDuration = 0;

      for (const s of rawSessions as any[]) {
        totalDuration += s.duration || 0;
        const projName = s.project_id
          ? projectMap[s.project_id] || "Unknown Project"
          : "No Project";
        if (!projectTotals[projName]) {
          projectTotals[projName] = { minutes: 0, sessions: 0 };
        }
        projectTotals[projName].minutes += Math.round((s.duration || 0) / 60);
        projectTotals[projName].sessions += 1;
      }

      const totalHours = Math.round((totalDuration / 3600) * 10) / 10;
      const totalSessions = rawSessions.length;

      const languages = langSummary
        .map((l: any) => ({
          name: l.language,
          minutes: Math.round(l.total_time / 60),
        }))
        .slice(0, 10);

      const editors = Object.entries(editorTotals)
        .map(([name, seconds]) => ({
          name,
          minutes: Math.round(seconds / 60),
        }))
        .sort((a, b) => b.minutes - a.minutes)
        .slice(0, 5);

      const projects = Object.entries(projectTotals)
        .map(([name, data]) => ({
          name,
          minutes: data.minutes,
          sessions: data.sessions,
        }))
        .sort((a, b) => b.minutes - a.minutes);

      // Top sessions by duration
      const topSessions = (rawSessions as any[])
        .sort((a, b) => (b.duration || 0) - (a.duration || 0))
        .slice(0, 5)
        .map((s) => ({
          title: s.title || "Untitled Session",
          date: s.start_time ? s.start_time.split("T")[0] : "unknown",
          durationMinutes: Math.round((s.duration || 0) / 60),
          project: s.project_id ? projectMap[s.project_id] : undefined,
        }));

      // Format standup text
      const standupText = formatStandupText({
        startDate,
        endDate,
        totalHours,
        totalSessions,
        languages,
        editors,
        projects,
        topSessions,
      });

      return {
        dateRange: { start: startDate, end: endDate },
        totalHours,
        totalSessions,
        languages,
        editors,
        projects,
        topSessions,
        standupText,
      };
    } catch (err) {
      logError("generate-standup-summary", err);
      return null;
    }
  },
);

function formatStandupText(data: {
  startDate: string;
  endDate: string;
  totalHours: number;
  totalSessions: number;
  languages: Array<{ name: string; minutes: number }>;
  editors: Array<{ name: string; minutes: number }>;
  projects: Array<{ name: string; minutes: number; sessions: number }>;
  topSessions: Array<{
    title: string;
    date: string;
    durationMinutes: number;
    project?: string;
  }>;
}): string {
  const {
    startDate,
    endDate,
    totalHours,
    totalSessions,
    languages,
    editors,
    projects,
    topSessions,
  } = data;

  const isSingleDay = startDate === endDate;
  const dateLabel = isSingleDay
    ? formatFriendlyDate(startDate)
    : `${formatFriendlyDate(startDate)} – ${formatFriendlyDate(endDate)}`;

  const lines: string[] = [];

  lines.push(`📅 ${dateLabel}`);
  lines.push(
    `⏱️ ${totalHours}h total across ${totalSessions} session${totalSessions !== 1 ? "s" : ""}`,
  );
  lines.push("");

  if (
    projects.length > 0 &&
    !(projects.length === 1 && projects[0].name === "No Project")
  ) {
    lines.push("📁 Projects:");
    for (const p of projects) {
      if (p.name === "No Project") continue;
      lines.push(
        `  • ${p.name} — ${formatDuration(p.minutes)} (${p.sessions} session${p.sessions !== 1 ? "s" : ""})`,
      );
    }
    lines.push("");
  }

  if (languages.length > 0) {
    lines.push("💻 Languages:");
    for (const l of languages.slice(0, 5)) {
      lines.push(`  • ${l.name} — ${formatDuration(l.minutes)}`);
    }
    lines.push("");
  }

  if (editors.length > 0) {
    lines.push("🛠️ Editors:");
    for (const e of editors.slice(0, 3)) {
      lines.push(`  • ${e.name} — ${formatDuration(e.minutes)}`);
    }
    lines.push("");
  }

  if (topSessions.length > 0) {
    lines.push("🏆 Top Sessions:");
    for (const s of topSessions.slice(0, 3)) {
      const proj = s.project ? ` [${s.project}]` : "";
      lines.push(
        `  • ${s.title}${proj} — ${formatDuration(s.durationMinutes)}`,
      );
    }
  }

  return lines.join("\n");
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatFriendlyDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
