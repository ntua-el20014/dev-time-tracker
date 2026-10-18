import { ipcMain } from "electron";
import { getCurrentUser } from "../supabase/api";
import { supabase } from "../supabase/client";
import { localDayStartISO, localDayEndISO } from "../utils/timeFormat";
import { billableSecondsOf } from "../../shared/billing";
import { roundUsd } from "../../shared/projectActivity";
import { getAgentTotalsByProject } from "../supabase/projectActivity";
import { normalizeCurrency } from "../../shared/currency";

/**
 * Adds billed_seconds to each session: its duration, minus supervising time
 * for projects that don't bill it.
 */
async function withBilledSeconds<
  T extends { project_id?: string | null; duration?: number | null },
>(sessions: T[]): Promise<(T & { billed_seconds: number })[]> {
  const projectIds = [
    ...new Set(sessions.map((s) => s.project_id).filter(Boolean)),
  ] as string[];
  const unbilled = new Set<string>();
  if (projectIds.length > 0) {
    const { data, error } = await supabase
      .from("cloud_projects")
      .select("id, bill_supervising")
      .in("id", projectIds);
    if (error) throw error;
    for (const p of data || []) {
      if ((p as any).bill_supervising === false) unbilled.add((p as any).id);
    }
  }
  return sessions.map((s) => ({
    ...s,
    billed_seconds: billableSecondsOf(
      s,
      !(s.project_id && unbilled.has(s.project_id)),
    ),
  }));
}

// Get billable sessions for projects in a date range
ipcMain.handle(
  "get-billable-sessions",
  async (
    _event,
    filters: {
      projectId?: string;
      projectIds?: string[];
      startDate: string;
      endDate: string;
      billableOnly?: boolean;
    },
  ) => {
    try {
      const user = await getCurrentUser();
      if (!user) throw new Error("Not authenticated");


      let query = supabase
        .from("time_tracking_sessions")
        .select("*")
        .eq("user_id", user.id)
        .gte("start_time", localDayStartISO(filters.startDate))
        .lte("start_time", localDayEndISO(filters.endDate));

      // Filter by project
      if (filters.projectId) {
        query = query.eq("project_id", filters.projectId);
      } else if (filters.projectIds && filters.projectIds.length > 0) {
        query = query.in("project_id", filters.projectIds);
      }

      // Filter by billable status
      if (filters.billableOnly !== false) {
        query = query.eq("is_billable", true);
      }

      const { data, error } = await query.order("start_time", {
        ascending: false,
      });

      if (error) throw error;
      return await withBilledSeconds(data || []);
    } catch (error) {
      console.error("Error fetching billable sessions:", error);
      throw error;
    }
  },
);

// Get project with hourly rate for invoice
ipcMain.handle("get-project-for-invoice", async (_event, projectId: string) => {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");

    const { data, error } = await supabase
      .from("cloud_projects")
      .select("*")
      .eq("id", projectId)
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error fetching project:", error);
    throw error;
  }
});

// Get all projects with billable hours info for invoice generation
ipcMain.handle(
  "get-projects-for-invoice",
  async (_event, startDate: string, endDate: string) => {
    try {
      const user = await getCurrentUser();
      if (!user) throw new Error("Not authenticated");

      // Fetch user profile to get org_id
      const { data: userProfile, error: profileError } = await supabase
        .from("user_profiles")
        .select("org_id")
        .eq("id", user.id)
        .single();

      if (profileError) throw profileError;
      const userOrgId = userProfile?.org_id;


      // Get user's sessions grouped by project
      const { data: sessions, error: sessionsError } = await supabase
        .from("time_tracking_sessions")
        .select(
          "id, project_id, duration, supervising_seconds, start_time, description",
        )
        .eq("user_id", user.id)
        .eq("is_billable", true)
        .gte("start_time", localDayStartISO(startDate))
        .lte("start_time", localDayEndISO(endDate));

      if (sessionsError) throw sessionsError;

      // Group sessions by project_id
      const sessionsByProject = new Map<string, any[]>();
      (await withBilledSeconds(sessions || [])).forEach((session: any) => {
        if (!sessionsByProject.has(session.project_id)) {
          sessionsByProject.set(session.project_id, []);
        }
        sessionsByProject.get(session.project_id)!.push(session);
      });

      // AI agent cost per project (an optional invoice line, C6); a project
      // where only agents worked can be invoiced too
      const agentTotals = await getAgentTotalsByProject(user.id, startDate, endDate);

      // Get details for each project
      const projectIds = [
        ...new Set([...sessionsByProject.keys(), ...agentTotals.keys()]),
      ].filter(Boolean);
      if (projectIds.length === 0) {
        return [];
      }

      const { data: projects, error: projectsError } = await supabase
        .from("cloud_projects")
        .select("id, name, hourly_rate, currency, scope, manager_id, org_id, is_active")
        .in("id", projectIds)
        .eq("is_active", true);

      if (projectsError) throw projectsError;

      // Filter projects based on user permissions and build results
      const results = (projects || [])
        .filter((project: any) => {
          if (project.scope === "personal" && project.manager_id === user.id)
            return true;
          if (project.scope === "organization" && project.org_id === userOrgId)
            return true;
          return false;
        })
        .map((project: any) => ({
          projectId: project.id,
          projectName: project.name,
          hourlyRate: project.hourly_rate || 0,
          currency: normalizeCurrency(project.currency),
          billableSessions: sessionsByProject.get(project.id) || [],
          totalSessions: (sessionsByProject.get(project.id) || []).length,
          agentCostUsd: roundUsd(agentTotals.get(project.id)?.costUsd ?? 0),
          agentCostIncomplete: agentTotals.get(project.id)?.costIncomplete ?? false,
          agentSessions: agentTotals.get(project.id)?.sessions ?? 0,
        }))
        // Agent sessions without a reported cost give nothing to invoice
        .filter((p) => p.totalSessions > 0 || p.agentCostUsd > 0);

      return results;
    } catch (error) {
      console.error("Error fetching projects for invoice:", error);
      throw error;
    }
  },
);
