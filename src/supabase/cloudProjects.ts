/**
 * Cloud Projects Management API (Supabase)
 * Manages organization projects in Supabase
 * Links to local SQLite projects via local_id field
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
 */
export async function getOrganizationProjects(): Promise<
  CloudProjectWithManager[]
> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Get user's org_id
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();

  if (!(profile as any)?.org_id) {
    return [];
  }

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
    .eq("org_id", (profile as any).org_id)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []) as CloudProjectWithManager[];
}

/**
 * Get cloud project by ID
 */
export async function getCloudProjectById(
  projectId: string
): Promise<CloudProjectWithManager | null> {
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
    .eq("id", projectId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // Not found
    throw error;
  }
  return data as CloudProjectWithManager;
}

/**
 * Get cloud project by local_id (links to SQLite)
 */
export async function getCloudProjectByLocalId(
  localId: string
): Promise<CloudProjectWithManager | null> {
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
    .eq("local_id", localId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // Not found
    throw error;
  }
  return data as CloudProjectWithManager;
}

/**
 * Create a cloud project (admin/manager only)
 * Can optionally link to local project via local_id
 */
export async function createCloudProject(
  data: CreateCloudProjectData
): Promise<CloudProject> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // If no manager specified, set current user as manager
  const projectData = {
    ...data,
    manager_id: data.manager_id || user.id,
  };

  const { data: project, error } = await supabase
    .from("projects")
    .insert(projectData as any)
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
  updates: UpdateCloudProjectData
): Promise<CloudProject> {
  const { data, error } = await supabase
    .from("projects")
    // @ts-ignore - Supabase RLS typing limitation
    .update(updates)
    .eq("id", projectId)
    .select()
    .single();

  if (error) throw error;
  return data as CloudProject;
}

/**
 * Link a local project to a cloud project
 */
export async function linkLocalProject(
  cloudProjectId: string,
  localId: string
): Promise<CloudProject> {
  return updateCloudProject(cloudProjectId, { local_id: localId } as any);
}

/**
 * Get project members
 */
export async function getProjectMembers(
  projectId: string
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
    `
    )
    .eq("project_id", projectId)
    .order("joined_at", { ascending: false });

  if (error) throw error;
  return (data || []) as ProjectMemberWithUser[];
}

/**
 * Assign a user to a project
 */
export async function assignMemberToProject(
  data: AssignProjectMemberData
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
  userId: string
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
  role: "manager" | "member"
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
