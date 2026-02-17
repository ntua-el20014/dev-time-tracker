/**
 * Organization IPC Handlers
 * Bridges renderer process to Supabase organization APIs
 */

import { ipcMain } from "electron";
import * as orgApi from "../supabase/organizations";
import * as orgRequestsApi from "../supabase/orgRequests";
import * as orgInviteCodesApi from "../supabase/orgInviteCodes";
import * as cloudProjectsApi from "../supabase/cloudProjects";
import { getCurrentUser } from "../supabase/api";
import type {
  CreateOrganizationData,
  CreateCloudProjectData,
  UpdateCloudProjectData,
  AssignProjectMemberData,
  CreateInviteCodeData,
} from "../types/organization.types";
import { logError } from "../utils/errorHandler";

// =====================================================
// ORGANIZATION MANAGEMENT
// =====================================================

/**
 * Get current user's organization
 */
ipcMain.handle("org:get-current", async (_event) => {
  try {
    const user = await getCurrentUser();
    if (!user) return null;
    return await orgApi.getCurrentOrganization(user.id);
  } catch (err) {
    logError("org:get-current", err);
    return null;
  }
});

/**
 * Get organization by ID with stats
 */
ipcMain.handle("org:get-by-id", async (_event, orgId: string) => {
  try {
    return await orgApi.getOrganizationById(orgId);
  } catch (err) {
    logError("org:get-by-id", err);
    return null;
  }
});

/**
 * Get organization members
 */
ipcMain.handle("org:get-members", async (_event, orgId: string) => {
  try {
    return await orgApi.getOrganizationMembers(orgId);
  } catch (err) {
    logError("org:get-members", err);
    return [];
  }
});

/**
 * Create a team organization
 */
ipcMain.handle(
  "org:create-team",
  async (_event, data: CreateOrganizationData) => {
    try {
      return await orgApi.createTeamOrganization(data);
    } catch (err) {
      logError("org:create-team", err);
      return null;
    }
  },
);

/**
 * Create a personal organization (for users with no org)
 */
ipcMain.handle("org:create-personal", async (_event, orgName: string) => {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");
    return await orgApi.createPersonalOrganization(user.id, orgName);
  } catch (err) {
    logError("org:create-personal", err);
    throw err;
  }
});

/**
 * Update organization
 */
ipcMain.handle(
  "org:update",
  async (_event, orgId: string, updates: Partial<CreateOrganizationData>) => {
    try {
      return await orgApi.updateOrganization(orgId, updates);
    } catch (err) {
      logError("org:update", err);
      return null;
    }
  },
);

/**
 * Update user role
 */
ipcMain.handle(
  "org:update-user-role",
  async (_event, userId: string, role: "admin" | "manager" | "employee") => {
    try {
      await orgApi.updateUserRole(userId, role);
      return true;
    } catch (err) {
      logError("org:update-user-role", err);
      return false;
    }
  },
);

/**
 * Remove user from organization
 */
ipcMain.handle("org:remove-user", async (_event, userId: string) => {
  try {
    await orgApi.removeUserFromOrganization(userId);
    return true;
  } catch (err) {
    logError("org:remove-user", err);
    return false;
  }
});

/**
 * Get current user profile from Supabase
 */
ipcMain.handle("org:get-current-user-profile", async (_event) => {
  try {
    const user = await getCurrentUser();
    if (!user) return null;
    return await orgApi.getCurrentUserProfile(user.id);
  } catch (err) {
    logError("org:get-current-user-profile", err);
    return null;
  }
});

// =====================================================
// JOIN REQUESTS
// =====================================================

/**
 * Request to join an organization
 */
ipcMain.handle("org:request-join", async (_event, orgId: string) => {
  try {
    const user = await getCurrentUser();
    if (!user) return null;
    return await orgRequestsApi.requestToJoinOrganization(orgId, user.id);
  } catch (err) {
    logError("org:request-join", err);
    return null;
  }
});

/**
 * Get user's join requests
 */
ipcMain.handle("org:get-my-requests", async (_event) => {
  try {
    const user = await getCurrentUser();
    if (!user) return [];
    return await orgRequestsApi.getMyJoinRequests(user.id);
  } catch (err) {
    logError("org:get-my-requests", err);
    return [];
  }
});

/**
 * Get pending join requests (admin only)
 */
ipcMain.handle("org:get-pending-requests", async (_event) => {
  try {
    const user = await getCurrentUser();
    if (!user) return [];
    return await orgRequestsApi.getPendingJoinRequests(user.id);
  } catch (err) {
    logError("org:get-pending-requests", err);
    return [];
  }
});

/**
 * Approve join request (admin only)
 */
