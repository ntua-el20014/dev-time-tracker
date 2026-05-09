/**
 * Organization Management API (Supabase)
 * All organization operations talk directly to Supabase
 */

import { supabase } from "./config";
import type {
  Organization,
  OrganizationWithStats,
  UserProfile,
  CreateOrganizationData,
} from "../types/organization.types";

/**
 * Get current user's active organization
 */
export async function getCurrentOrganization(
  userId?: string,
): Promise<Organization | null> {
  let currentUserId = userId;

  // If userId not provided, try to get from auth
  if (!currentUserId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    currentUserId = user.id;
  }

  // Use SECURITY DEFINER function to bypass RLS
  // @ts-ignore - RPC function not in generated types yet
  const { data, error } = await supabase.rpc("get_organization_by_user_id", {
    p_user_id: currentUserId,
  });

  if (error) throw error;

  // RPC returns an array, get first item
  // @ts-ignore - data type inference issue
  if (data && Array.isArray(data) && data.length > 0) {
    return data[0] as Organization;
  }
  return null;
}

/**
 * Get organization by ID (with stats)
 */
export async function getOrganizationById(
  orgId: string,
): Promise<OrganizationWithStats> {
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", orgId)
    .single();

  if (orgError) throw orgError;

  // Use RPC to get member counts (bypasses RLS)
  const { data: members, error: membersError } = await (supabase.rpc as any)(
    "get_organization_members_by_org_id",
    { p_org_id: orgId },
  );

  if (membersError) throw membersError;

  // Get project count
  const { count: projectCount, error: projectError } = await supabase
    .from("cloud_projects")
    .select("*", { count: "exact", head: true })
    .eq("org_id", orgId);

  if (projectError) throw projectError;

  // Calculate stats
  const memberList = (members || []) as any[];
  const member_count = memberList.length;
  const admin_count = memberList.filter((m: any) => m.role === "admin").length;
  const manager_count = memberList.filter(
    (m: any) => m.role === "manager",
  ).length;
  const employee_count = memberList.filter(
    (m: any) => m.role === "employee",
  ).length;

  return {
    ...(org as Organization),
    member_count,
    admin_count,
    manager_count,
    employee_count,
    project_count: projectCount || 0,
  } as OrganizationWithStats;
}

/**
 * Get all members of an organization
 */
export async function getOrganizationMembers(
  orgId: string,
): Promise<UserProfile[]> {
  // Use SECURITY DEFINER function to bypass RLS
  const { data, error } = await (supabase.rpc as any)(
    "get_organization_members_by_org_id",
    { p_org_id: orgId },
  );

  if (error) throw error;
  return (data || []) as UserProfile[];
}

/**
 * Create a team organization
 * Uses the database function for proper permissions
 */
export async function createTeamOrganization(
  data: CreateOrganizationData,
): Promise<{ org_id: string }> {
  const { data: result, error } = await (supabase.rpc as any)(
    "create_team_organization",
    {
      org_name: data.name,
    },
  );

  if (error) throw error;
  return { org_id: result as string };
}

/**
 * Create a personal organization for a user (no permissions needed)
 * Used when user has no org yet
 */
export async function createPersonalOrganization(
  userId: string,
  orgName: string,
): Promise<{ org_id: string }> {
  const { data: result, error } = await (supabase.rpc as any)(
    "create_personal_organization",
    {
      user_id: userId,
      org_name: orgName,
    },
  );

  if (error) throw error;
  return { org_id: result as string };
}

/**
 * Update organization details (admin only)
 */
export async function updateOrganization(
  orgId: string,
  updates: Partial<CreateOrganizationData>,
): Promise<Organization> {
  // Supabase RLS policies cause update() to be typed as never
  const result = await supabase
    .from("organizations")
    // @ts-ignore - Supabase RLS typing limitation
    .update(updates)
    .eq("id", orgId)
    .select()
    .single();

  if (result.error) throw result.error;
  return result.data as Organization;
}

