/**
 * Cloud Projects Management API (Supabase)
 * Manages organization projects in Supabase
 * Supports both personal and organization-scoped projects
 */

import { supabase } from "./config";
import type {
  CloudProject,
  CloudProjectWithManager,
  ProjectMember,
  ProjectMemberWithUser,
  CreateCloudProjectData,
  UpdateCloudProjectData,
  AssignProjectMemberData,
} from "../types/organization.types";

/**
 * Get all cloud projects for the current user's organization
 * Only returns projects with scope="organization"
 */
export async function getOrganizationProjects(
  userId?: string,
): Promise<CloudProjectWithManager[]> {
  let currentUserId = userId;

  // If userId not provided, try to get from auth
  if (!currentUserId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    currentUserId = user.id;
  }

  // Get user's org_id
  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("org_id")
    .eq("id", currentUserId)
    .limit(1);

  if (!profiles || profiles.length === 0 || !(profiles[0] as any)?.org_id) {
    return [];
  }

  const userOrgId = (profiles[0] as any).org_id;

  // Get organization projects with manager info (exclude archived)
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
    .eq("scope", "organization")
    .eq("archived", false)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []) as CloudProjectWithManager[];
}

/**
 * Get all personal projects for a specific user
 * Returns projects with scope="personal"
 */
export async function getPersonalProjects(
  userId?: string,
): Promise<CloudProjectWithManager[]> {
  let currentUserId = userId;

  // If userId not provided, try to get from auth
  if (!currentUserId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    currentUserId = user.id;
  }

  // Get personal projects with manager info (exclude archived)
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
    .eq("manager_id", currentUserId)
    .eq("scope", "personal")
    .eq("archived", false)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []) as CloudProjectWithManager[];
}

/**
 * Get cloud project by ID
 */
export async function getCloudProjectById(
  projectId: string,
): Promise<CloudProjectWithManager | null> {
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
    .eq("id", projectId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // Not found
    throw error;
  }
  return data as CloudProjectWithManager;
}

/**
 * Create a cloud project (admin/manager only for org projects, any user for personal)
 * Default scope is "organization" if org_id is provided, otherwise "personal"
 */
export async function createCloudProject(
  data: CreateCloudProjectData,
  userId?: string,
): Promise<CloudProject> {
  let currentUserId = userId;

  // If userId not provided, try to get from auth
  if (!currentUserId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    currentUserId = user.id;
  }

  // Determine scope: if org_id is provided, default to organization, else personal
  const scope = data.scope || (data.org_id ? "organization" : "personal");

  // For personal projects, org_id should be null
  const orgId = scope === "personal" ? null : data.org_id;

  // Use direct insert instead of RPC for better type safety
  const { data: project, error } = await (supabase as any)
    .from("cloud_projects")
    .insert({
      name: data.name,
      description: data.description || null,
      color: data.color || "#3b82f6",
      scope: scope,
      manager_id: data.manager_id || currentUserId,
      org_id: orgId,
    })
    .select()
    .single();

  if (error) throw error;
  return project as CloudProject;
}

/**
 * Update a cloud project (admin/manager only)
 */
export async function updateCloudProject(
  projectId: string,
  updates: UpdateCloudProjectData,
): Promise<CloudProject> {
  const { data, error } = await supabase
    .from("cloud_projects")
    // @ts-ignore - Supabase RLS typing limitation
    .update(updates)
    .eq("id", projectId)
    .select()
    .single();

  if (error) throw error;
  return data as CloudProject;
}

/**
 * Get project members
 */
export async function getProjectMembers(
  projectId: string,
): Promise<ProjectMemberWithUser[]> {
  const { data, error } = await supabase
    .from("project_members")
    .select(
      `
      *,
      user:user_profiles!user_id (
        username,
        email,
        avatar,
        role
      )
    `,
    )
    .eq("project_id", projectId)
    .order("assigned_at", { ascending: false });

  if (error) throw error;
  return (data || []) as ProjectMemberWithUser[];
}

/**
 * Assign a user to a project
 */
export async function assignMemberToProject(
  data: AssignProjectMemberData,
): Promise<ProjectMember> {
  // Check if already assigned
  const { data: existing } = await supabase
    .from("project_members")
    .select("*")
    .eq("project_id", data.project_id)
    .eq("user_id", data.user_id)
    .single();

  if (existing) {
    throw new Error("User is already assigned to this project");
  }

  const { data: member, error } = await supabase
    .from("project_members")
    .insert(data as any)
    .select()
    .single();

  if (error) throw error;
  return member as ProjectMember;
}

/**
 * Remove a user from a project
 */
export async function removeMemberFromProject(
  projectId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);

  if (error) throw error;
}

/**
 * Update project member role
 */
export async function updateProjectMemberRole(
  projectId: string,
  userId: string,
  role: "manager" | "member",
): Promise<ProjectMember> {
  const { data, error } = await supabase
    .from("project_members")
    // @ts-ignore - Supabase RLS typing limitation
    .update({ role })
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw error;
  return data as ProjectMember;
}

/**
 * Archive a project (soft delete)
 * Admin/manager/project manager only
 */
export async function archiveProject(projectId: string): Promise<void> {
  const { error } = await (supabase.rpc as any)("archive_project", {
    p_project_id: projectId,
  });

  if (error) throw error;
}

/**
 * Restore an archived project
 * Admin/manager/project manager only
 */
export async function restoreProject(projectId: string): Promise<void> {
  const { error } = await (supabase.rpc as any)("restore_project", {
    p_project_id: projectId,
  });

  if (error) throw error;
}

/**
 * Get all archived projects for the current user
 * Returns both organization and personal archived projects
 */
export async function getArchivedProjects(
  userId?: string,
): Promise<CloudProjectWithManager[]> {
  let currentUserId = userId;

  // If userId not provided, try to get from auth
  if (!currentUserId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    currentUserId = user.id;
  }

  // Get user's org_id
  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("org_id")
    .eq("id", currentUserId)
    .limit(1);

  const userOrgId =
    profiles && profiles.length > 0 ? (profiles[0] as any)?.org_id : null;

  // Get archived projects (both org and personal)
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
    .eq("archived", true)
    .or(`manager_id.eq.${currentUserId},org_id.eq.${userOrgId}`)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data || []) as CloudProjectWithManager[];
}

/**
 * Get project statistics (sessions, time, members)
 */
export async function getProjectStats(projectId: string): Promise<{
  total_sessions: number;
  total_time_seconds: number;
  total_members: number;
  last_activity: string | null;
}> {
  const { data, error } = await (supabase.rpc as any)("get_project_stats", {
    p_project_id: projectId,
  });

  if (error) throw error;

  // RPC returns array with single row
  if (data && data.length > 0) {
    return data[0];
  }

  return {
    total_sessions: 0,
    total_time_seconds: 0,
    total_members: 0,
    last_activity: null,
  };
}
