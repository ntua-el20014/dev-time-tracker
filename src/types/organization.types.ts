// Organization-related types for Supabase integration

export interface Organization {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  username: string;
  email?: string | null;
  avatar?: string | null;
  role: "admin" | "manager" | "employee";
  org_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrgJoinRequest {
  id: string;
  user_id: string;
  org_id: string;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrgJoinRequestWithUser extends OrgJoinRequest {
  user?: {
    username: string;
    email?: string | null;
    avatar?: string | null;
  };
}

export interface OrganizationWithStats extends Organization {
  member_count?: number;
  admin_count?: number;
  manager_count?: number;
  employee_count?: number;
  project_count?: number;
}

// Supabase Project (personal or organization)
export interface CloudProject {
  id: string;
  name: string;
  description?: string | null;
  color: string;
  scope: "personal" | "organization";
  is_active: boolean;
  manager_id: string;
  org_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CloudProjectWithManager extends CloudProject {
  manager?: {
    username: string;
    email?: string | null;
  };
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: "manager" | "member";
  assigned_at: string;
}

export interface ProjectMemberWithUser extends ProjectMember {
  user?: {
    username: string;
    email?: string | null;
    avatar?: string | null;
    role: "admin" | "manager" | "employee";
  };
}

export interface CreateOrganizationData {
  name: string;
}

export interface CreateCloudProjectData {
  name: string;
  description?: string | null;
  color?: string;
  scope?: "personal" | "organization";
  manager_id?: string;
  org_id?: string | null;
}

export interface UpdateCloudProjectData {
  name?: string;
  description?: string | null;
  color?: string;
  scope?: "personal" | "organization";
  is_active?: boolean;
  manager_id?: string;
  org_id?: string | null;
}

export interface AssignProjectMemberData {
  project_id: string;
  user_id: string;
  role: "manager" | "member";
}

export type UserRole = "admin" | "manager" | "employee";

// Invite Codes
export interface OrgInviteCode {
  id: string;
  org_id: string;
  code: string;
  created_by: string;
  max_uses: number | null;
  use_count: number;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateInviteCodeData {
  max_uses?: number | null;
  expires_in_days?: number | null;
}

export interface JoinWithCodeResult {
  org_id: string;
  org_name: string;
}
