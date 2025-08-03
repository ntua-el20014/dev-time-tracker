import { ipcMain } from "electron";
import * as projects from "../backend/projects";

// Project management handlers
ipcMain.handle(
  "create-project",
  (
    _event,
    name: string,
    description: string,
    color: string,
    managerId: number
  ) => {
    return projects.createProject(name, description, color, managerId);
  }
);

ipcMain.handle("get-all-projects", () => {
  return projects.getAllProjects();
});

ipcMain.handle("get-all-projects-with-members", () => {
  return projects.getAllProjectsWithMembers();
});

ipcMain.handle("get-user-projects", (_event, userId: number) => {
  return projects.getUserProjects(userId);
});

ipcMain.handle("get-projects-for-user", (_event, userId: number) => {
  return projects.getProjectsForUser(userId);
});

ipcMain.handle("get-project-by-id", (_event, id: number) => {
  return projects.getProjectById(id);
});

ipcMain.handle(
  "update-project",
  (_event, id: number, name: string, description: string, color: string) => {
    return projects.updateProject(id, name, description, color);
  }
);

ipcMain.handle("delete-project", (_event, id: number) => {
  return projects.deleteProject(id);
});

ipcMain.handle("restore-project", (_event, id: number) => {
  return projects.restoreProject(id);
});

ipcMain.handle("get-archived-projects", () => {
  return projects.getArchivedProjects();
});

ipcMain.handle("get-project-stats", (_event, projectId: number) => {
  return projects.getProjectStats(projectId);
});

// Project member management handlers
ipcMain.handle(
  "add-project-member",
  (_event, projectId: number, userId: number, role?: "manager" | "member") => {
    return projects.addProjectMember(projectId, userId, role);
  }
);

ipcMain.handle(
  "remove-project-member",
  (_event, projectId: number, userId: number) => {
    return projects.removeProjectMember(projectId, userId);
  }
);

ipcMain.handle(
  "update-project-member-role",
  (_event, projectId: number, userId: number, role: "manager" | "member") => {
    return projects.updateProjectMemberRole(projectId, userId, role);
  }
);

ipcMain.handle(
  "transfer-project-management",
  (_event, projectId: number, newManagerId: number) => {
    return projects.transferProjectManagement(projectId, newManagerId);
  }
);

ipcMain.handle("get-project-members", (_event, projectId: number) => {
  return projects.getProjectMembers(projectId);
});

// Database migration handlers
ipcMain.handle("get-all-projects-data", () => {
  return projects.getAllProjectsData();
});

ipcMain.handle("clear-projects", () => {
  return projects.clearProjects();
});

ipcMain.handle("import-projects", (_event, projectsArr: any[]) => {
  return projects.importProjects(projectsArr);
});