ipcMain.handle("org:approve-request", async (_event, requestId: string) => {
  try {
    await orgRequestsApi.approveJoinRequest(requestId);
    return true;
  } catch (err) {
    logError("org:approve-request", err);
    return false;
  }
});

/**
 * Reject join request (admin only)
 */
ipcMain.handle("org:reject-request", async (_event, requestId: string) => {
  try {
    await orgRequestsApi.rejectJoinRequest(requestId);
    return true;
  } catch (err) {
    logError("org:reject-request", err);
    return false;
  }
});

/**
 * Cancel own join request
 */
ipcMain.handle("org:cancel-request", async (_event, requestId: string) => {
  try {
    const user = await getCurrentUser();
    if (!user) return false;
    await orgRequestsApi.cancelJoinRequest(requestId, user.id);
    return true;
  } catch (err) {
    logError("org:cancel-request", err);
    return false;
  }
});

// =====================================================
// INVITE CODES
// =====================================================

/**
 * Generate a new invite code for the user's organization
 */
ipcMain.handle(
  "org:generate-invite-code",
  async (_event, data: CreateInviteCodeData) => {
    try {
      return await orgInviteCodesApi.generateInviteCode(data);
    } catch (err) {
      logError("org:generate-invite-code", err);
      throw err;
    }
  },
);

/**
 * List invite codes for an organization
 */
ipcMain.handle("org:list-invite-codes", async (_event, orgId: string) => {
  try {
    return await orgInviteCodesApi.listInviteCodes(orgId);
  } catch (err) {
    logError("org:list-invite-codes", err);
    return [];
  }
});

/**
 * Revoke an invite code
 */
ipcMain.handle("org:revoke-invite-code", async (_event, codeId: string) => {
  try {
    await orgInviteCodesApi.revokeInviteCode(codeId);
    return true;
  } catch (err) {
    logError("org:revoke-invite-code", err);
    return false;
  }
});

/**
 * Join an organization with an invite code
 */
ipcMain.handle("org:join-with-code", async (_event, code: string) => {
  try {
    return await orgInviteCodesApi.joinWithInviteCode(code);
  } catch (err) {
    logError("org:join-with-code", err);
    throw err;
  }
});

// =====================================================
// CLOUD PROJECTS (Organization-level)
// =====================================================

/**
 * Get organization projects from cloud
 */
ipcMain.handle("org:get-projects", async (_event) => {
  try {
    const user = await getCurrentUser();
    if (!user) return [];
    return await cloudProjectsApi.getOrganizationProjects(user.id);
  } catch (err) {
    logError("org:get-projects", err);
    return [];
  }
});

/**
 * Get cloud project by ID
 */
ipcMain.handle("org:get-project-by-id", async (_event, projectId: string) => {
  try {
    return await cloudProjectsApi.getCloudProjectById(projectId);
  } catch (err) {
    logError("org:get-project-by-id", err);
    return null;
  }
});

/**
 * Create cloud project
 */
ipcMain.handle(
  "org:create-project",
  async (_event, data: CreateCloudProjectData) => {
    try {
      const user = await getCurrentUser();
      if (!user) return null;
      return await cloudProjectsApi.createCloudProject(data, user.id);
    } catch (err) {
      logError("org:create-project", err);
      return null;
    }
  },
);

/**
 * Update cloud project
 */
ipcMain.handle(
  "org:update-project",
  async (_event, projectId: string, updates: UpdateCloudProjectData) => {
    try {
      return await cloudProjectsApi.updateCloudProject(projectId, updates);
    } catch (err) {
      logError("org:update-project", err);
      return null;
    }
  },
);

/**
 * Get project members
 */
ipcMain.handle("org:get-project-members", async (_event, projectId: string) => {
  try {
    return await cloudProjectsApi.getProjectMembers(projectId);
  } catch (err) {
    logError("org:get-project-members", err);
    return [];
  }
});

/**
 * Assign member to project
 */
ipcMain.handle(
  "org:assign-project-member",
  async (_event, data: AssignProjectMemberData) => {
    try {
      return await cloudProjectsApi.assignMemberToProject(data);
    } catch (err) {
      logError("org:assign-project-member", err);
      return null;
    }
  },
);

/**
 * Remove member from project
 */
ipcMain.handle(
  "org:remove-project-member",
  async (_event, projectId: string, userId: string) => {
    try {
      await cloudProjectsApi.removeMemberFromProject(projectId, userId);
      return true;
    } catch (err) {
      logError("org:remove-project-member", err);
      return false;
    }
  },
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
    role: "manager" | "member",
  ) => {
    try {
      return await cloudProjectsApi.updateProjectMemberRole(
        projectId,
        userId,
        role,
      );
    } catch (err) {
      logError("org:update-project-member-role", err);
      return null;
    }
  },
);
