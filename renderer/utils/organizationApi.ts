/**
 * Organization API for Renderer Process
 * Provides typed wrappers around IPC calls to organization handlers
 */

import { supabase } from "../../src/supabase/client";
import { getCurrentUserIdSafe } from "./userUtils";
import { safeIpcInvoke } from "./ipcHelpers";
import type {
  Organization,
  OrganizationWithStats,
  UserProfile,
  OrgJoinRequest,
  OrgJoinRequestWithUser,
  OrgInviteCode,
  CreateInviteCodeData,
  JoinWithCodeResult,
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
  return await safeIpcInvoke<Organization | null>("org:get-current", [], {
    fallback: null,
    showNotification: false,
  });
}

export async function getOrganizationById(
  orgId: string,
): Promise<OrganizationWithStats | null> {
  return await safeIpcInvoke<OrganizationWithStats | null>(
    "org:get-by-id",
    [orgId],
    { fallback: null },
  );
}

export async function getOrganizationMembers(
  orgId: string,
): Promise<UserProfile[]> {
  return await safeIpcInvoke<UserProfile[]>("org:get-members", [orgId], {
    fallback: [],
  });
}

export async function createTeamOrganization(
  data: CreateOrganizationData,
): Promise<Organization> {
  return await safeIpcInvoke<Organization>("org:create-team", [data]);
}

export async function createPersonalOrganization(
  orgName: string,
): Promise<{ org_id: string }> {
  return await safeIpcInvoke<{ org_id: string }>("org:create-personal", [
    orgName,
  ]);
}

export async function updateOrganization(
  orgId: string,
  updates: Partial<CreateOrganizationData>,
): Promise<Organization> {
  return await safeIpcInvoke<Organization>("org:update", [orgId, updates]);
}

export async function updateUserRole(
  userId: string,
  role: "admin" | "manager" | "employee",
): Promise<UserProfile> {
  return await safeIpcInvoke<UserProfile>("org:update-user-role", [
    userId,
    role,
  ]);
}

export async function removeUserFromOrganization(
  userId: string,
): Promise<void> {
  return await safeIpcInvoke<void>("org:remove-user", [userId]);
}

export async function getCurrentUserProfile(): Promise<UserProfile | null> {
  return await safeIpcInvoke<UserProfile | null>(
    "org:get-current-user-profile",
    [],
    { fallback: null, showNotification: false },
  );
}

// =====================================================
// JOIN REQUESTS
// =====================================================

export async function requestToJoinOrganization(
  orgId: string,
): Promise<OrgJoinRequest> {
  return await safeIpcInvoke<OrgJoinRequest>("org:request-join", [orgId]);
}

export async function getMyJoinRequests(): Promise<OrgJoinRequestWithUser[]> {
  return await safeIpcInvoke<OrgJoinRequestWithUser[]>(
    "org:get-my-requests",
    [],
    { fallback: [] },
  );
}

export async function getPendingJoinRequests(): Promise<
  OrgJoinRequestWithUser[]
> {
  return await safeIpcInvoke<OrgJoinRequestWithUser[]>(
    "org:get-pending-requests",
    [],
    { fallback: [] },
  );
}

export async function approveJoinRequest(requestId: string): Promise<void> {
  return await safeIpcInvoke<void>("org:approve-request", [requestId]);
}

export async function rejectJoinRequest(requestId: string): Promise<void> {
  return await safeIpcInvoke<void>("org:reject-request", [requestId]);
}

export async function cancelJoinRequest(requestId: string): Promise<void> {
  return await safeIpcInvoke<void>("org:cancel-request", [requestId]);
}

// =====================================================
// INVITE CODES
// =====================================================

export async function generateInviteCode(
  data: CreateInviteCodeData = {},
): Promise<OrgInviteCode> {
  return await safeIpcInvoke<OrgInviteCode>("org:generate-invite-code", [data]);
}

export async function listInviteCodes(orgId: string): Promise<OrgInviteCode[]> {
  return await safeIpcInvoke<OrgInviteCode[]>(
    "org:list-invite-codes",
    [orgId],
    {
      fallback: [],
    },
  );
}

export async function revokeInviteCode(codeId: string): Promise<boolean> {
  return await safeIpcInvoke<boolean>("org:revoke-invite-code", [codeId]);
}

export async function joinWithInviteCode(
  code: string,
): Promise<JoinWithCodeResult> {
  return await safeIpcInvoke<JoinWithCodeResult>("org:join-with-code", [code]);
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
    .from("cloud_projects")
    .select(
      `
      *,
      manager:user_profiles!manager_id (
        username,
        email
      )
    `,
    )
    .eq("org_id", userOrgId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []) as CloudProjectWithManager[];
}

export async function getCloudProjectById(
  projectId: string,
): Promise<CloudProjectWithManager | null> {
  return await safeIpcInvoke<CloudProjectWithManager | null>(
    "org:get-project-by-id",
    [projectId],
    { fallback: null },
  );
}

export async function createCloudProject(
  data: CreateCloudProjectData,
): Promise<CloudProject> {
  return await safeIpcInvoke<CloudProject>("org:create-project", [data]);
}

export async function updateCloudProject(
  projectId: string,
  updates: UpdateCloudProjectData,
): Promise<CloudProject> {
  return await safeIpcInvoke<CloudProject>("org:update-project", [
    projectId,
    updates,
  ]);
}

export async function getProjectMembers(
  projectId: string,
): Promise<ProjectMember[]> {
  return await safeIpcInvoke<ProjectMember[]>(
    "org:get-project-members",
    [projectId],
    { fallback: [] },
  );
}

export async function assignMemberToProject(
  data: AssignProjectMemberData,
): Promise<ProjectMember> {
  return await safeIpcInvoke<ProjectMember>("org:assign-project-member", [
    data,
  ]);
}

export async function removeMemberFromProject(
  projectId: string,
  userId: string,
): Promise<void> {
  return await safeIpcInvoke<void>("org:remove-project-member", [
    projectId,
    userId,
  ]);
}

export async function updateProjectMemberRole(
  projectId: string,
  userId: string,
  role: "manager" | "member",
): Promise<ProjectMember> {
  return await safeIpcInvoke<ProjectMember>("org:update-project-member-role", [
    projectId,
    userId,
    role,
  ]);
}
