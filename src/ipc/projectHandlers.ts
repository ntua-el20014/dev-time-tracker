import { ipcMain } from "electron";
import * as cloudProjects from "../supabase/cloudProjects";
import { getCurrentUser } from "../supabase/api";
import type {
  CreateCloudProjectData,
  UpdateCloudProjectData,
  AssignProjectMemberData,
} from "../types/organization.types";

/**
 * Create a new project (organization or personal)
 */
ipcMain.handle(
  "create-project",
  async (_event, name: string, description: string, color: string) => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      const projectData: CreateCloudProjectData = {
        name,
        description,
        color,
        scope: "personal", // Default to personal for now
      };

      return await cloudProjects.createCloudProject(projectData, user.id);
    } catch (err) {
      return null;
    }
  },
);

/**
 * Get all projects (both organization and personal)
 */
ipcMain.handle("get-all-projects", async (_event) => {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    // Get both organization and personal projects
    const [orgProjects, personalProjects] = await Promise.all([
      cloudProjects.getOrganizationProjects(user.id),
      cloudProjects.getPersonalProjects(user.id),
    ]);

    return [...orgProjects, ...personalProjects];
  } catch (err) {
    return [];
  }
});

/**
 * Get all projects with members
 */
ipcMain.handle("get-all-projects-with-members", async (_event) => {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    // Get both organization and personal projects
    const [orgProjects, personalProjects] = await Promise.all([
      cloudProjects.getOrganizationProjects(user.id),
      cloudProjects.getPersonalProjects(user.id),
    ]);

    const allProjects = [...orgProjects, ...personalProjects];

    // Get members for each project
    const projectsWithMembers = await Promise.all(
      allProjects.map(async (project) => {
        const members = await cloudProjects.getProjectMembers(
          (project as any).id,
        );
        return { ...project, members };
      }),
    );

    return projectsWithMembers;
  } catch (err) {
    return [];
  }
});

/**
 * Get user's personal projects
 */
ipcMain.handle("get-user-projects", async (_event) => {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    return await cloudProjects.getPersonalProjects(user.id);
  } catch (err) {
    return [];
  }
});

/**
 * Get user's personal projects with members
 */
ipcMain.handle("get-user-projects-with-members", async (_event) => {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    const projects = await cloudProjects.getPersonalProjects(user.id);

    // Get members for each project
    const projectsWithMembers = await Promise.all(
      projects.map(async (project) => {
        const members = await cloudProjects.getProjectMembers(
          (project as any).id,
        );
        return { ...project, members };
      }),
    );

    return projectsWithMembers;
  } catch (err) {
    return [];
  }
});

/**
 * Get all projects accessible to a user (organization + personal)
 */
ipcMain.handle("get-projects-for-user", async (_event) => {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    const [orgProjects, personalProjects] = await Promise.all([
      cloudProjects.getOrganizationProjects(user.id),
      cloudProjects.getPersonalProjects(user.id),
    ]);

    return [...orgProjects, ...personalProjects];
  } catch (err) {
    return [];
  }
});

/**
 * Get project by ID
 */
ipcMain.handle("get-project-by-id", async (_event, id: number | string) => {
  try {
    const projectId = String(id);
    return await cloudProjects.getCloudProjectById(projectId);
  } catch (err) {
    return null;
  }
});

/**
 * Update a project
 */
ipcMain.handle(
  "update-project",
  async (
    _event,
    id: number | string,
    name: string,
    description: string,
    color: string,
  ) => {
    try {
      const projectId = String(id);
      const updates: UpdateCloudProjectData = {
        name,
        description,
        color,
      };

      return await cloudProjects.updateCloudProject(projectId, updates);
    } catch (err) {
      return null;
    }
  },
);

/**
 * Delete a project (soft delete - mark as archived)
 */
ipcMain.handle("delete-project", async (_event, id: number | string) => {
  try {
    await cloudProjects.archiveProject(String(id));
    return true;
  } catch (err) {
    return false;
  }
});

/**
 * Restore an archived project
 */
ipcMain.handle("restore-project", async (_event, id: number | string) => {
  try {
    await cloudProjects.restoreProject(String(id));
    return true;
  } catch (err) {
    return false;
  }
});

/**
 * Get archived projects
 */
ipcMain.handle("get-archived-projects", async (_event) => {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }
    return await cloudProjects.getArchivedProjects(user.id);
  } catch (err) {
    return [];
  }
});

/**
 * Get project statistics (sessions, time, members)
 */
ipcMain.handle(
  "get-project-stats",
  async (_event, projectId: number | string) => {
    try {
      const stats = await cloudProjects.getProjectStats(String(projectId));
      return {
        total_sessions: stats.total_sessions,
        total_time: stats.total_time_seconds,
        member_count: stats.total_members,
        last_activity: stats.last_activity,
      };
    } catch (err) {
      return {
        total_sessions: 0,
        total_time: 0,
        member_count: 0,
        last_activity: null,
      };
    }
  },
);

// ========== Project Member Management ==========

/**
 * Add a member to a project
 */
ipcMain.handle(
  "add-project-member",
  async (
    _event,
    projectId: number | string,
    userId: number | string,
    role?: "manager" | "member",
  ) => {
    try {
      const memberData: AssignProjectMemberData = {
        project_id: String(projectId),
        user_id: String(userId),
        role: role || "member",
      };

      return await cloudProjects.assignMemberToProject(memberData);
    } catch (err) {
      return null;
    }
  },
);

/**
 * Remove a member from a project
 */
ipcMain.handle(
  "remove-project-member",
  async (_event, projectId: number | string, userId: number | string) => {
    try {
      await cloudProjects.removeMemberFromProject(
        String(projectId),
        String(userId),
      );
      return true;
    } catch (err) {
      return false;
    }
  },
);

/**
 * Update a project member's role
 */
ipcMain.handle(
  "update-project-member-role",
  async (
    _event,
    projectId: number | string,
    userId: number | string,
    role: "manager" | "member",
  ) => {
    try {
      return await cloudProjects.updateProjectMemberRole(
        String(projectId),
        String(userId),
        role,
      );
    } catch (err) {
      return null;
    }
  },
);

/**
 * Transfer project management to another user
 * Note: This updates the manager_id field in cloud_projects
 */
ipcMain.handle(
  "transfer-project-management",
  async (_event, projectId: number | string, newManagerId: number | string) => {
    try {
      const updates: UpdateCloudProjectData = {
        manager_id: String(newManagerId),
      };

      return await cloudProjects.updateCloudProject(String(projectId), updates);
    } catch (err) {
      return null;
    }
  },
);

/**
 * Get all members of a project
 */
ipcMain.handle(
  "get-project-members",
  async (_event, projectId: number | string) => {
    try {
      return await cloudProjects.getProjectMembers(String(projectId));
    } catch (err) {
      return [];
    }
  },
);

// ========== Data Migration Handlers (Deprecated) ==========
// These handlers are kept for backwards compatibility but return empty data

/**
 * Get all projects data (for migration)
 * Deprecated: No longer needed with Supabase
 */
ipcMain.handle("get-all-projects-data", async (_event) => {
  return [];
});

/**
 * Clear all projects (for migration)
 * Deprecated: No longer needed with Supabase
 */
ipcMain.handle("clear-projects", async (_event) => {
  return true;
});

/**
 * Import projects (for migration)
 * Deprecated: No longer needed with Supabase
 */
ipcMain.handle("import-projects", async (_event, _projectsArr: any[]) => {
  return true;
});
