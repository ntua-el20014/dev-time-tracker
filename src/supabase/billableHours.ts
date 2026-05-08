import { supabase } from "./config";

export interface BillableHoursSummary {
  projectId: string;
  projectName: string;
  projectColor: string;
  hourlyRate: number | null;
  billableHours: number; // in hours (seconds / 3600)
  billableSeconds: number;
  billableSessions: number;
  earnings: number; // hourly_rate * billable_hours
}

export interface EarningsSummary {
  totalEarnings: number;
  totalBillableHours: number;
  totalBillableSessions: number;
  byProject: BillableHoursSummary[];
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
    .select("id, name, color, hourly_rate")
    .eq("id", projectId)
    .single();

  if (projectError || !projectData) {
    return null;
  }

  // Get billable sessions for this project
  const { data: sessions, error: sessionsError } = await supabase
    .from("time_tracking_sessions")
    .select("duration, is_billable")
    .eq("project_id", projectId)
    .eq("is_billable", true);

  if (sessionsError) {
    throw sessionsError;
  }

  const billableSeconds = (sessions || []).reduce(
    (sum, s) => sum + (s.duration || 0),
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
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const defaultEnd =
    endDate ||
    new Date(now.getFullYear(), now.getMonth() + 1, 0)
      .toISOString()
      .split("T")[0];

  // Get all billable sessions for this user in the date range
  let query = supabase
    .from("time_tracking_sessions")
    .select("id, project_id, duration, is_billable, start_time");

  query = query
    .eq("user_id", userId)
    .eq("is_billable", true)
    .gte("start_time", `${defaultStart}T00:00:00`)
    .lte("start_time", `${defaultEnd}T23:59:59`);

  const { data: sessions, error: sessionsError } = await query;

  if (sessionsError) {
    throw sessionsError;
  }

  // Get all projects with hourly rates
  const { data: projects, error: projectsError } = await supabase
    .from("cloud_projects")
    .select("id, name, color, hourly_rate");

  if (projectsError) {
    throw projectsError;
  }

  // Build project map
  const projectMap: Record<string, any> = {};
  for (const p of projects || []) {
    projectMap[(p as any).id] = p;
  }

  // Group sessions by project
  const byProject: Record<string, BillableHoursSummary> = {};

  for (const session of sessions || []) {
    const projectId = (session as any).project_id;
    if (!projectId) continue;

    if (!byProject[projectId]) {
      const project = projectMap[projectId];
      if (!project) continue;

      byProject[projectId] = {
        projectId,
        projectName: (project as any).name,
        projectColor: (project as any).color,
        hourlyRate: (project as any).hourly_rate || null,
        billableHours: 0,
        billableSeconds: 0,
        billableSessions: 0,
        earnings: 0,
      };
    }

    const duration = (session as any).duration || 0;
    byProject[projectId].billableSeconds += duration;
    byProject[projectId].billableSessions += 1;
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

  // Calculate totals
  const totalBillableSeconds = summaries.reduce(
    (sum, s) => sum + s.billableSeconds,
    0,
  );
  const totalBillableHours =
    Math.round((totalBillableSeconds / 3600) * 100) / 100;
  const totalEarnings =
    Math.round(summaries.reduce((sum, s) => sum + s.earnings, 0) * 100) / 100;

  return {
    totalEarnings,
    totalBillableHours,
    totalBillableSessions: summaries.reduce(
      (sum, s) => sum + s.billableSessions,
      0,
    ),
    byProject: summaries,
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
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split("T")[0];
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    .toISOString()
    .split("T")[0];

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
