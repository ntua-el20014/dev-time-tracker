import db from "./db";
import { notifyRenderer } from "../utils/ipcHelp";
import { v4 as uuidv4 } from "uuid";
import { Project, ProjectWithMembers } from "../../shared/types";
import { isUserManagerOrAdmin } from "./users";

// --- Project management functions ---

export function createProject(
  name: string,
  description: string = "",
  color: string = "#3b82f6",
  managerId: number
): number | undefined {
  try {
    // Validate that the manager has appropriate permissions
    if (!isUserManagerOrAdmin(managerId)) {
      notifyRenderer(
        "Only admins and managers can be assigned as project managers.",
        5000
      );
      return undefined;
    }

    const info = db
      .prepare(
        `INSERT INTO projects (local_id, name, description, color, manager_id, synced, last_modified) VALUES (?, ?, ?, ?, ?, 0, ?)`
      )
      .run(
        uuidv4(),
        name,
        description,
        color,
        managerId,
        new Date().toISOString()
      );

    const projectId = info.lastInsertRowid as number;

    // Add the manager as a project member with manager role
    db.prepare(
      `INSERT INTO project_members (local_id, project_id, user_id, role, synced, last_modified) VALUES (?, ?, ?, 'manager', 0, ?)`
    ).run(uuidv4(), projectId, managerId, new Date().toISOString());

    notifyRenderer(`Project "${name}" created successfully!`);
    return projectId;
  } catch (err) {
    if ((err as any).code === "SQLITE_CONSTRAINT_UNIQUE") {
      notifyRenderer("A project with this name already exists.", 5000);
    } else {
      notifyRenderer("Failed to create project.", 5000);
    }
    return undefined;
  }
}

export function getAllProjects(): Project[] {
  try {
    return db
      .prepare(
        `SELECT * FROM projects WHERE is_active = 1 ORDER BY name COLLATE NOCASE`
      )
      .all() as Project[];
  } catch (err) {
    notifyRenderer("Failed to load projects.", 5000);
    return [];
  }
}

export function getProjectsForUser(userId: number): ProjectWithMembers[] {
  try {
    return db
      .prepare(
        `
        SELECT 
          p.*,
          u.username as manager_name
        FROM projects p 
        LEFT JOIN users u ON p.manager_id = u.id
        INNER JOIN project_members pm ON p.id = pm.project_id 
        WHERE pm.user_id = ? AND p.is_active = 1 
        ORDER BY p.name COLLATE NOCASE
      `
      )
      .all(userId) as ProjectWithMembers[];
  } catch (err) {
    notifyRenderer("Failed to load user projects.", 5000);
    return [];
  }
}

export function getAllProjectsWithMembers(): ProjectWithMembers[] {
  try {
    const projects = db
      .prepare(
        `
        SELECT 
          p.*,
          u.username as manager_name
        FROM projects p 
        LEFT JOIN users u ON p.manager_id = u.id
        ORDER BY p.name COLLATE NOCASE
      `
      )
      .all() as ProjectWithMembers[];

    // Get members for each project
    projects.forEach((project) => {
      project.members = db
        .prepare(
          `
          SELECT 
            pm.*,
            u.username
          FROM project_members pm
          LEFT JOIN users u ON pm.user_id = u.id
          WHERE pm.project_id = ?
          ORDER BY pm.role DESC, u.username
        `
        )
        .all(project.id) as any[];
    });

    return projects;
  } catch (err) {
    notifyRenderer("Failed to load projects with members.", 5000);
    return [];
  }
}

export function getProjectById(id: number): Project | undefined {
  try {
    return db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as
      | Project
      | undefined;
  } catch (err) {
    notifyRenderer("Failed to load project.", 5000);
    return undefined;
  }
}

export function updateProject(
  id: number,
  name: string,
  description: string = "",
  color: string = "#3b82f6"
) {
  try {
    db.prepare(
      `UPDATE projects SET name = ?, description = ?, color = ?, synced = 0, last_modified = ? WHERE id = ?`
    ).run(name, description, color, new Date().toISOString(), id);

    notifyRenderer(`Project "${name}" updated successfully!`);
  } catch (err) {
    notifyRenderer("Failed to update project.", 5000);
  }
}

