/**
 * Organization API for Renderer Process
 * Provides typed wrappers around IPC calls to organization handlers
 */

import { ipcRenderer } from "electron";
import { supabase } from "../../src/supabase/client";
import { getCurrentUserIdSafe } from "./userUtils";
import type {
  Organization,
  OrganizationWithStats,
  UserProfile,
  OrgJoinRequest,
  OrgJoinRequestWithUser,
  CloudProject,
  CloudProjectWithManager,
  ProjectMember,
  CreateOrganizationData,
  CreateCloudProjectData,
  UpdateCloudProjectData,
  AssignProjectMemberData,
} from "../../src/types/organization.types";

// =====================================================
// ORGANIZATION MANAGEMENT
// =====================================================

export async function getCurrentOrganization(): Promise<Organization | null> {
  const userId = getCurrentUserIdSafe();
  return await ipcRenderer.invoke("org:get-current", userId);
}

export async function getOrganizationById(
  orgId: string
): Promise<OrganizationWithStats | null> {
  return await ipcRenderer.invoke("org:get-by-id", orgId);
}

export async function getOrganizationMembers(
  orgId: string
): Promise<UserProfile[]> {
  return await ipcRenderer.invoke("org:get-members", orgId);
}

export async function createTeamOrganization(
  data: CreateOrganizationData
): Promise<Organization> {
  return await ipcRenderer.invoke("org:create-team", data);
}

export async function updateOrganization(
  orgId: string,
  updates: Partial<CreateOrganizationData>
): Promise<Organization> {
  return await ipcRenderer.invoke("org:update", orgId, updates);
}

export async function updateUserRole(
  userId: string,
  role: "admin" | "manager" | "employee"
): Promise<UserProfile> {
  return await ipcRenderer.invoke("org:update-user-role", userId, role);
}

export async function removeUserFromOrganization(
  userId: string
): Promise<void> {
  return await ipcRenderer.invoke("org:remove-user", userId);
}

export async function getCurrentUserProfile(): Promise<UserProfile | null> {
  const userId = getCurrentUserIdSafe();
  return await ipcRenderer.invoke("org:get-current-user-profile", userId);
}

// =====================================================
// JOIN REQUESTS
// =====================================================

export async function requestToJoinOrganization(
  orgId: string
): Promise<OrgJoinRequest> {
  const userId = getCurrentUserIdSafe();
  return await ipcRenderer.invoke("org:request-join", orgId, userId);
}

export async function getMyJoinRequests(): Promise<OrgJoinRequestWithUser[]> {
  const userId = getCurrentUserIdSafe();
  return await ipcRenderer.invoke("org:get-my-requests", userId);
}

export async function getPendingJoinRequests(): Promise<
  OrgJoinRequestWithUser[]
> {
  const userId = getCurrentUserIdSafe();
  return await ipcRenderer.invoke("org:get-pending-requests", userId);
}

export async function approveJoinRequest(requestId: string): Promise<void> {
  return await ipcRenderer.invoke("org:approve-request", requestId);
}

export async function rejectJoinRequest(requestId: string): Promise<void> {
  return await ipcRenderer.invoke("org:reject-request", requestId);
}

export async function cancelJoinRequest(requestId: string): Promise<void> {
  const userId = getCurrentUserIdSafe();
  return await ipcRenderer.invoke("org:cancel-request", requestId, userId);
}

// =====================================================
// CLOUD PROJECTS (Organization-level)
// =====================================================

export async function getOrganizationProjects(): Promise<
  CloudProjectWithManager[]
> {
  const userId = getCurrentUserIdSafe();
  if (!userId) return [];

  // Call Supabase directly from renderer (has auth context)
  // Get user's org_id
  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("org_id")
    .eq("id", userId)
    .limit(1);

  if (!profiles || profiles.length === 0 || !(profiles[0] as any)?.org_id) {
    return [];
  }

  const userOrgId = (profiles[0] as any).org_id;

  // Get projects with manager info
  const { data, error } = await supabase
    .from("projects")
    .select(
      `
      *,
      manager:user_profiles!manager_id (
        username,
        email
      )
    `
    )
    .eq("org_id", userOrgId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []) as CloudProjectWithManager[];
}

export async function getCloudProjectById(
  projectId: string
): Promise<CloudProjectWithManager | null> {
  return await ipcRenderer.invoke("org:get-project-by-id", projectId);
}

export async function getCloudProjectByLocalId(
  localId: string
): Promise<CloudProject | null> {
  return await ipcRenderer.invoke("org:get-project-by-local-id", localId);
}

export async function createCloudProject(
  data: CreateCloudProjectData
): Promise<CloudProject> {
  const userId = getCurrentUserIdSafe();
  return await ipcRenderer.invoke("org:create-project", data, userId);
}

export async function updateCloudProject(
  projectId: string,
  updates: UpdateCloudProjectData
): Promise<CloudProject> {
  return await ipcRenderer.invoke("org:update-project", projectId, updates);
}

export async function linkLocalProject(
  cloudProjectId: string,
  localId: string
): Promise<CloudProject> {
  return await ipcRenderer.invoke(
    "org:link-local-project",
    cloudProjectId,
    localId
  );
}

export async function getProjectMembers(
  projectId: string
): Promise<ProjectMember[]> {
  return await ipcRenderer.invoke("org:get-project-members", projectId);
}

export async function assignMemberToProject(
  data: AssignProjectMemberData
): Promise<ProjectMember> {
  return await ipcRenderer.invoke("org:assign-project-member", data);
}

export async function removeMemberFromProject(
  projectId: string,
  userId: string
): Promise<void> {
  return await ipcRenderer.invoke(
    "org:remove-project-member",
    projectId,
    userId
  );
}

export async function updateProjectMemberRole(
  projectId: string,
  userId: string,
  role: "manager" | "member"
): Promise<ProjectMember> {
  return await ipcRenderer.invoke(
    "org:update-project-member-role",
    projectId,
    userId,
    role
  );
}