function getRoleRank(role: "admin" | "manager" | "employee"): number {
  if (role === "admin") return 3;
  if (role === "manager") return 2;
  return 1;
}

async function getUserProfileById(userId: string): Promise<UserProfile | null> {
  const { data, error } = await (supabase.rpc as any)(
    "get_user_profile_by_id",
    {
      p_user_id: userId,
    },
  );

  if (error) throw error;
  if (data && Array.isArray(data) && data.length > 0) {
    return data[0] as UserProfile;
  }
  return null;
}

async function getActorAndTargetProfiles(targetUserId: string): Promise<{
  actor: UserProfile;
  target: UserProfile;
}> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  if (user.id === targetUserId) {
    throw new Error("You cannot modify your own organization role here");
  }

  const actor = await getUserProfileById(user.id);
  const target = await getUserProfileById(targetUserId);

  if (!actor || !actor.org_id) {
    throw new Error("You are not in an organization");
  }
  if (!target || !target.org_id) {
    throw new Error("Target user is not in an organization");
  }
  if (actor.org_id !== target.org_id) {
    throw new Error("You can only manage members in your organization");
  }

  return { actor, target };
}

/**
 * Update a user's role in the organization
 */
export async function updateUserRole(
  userId: string,
  role: "admin" | "manager" | "employee",
): Promise<void> {
  const { actor, target } = await getActorAndTargetProfiles(userId);
  const actorOrgId = actor.org_id;
  if (!actorOrgId) throw new Error("You are not in an organization");

  if (getRoleRank(actor.role) <= getRoleRank(target.role)) {
    throw new Error("You cannot modify members with equal or higher role");
  }

  if (getRoleRank(role) > getRoleRank(actor.role)) {
    throw new Error("You cannot assign a role higher than your own");
  }

  // Supabase RLS policies cause update() to be typed as never
  const result = await supabase
    .from("user_profiles")
    // @ts-ignore - Supabase RLS typing limitation
    .update({ role })
    .eq("id", userId)
    .eq("org_id", actorOrgId);

  if (result.error) throw result.error;
}

/**
 * Remove a user from the organization
 */
export async function removeUserFromOrganization(
  userId: string,
): Promise<void> {
  const { actor, target } = await getActorAndTargetProfiles(userId);
  const actorOrgId = actor.org_id;
  if (!actorOrgId) throw new Error("You are not in an organization");

  if (getRoleRank(actor.role) <= getRoleRank(target.role)) {
    throw new Error("You cannot remove members with equal or higher role");
  }

  // Supabase RLS policies cause update() to be typed as never
  const result = await supabase
    .from("user_profiles")
    // @ts-ignore - Supabase RLS typing limitation
    .update({ org_id: null, role: "employee" })
    .eq("id", userId)
    .eq("org_id", actorOrgId);

  if (result.error) throw result.error;
}

/**
 * Get current user's profile from Supabase
 */
export async function getCurrentUserProfile(
  userId?: string,
): Promise<UserProfile | null> {
  let currentUserId = userId;

  // If userId not provided, try to get from auth
  if (!currentUserId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    currentUserId = user.id;
  }

  // Use SECURITY DEFINER function to bypass RLS
  // @ts-ignore - RPC function not in generated types yet
  const { data, error } = await supabase.rpc("get_user_profile_by_id", {
    p_user_id: currentUserId,
  });

  if (error) throw error;

  // RPC returns an array, get first item
  // @ts-ignore - data type inference issue
  if (data && Array.isArray(data) && data.length > 0) {
    return data[0] as UserProfile;
  }
  return null;
}

/**
 * Leave the current organization (self-service)
 * Sets user's org_id to null and role to 'employee'
 */
export async function leaveOrganization(userId: string): Promise<void> {
  // @ts-ignore - Supabase RLS typing limitation
  const result = await supabase
    .from("user_profiles")
    // @ts-ignore
    .update({ org_id: null, role: "employee" })
    .eq("id", userId);

  if (result.error) throw result.error;
}