export function deleteProject(id: number) {
  try {
    // Instead of deleting, mark as inactive to preserve session history
    db.prepare(
      `UPDATE projects SET is_active = 0, synced = 0, last_modified = ? WHERE id = ?`
    ).run(new Date().toISOString(), id);
    notifyRenderer("Project archived successfully!");
  } catch (err) {
    notifyRenderer("Failed to archive project.", 5000);
  }
}

export function restoreProject(id: number) {
  try {
    db.prepare(
      `UPDATE projects SET is_active = 1, synced = 0, last_modified = ? WHERE id = ?`
    ).run(new Date().toISOString(), id);
    notifyRenderer("Project restored successfully!");
  } catch (err) {
    notifyRenderer("Failed to restore project.", 5000);
  }
}

export function getArchivedProjects(): Project[] {
  try {
    return db
      .prepare(
        `SELECT * FROM projects WHERE is_active = 0 ORDER BY name COLLATE NOCASE`
      )
      .all() as Project[];
  } catch (err) {
    notifyRenderer("Failed to load archived projects.", 5000);
    return [];
  }
}

// --- Project member management functions ---

export function addProjectMember(
  projectId: number,
  userId: number,
  role: "manager" | "member" = "member"
) {
  try {
    // If assigning manager role, validate that the user has appropriate permissions
    if (role === "manager" && !isUserManagerOrAdmin(userId)) {
      notifyRenderer(
        "Only admins and managers can be assigned as project managers.",
        5000
      );
      return;
    }

    db.prepare(
      `INSERT OR IGNORE INTO project_members (local_id, project_id, user_id, role, synced, last_modified) VALUES (?, ?, ?, ?, 0, ?)`
    ).run(uuidv4(), projectId, userId, role, new Date().toISOString());
    notifyRenderer("User added to project successfully!");
  } catch (err) {
    notifyRenderer("Failed to add user to project.", 5000);
  }
}

export function removeProjectMember(projectId: number, userId: number) {
  try {
    // Don't allow removing the project manager
    const project = getProjectById(projectId);
    if (project && project.manager_id === userId) {
      notifyRenderer(
        "Cannot remove the project manager. Transfer management first.",
        5000
      );
      return;
    }

    db.prepare(
      `DELETE FROM project_members WHERE project_id = ? AND user_id = ?`
    ).run(projectId, userId);
    notifyRenderer("User removed from project successfully!");
  } catch (err) {
    notifyRenderer("Failed to remove user from project.", 5000);
  }
}

export function updateProjectMemberRole(
  projectId: number,
  userId: number,
  role: "manager" | "member"
) {
  try {
    // If assigning manager role, validate that the user has appropriate permissions
    if (role === "manager" && !isUserManagerOrAdmin(userId)) {
      notifyRenderer(
        "Only admins and managers can be assigned as project managers.",
        5000
      );
      return;
    }

    db.prepare(
      `UPDATE project_members SET role = ?, synced = 0, last_modified = ? WHERE project_id = ? AND user_id = ?`
    ).run(role, new Date().toISOString(), projectId, userId);
    notifyRenderer("User role updated successfully!");
  } catch (err) {
    notifyRenderer("Failed to update user role.", 5000);
  }
}

export function transferProjectManagement(
  projectId: number,
  newManagerId: number
) {
  try {
    // Validate that the new manager has appropriate permissions
    if (!isUserManagerOrAdmin(newManagerId)) {
      notifyRenderer(
        "Only admins and managers can be assigned as project managers.",
        5000
      );
      return;
    }

    db.transaction(() => {
      const now = new Date().toISOString();

      // Update the project manager
      db.prepare(
        `UPDATE projects SET manager_id = ?, synced = 0, last_modified = ? WHERE id = ?`
      ).run(newManagerId, now, projectId);

      // Update the new manager's role in project_members
      db.prepare(
        `INSERT OR REPLACE INTO project_members (local_id, project_id, user_id, role, synced, last_modified) VALUES (?, ?, ?, 'manager', 0, ?)`
      ).run(uuidv4(), projectId, newManagerId, now);
    })();

    notifyRenderer("Project management transferred successfully!");
  } catch (err) {
    notifyRenderer("Failed to transfer project management.", 5000);
  }
}

