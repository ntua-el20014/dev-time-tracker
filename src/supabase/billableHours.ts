import { supabase } from "./config";
import { billableSecondsOf } from "../../shared/billing";
import {
  getLocalDateString,
  localDayStartISO,
  localDayEndISO,
} from "../utils/timeFormat";

export interface BillableHoursSummary {
  projectId: string;
  projectName: string;
  projectColor: string;
  hourlyRate: number | null;
  billableHours: number; // in hours (seconds / 3600)
  billableSeconds: number;
  billableSessions: number;
  earnings: number; // hourly_rate * billable_hours
  /** Supervising time in these sessions (billed only if billSupervising) */
  supervisingSeconds: number;
  billSupervising: boolean;
}

/** Billable sessions with no project: no rate, so no earnings. */
export interface UnassignedBillable {
  billableHours: number;
  billableSeconds: number;
  billableSessions: number;
}

export interface EarningsSummary {
  totalEarnings: number;
  /** Includes unassigned billable time */
  totalBillableHours: number;
  /** Includes unassigned billable sessions */
  totalBillableSessions: number;
  byProject: BillableHoursSummary[];
  unassigned: UnassignedBillable;
  startDate: string;
  endDate: string;
}

/**
 * Get billable hours summary for a specific project
 */
export async function getProjectBillableHours(
  projectId: string,
): Promise<BillableHoursSummary | null> {
  // Get project details
  const { data: projectData, error: projectError } = await supabase
    .from("cloud_projects")
    .select("id, name, color, hourly_rate, bill_supervising")
    .eq("id", projectId)
    .single();

  if (projectError || !projectData) {
    return null;
  }

  // Get billable sessions for this project
  const { data: sessions, error: sessionsError } = await supabase
    .from("time_tracking_sessions")
    .select("duration, is_billable, supervising_seconds")
    .eq("project_id", projectId)
    .eq("is_billable", true);

  if (sessionsError) {
    throw sessionsError;
  }

  const billSupervising = (projectData as any).bill_supervising !== false;
  const billableSeconds = (sessions || []).reduce(
    (sum, s) => sum + billableSecondsOf(s, billSupervising),
    0,
  );
  const supervisingSeconds = (sessions || []).reduce(
    (sum, s) => sum + ((s as any).supervising_seconds || 0),
    0,
  );
  const billableHours = billableSeconds / 3600;
  const hourlyRate = (projectData as any).hourly_rate || null;
  const earnings = hourlyRate ? hourlyRate * billableHours : 0;

  return {
    projectId: (projectData as any).id,
    projectName: (projectData as any).name,
    projectColor: (projectData as any).color,
    hourlyRate,
    billableHours: Math.round(billableHours * 100) / 100, // 2 decimal places
    billableSeconds,
    billableSessions: sessions?.length || 0,
    earnings: Math.round(earnings * 100) / 100, // 2 decimal places
    supervisingSeconds,
    billSupervising,
  };
}

/**
 * Get earnings summary for a user across all projects for a date range
 */
export async function getUserEarningsSummary(
  userId: string,
  startDate?: string,
  endDate?: string,
): Promise<EarningsSummary> {
  // Default to current calendar month
  const now = new Date();
  const defaultStart =
    startDate ||
    getLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1));
  const defaultEnd =
    endDate ||
    getLocalDateString(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  // Get all billable sessions for this user in the date range
  let query = supabase
    .from("time_tracking_sessions")
    .select("id, project_id, duration, is_billable, start_time, supervising_seconds");

  query = query
    .eq("user_id", userId)
    .eq("is_billable", true)
    .gte("start_time", localDayStartISO(defaultStart))
    .lte("start_time", localDayEndISO(defaultEnd));

  const { data: sessions, error: sessionsError } = await query;

  if (sessionsError) {
    throw sessionsError;
  }

  // Get all projects with hourly rates
  const { data: projects, error: projectsError } = await supabase
    .from("cloud_projects")
    .select("id, name, color, hourly_rate, bill_supervising");

  if (projectsError) {
    throw projectsError;
  }

  // Build project map
  const projectMap: Record<string, any> = {};
  for (const p of projects || []) {
    projectMap[(p as any).id] = p;
  }

  // Group sessions by project; sessions without a (visible) project are
  // collected as unassigned so the time isn't silently dropped
  const byProject: Record<string, BillableHoursSummary> = {};
  const unassigned: UnassignedBillable = {
    billableHours: 0,
    billableSeconds: 0,
    billableSessions: 0,
  };

  for (const session of sessions || []) {
    const projectId = (session as any).project_id;
    const project = projectId ? projectMap[projectId] : undefined;
    if (!project) {
      unassigned.billableSeconds += (session as any).duration || 0;
      unassigned.billableSessions += 1;
      continue;
    }

    if (!byProject[projectId]) {
      byProject[projectId] = {
        projectId,
        projectName: (project as any).name,
        projectColor: (project as any).color,
        hourlyRate: (project as any).hourly_rate || null,
        billableHours: 0,
        billableSeconds: 0,
        billableSessions: 0,
        earnings: 0,
        supervisingSeconds: 0,
        billSupervising: (project as any).bill_supervising !== false,
      };
    }

    const summary = byProject[projectId];
    summary.billableSeconds += billableSecondsOf(
      session as any,
      summary.billSupervising,
    );
    summary.supervisingSeconds += (session as any).supervising_seconds || 0;
    summary.billableSessions += 1;
  }

  // Calculate billable hours and earnings
  const summaries = Object.values(byProject).map((summary) => {
    summary.billableHours =
      Math.round((summary.billableSeconds / 3600) * 100) / 100;
    summary.earnings = summary.hourlyRate
      ? Math.round(summary.hourlyRate * summary.billableHours * 100) / 100
      : 0;
    return summary;
  });

  unassigned.billableHours =
    Math.round((unassigned.billableSeconds / 3600) * 100) / 100;

  // Calculate totals
  const totalBillableSeconds =
    summaries.reduce((sum, s) => sum + s.billableSeconds, 0) +
    unassigned.billableSeconds;
  const totalBillableHours =
    Math.round((totalBillableSeconds / 3600) * 100) / 100;
  const totalEarnings =
    Math.round(summaries.reduce((sum, s) => sum + s.earnings, 0) * 100) / 100;

  return {
    totalEarnings,
    totalBillableHours,
    totalBillableSessions:
      summaries.reduce((sum, s) => sum + s.billableSessions, 0) +
      unassigned.billableSessions,
    byProject: summaries,
    unassigned,
    startDate: defaultStart,
    endDate: defaultEnd,
  };
}

/**
 * Get earnings for current month (shorthand)
 */
export async function getCurrentMonthEarnings(
  userId: string,
): Promise<EarningsSummary> {
  const now = new Date();
  const startDate = getLocalDateString(
    new Date(now.getFullYear(), now.getMonth(), 1),
  );
  const endDate = getLocalDateString(
    new Date(now.getFullYear(), now.getMonth() + 1, 0),
  );

  return getUserEarningsSummary(userId, startDate, endDate);
}

/**
 * Get earnings for a specific date range
 */
export async function getEarningsForRange(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<EarningsSummary> {
  return getUserEarningsSummary(userId, startDate, endDate);
}
