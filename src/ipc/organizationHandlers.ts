/**
 * Organization IPC Handlers
 * Bridges renderer process to Supabase organization APIs
 */

import { ipcMain } from "electron";
import * as orgApi from "../supabase/organizations";
import * as orgRequestsApi from "../supabase/orgRequests";
import * as cloudProjectsApi from "../supabase/cloudProjects";
import type {
  CreateOrganizationData,
  CreateCloudProjectData,
  UpdateCloudProjectData,
  AssignProjectMemberData,
} from "../types/organization.types";

// =====================================================
// ORGANIZATION MANAGEMENT
// =====================================================

/**
 * Get current user's organization
 */
ipcMain.handle("org:get-current", async (_event, userId?: string) =>
  orgApi.getCurrentOrganization(userId)
);

/**
 * Get organization by ID with stats
 */
ipcMain.handle("org:get-by-id", async (_event, orgId: string) =>
  orgApi.getOrganizationById(orgId)
);

/**
 * Get organization members
 */
ipcMain.handle("org:get-members", async (_event, orgId: string) =>
  orgApi.getOrganizationMembers(orgId)
);

/**
 * Create a team organization
 */
ipcMain.handle(
  "org:create-team",
  async (_event, data: CreateOrganizationData) =>
    orgApi.createTeamOrganization(data)
);

/**
 * Update organization
 */
ipcMain.handle(
  "org:update",
  async (_event, orgId: string, updates: Partial<CreateOrganizationData>) =>
    orgApi.updateOrganization(orgId, updates)
);

/**
 * Update user role
 */
ipcMain.handle(
  "org:update-user-role",
  async (_event, userId: string, role: "admin" | "manager" | "employee") =>
    orgApi.updateUserRole(userId, role)
);

/**
 * Remove user from organization
 */
ipcMain.handle("org:remove-user", async (_event, userId: string) =>
  orgApi.removeUserFromOrganization(userId)
);

/**
 * Get current user profile from Supabase
 */
ipcMain.handle(
  "org:get-current-user-profile",
  async (_event, userId?: string) => orgApi.getCurrentUserProfile(userId)
);

// =====================================================
// JOIN REQUESTS
// =====================================================

/**
 * Request to join an organization
 */
ipcMain.handle(
  "org:request-join",
  async (_event, orgId: string, userId?: string) =>
    orgRequestsApi.requestToJoinOrganization(orgId, userId)
);

/**
 * Get user's join requests
 */
ipcMain.handle("org:get-my-requests", async (_event, userId?: string) =>
  orgRequestsApi.getMyJoinRequests(userId)
);

/**
 * Get pending join requests (admin only)
 */
ipcMain.handle("org:get-pending-requests", async (_event, userId?: string) =>
  orgRequestsApi.getPendingJoinRequests(userId)
);

/**
 * Approve join request (admin only)
 */
ipcMain.handle("org:approve-request", async (_event, requestId: string) =>
  orgRequestsApi.approveJoinRequest(requestId)
);

/**
 * Reject join request (admin only)
 */
ipcMain.handle("org:reject-request", async (_event, requestId: string) =>
  orgRequestsApi.rejectJoinRequest(requestId)
);

/**
 * Cancel own join request
 */
ipcMain.handle(
  "org:cancel-request",
  async (_event, requestId: string, userId?: string) =>
    orgRequestsApi.cancelJoinRequest(requestId, userId)
);

// =====================================================
// CLOUD PROJECTS (Organization-level)
// =====================================================

/**
 * Get organization projects from cloud
 */
ipcMain.handle("org:get-projects", async (_event, userId?: string) =>
  cloudProjectsApi.getOrganizationProjects(userId)
);

/**
 * Get cloud project by ID
 */
ipcMain.handle("org:get-project-by-id", async (_event, projectId: string) =>
  cloudProjectsApi.getCloudProjectById(projectId)
);

/**
 * Get cloud project by local_id (links to SQLite)
 */
ipcMain.handle("org:get-project-by-local-id", async (_event, localId: string) =>
  cloudProjectsApi.getCloudProjectByLocalId(localId)
);

/**
 * Create cloud project
 */
ipcMain.handle(
  "org:create-project",
  async (_event, data: CreateCloudProjectData, userId?: string) =>
    cloudProjectsApi.createCloudProject(data, userId)
);

/**
 * Update cloud project
 */
ipcMain.handle(
  "org:update-project",
  async (_event, projectId: string, updates: UpdateCloudProjectData) =>
    cloudProjectsApi.updateCloudProject(projectId, updates)
);

/**
 * Link local project to cloud project
 */
ipcMain.handle(
  "org:link-local-project",
  async (_event, cloudProjectId: string, localId: string) =>
    cloudProjectsApi.linkLocalProject(cloudProjectId, localId)
);

/**
 * Get project members
 */
ipcMain.handle("org:get-project-members", async (_event, projectId: string) =>
  cloudProjectsApi.getProjectMembers(projectId)
);

/**
 * Assign member to project
 */
ipcMain.handle(
  "org:assign-project-member",
  async (_event, data: AssignProjectMemberData) =>
    cloudProjectsApi.assignMemberToProject(data)
);

/**
 * Remove member from project
 */
ipcMain.handle(
  "org:remove-project-member",
  async (_event, projectId: string, userId: string) =>
    cloudProjectsApi.removeMemberFromProject(projectId, userId)
);

/**
 * Update project member role
 */
ipcMain.handle(
  "org:update-project-member-role",
  async (
    _event,
    projectId: string,
    userId: string,
    role: "manager" | "member"
  ) => cloudProjectsApi.updateProjectMemberRole(projectId, userId, role)
);