export function getProjectMembers(projectId: number) {
  try {
    return db
      .prepare(
        `
        SELECT 
          pm.*,
          u.username,
          u.role as user_role
        FROM project_members pm
        LEFT JOIN users u ON pm.user_id = u.id
        WHERE pm.project_id = ?
        ORDER BY pm.role DESC, u.username
      `
      )
      .all(projectId);
  } catch (err) {
    notifyRenderer("Failed to load project members.", 5000);
    return [];
  }
}

export function getUserProjects(userId: number): Project[] {
  try {
    return db
      .prepare(
        `
        SELECT p.* 
        FROM projects p
        INNER JOIN project_members pm ON p.id = pm.project_id
        WHERE pm.user_id = ? AND p.is_active = 1
        ORDER BY p.name COLLATE NOCASE
      `
      )
      .all(userId) as Project[];
  } catch (err) {
    notifyRenderer("Failed to load user projects.", 5000);
    return [];
  }
}

export function getUserProjectsWithMembers(
  userId: number
): ProjectWithMembers[] {
  try {
    const projects = db
      .prepare(
        `
        SELECT 
          p.*,
          u.username as manager_name
        FROM projects p 
        LEFT JOIN users u ON p.manager_id = u.id
        INNER JOIN project_members pm ON p.id = pm.project_id
        WHERE pm.user_id = ?
        ORDER BY p.name COLLATE NOCASE
      `
      )
      .all(userId) as ProjectWithMembers[];

    // Get members for each project
    projects.forEach((project) => {
      project.members = db
        .prepare(
          `
          SELECT 
            pm.*,
            u.username
          FROM project_members pm
          LEFT JOIN users u ON pm.user_id = u.id
          WHERE pm.project_id = ?
          ORDER BY pm.role DESC, u.username
        `
        )
        .all(project.id) as any[];
    });

    return projects;
  } catch (err) {
    notifyRenderer("Failed to load user projects with members.", 5000);
    return [];
  }
}

export function getProjectStats(projectId: number) {
  try {
    const stats = db
      .prepare(
        `
        SELECT 
          COUNT(*) as total_sessions,
          SUM(duration) as total_time,
          SUM(CASE WHEN is_billable = 1 THEN duration ELSE 0 END) as billable_time,
          SUM(CASE WHEN is_billable = 0 THEN duration ELSE 0 END) as non_billable_time,
          MIN(date(timestamp)) as first_session,
          MAX(date(timestamp)) as last_session
        FROM sessions 
        WHERE project_id = ?
        `
      )
      .get(projectId) as any;

    return {
      totalSessions: stats.total_sessions || 0,
      totalTime: stats.total_time || 0,
      billableTime: stats.billable_time || 0,
      nonBillableTime: stats.non_billable_time || 0,
      firstSession: stats.first_session,
      lastSession: stats.last_session,
    };
  } catch (err) {
    notifyRenderer("Failed to load project statistics.", 5000);
    return {
      totalSessions: 0,
      totalTime: 0,
      billableTime: 0,
      nonBillableTime: 0,
      firstSession: null,
      lastSession: null,
    };
  }
}

// Database migration functions
export function getAllProjectsData() {
  return db.prepare("SELECT * FROM projects").all();
}

export function clearProjects() {
  db.prepare("DELETE FROM projects").run();
}

export function importProjects(projectsArr: any[]) {
  const stmt = db.prepare(
    "INSERT INTO projects (id, local_id, name, description, color, is_active, created_by, created_at, manager_id, synced, last_modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const row of projectsArr) {
    stmt.run(
      row.id,
      uuidv4(),
      row.name,
      row.description,
      row.color,
      row.is_active,
      row.created_by,
      row.created_at,
      row.manager_id || row.created_by, // Fall back to created_by if manager_id not set
      0,
      new Date().toISOString()
    );
  }
}
