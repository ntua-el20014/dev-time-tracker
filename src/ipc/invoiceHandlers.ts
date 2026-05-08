import { ipcMain } from "electron";
import { getCurrentUser } from "../supabase/api";
import { supabase } from "../supabase/client";

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

      const startDate = new Date(filters.startDate);
      const endDate = new Date(filters.endDate);

      let query = supabase
        .from("time_tracking_sessions")
        .select("*")
        .eq("user_id", user.id)
        .gte("start_time", startDate.toISOString())
        .lte("start_time", endDate.toISOString());

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
      return data || [];
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

      const dateStart = new Date(startDate);
      const dateEnd = new Date(endDate);

      // Get user's sessions grouped by project
      const { data: sessions, error: sessionsError } = await supabase
        .from("time_tracking_sessions")
        .select("id, project_id, duration, start_time, description")
        .eq("user_id", user.id)
        .eq("is_billable", true)
        .gte("start_time", dateStart.toISOString())
        .lte("start_time", dateEnd.toISOString());

      if (sessionsError) throw sessionsError;

      // Group sessions by project_id
      const sessionsByProject = new Map<string, any[]>();
      (sessions || []).forEach((session: any) => {
        if (!sessionsByProject.has(session.project_id)) {
          sessionsByProject.set(session.project_id, []);
        }
        sessionsByProject.get(session.project_id)!.push(session);
      });

      // Get details for each project
      const projectIds = Array.from(sessionsByProject.keys());
      if (projectIds.length === 0) {
        return [];
      }

      const { data: projects, error: projectsError } = await supabase
        .from("cloud_projects")
        .select("id, name, hourly_rate, scope, manager_id, org_id, is_active")
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
          billableSessions: sessionsByProject.get(project.id) || [],
          totalSessions: (sessionsByProject.get(project.id) || []).length,
        }));

      return results;
    } catch (error) {
      console.error("Error fetching projects for invoice:", error);
      throw error;
    }
  },
);
