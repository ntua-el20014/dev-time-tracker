// Organization-related types for Supabase integration

export interface Organization {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  local_id?: string;
  username: string;
  email?: string;
  avatar?: string;
  role: "admin" | "manager" | "employee";
  org_id?: string;
  created_at: string;
  updated_at: string;
}

export interface OrgJoinRequest {
  id: string;
  user_id: string;
  org_id: string;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  reviewed_at?: string;
  reviewed_by?: string;
  created_at: string;
  updated_at: string;
}

export interface OrgJoinRequestWithUser extends OrgJoinRequest {
  user?: {
    username: string;
    email?: string;
    avatar?: string;
  };
}

export interface OrganizationWithStats extends Organization {
  member_count?: number;
  admin_count?: number;
  manager_count?: number;
  employee_count?: number;
  project_count?: number;
}

// Supabase Project (linked to local via local_id)
export interface CloudProject {
  id: string;
  local_id?: string; // Links to SQLite project
  name: string;
  description?: string;
  color?: string;
  is_active: boolean;
  manager_id?: string;
  org_id?: string;
  created_at: string;
  updated_at: string;
}

export interface CloudProjectWithManager extends CloudProject {
  manager?: {
    username: string;
    email?: string;
  };
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: "manager" | "member";
  joined_at: string;
}

export interface ProjectMemberWithUser extends ProjectMember {
  user?: {
    username: string;
    email?: string;
    avatar?: string;
    role: "admin" | "manager" | "employee";
  };
}

export interface CreateOrganizationData {
  name: string;
}

export interface CreateCloudProjectData {
  name: string;
  description?: string;
  color?: string;
  manager_id?: string;
  org_id: string;
  local_id?: string; // Link to local project
}

export interface UpdateCloudProjectData {
  name?: string;
  description?: string;
  color?: string;
  is_active?: boolean;
  manager_id?: string;
}

export interface AssignProjectMemberData {
  project_id: string;
  user_id: string;
  role: "manager" | "member";
}

export type UserRole = "admin" | "manager" | "employee";
