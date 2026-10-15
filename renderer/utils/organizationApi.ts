/**
 * Organization API for Renderer Process
 * Provides typed wrappers around IPC calls to organization handlers
 */

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
  CreateOrganizationData,
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
): Promise<void> {
  const ok = await safeIpcInvoke<boolean>("org:update-user-role", [
    userId,
    role,
  ]);
  if (!ok) {
    throw new Error("Role update was rejected");
  }
}

export async function removeUserFromOrganization(
  userId: string,
): Promise<void> {
  const ok = await safeIpcInvoke<boolean>("org:remove-user", [userId]);
  if (!ok) {
    throw new Error("Member removal was rejected");
  }
}

export async function leaveOrganization(): Promise<boolean> {
  return await safeIpcInvoke<boolean>("org:leave", []);
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
