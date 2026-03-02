import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mockResult,
  mockRpcResult,
  resetMockState,
  getCallsFor,
} from "../helpers/supabaseMock";

vi.mock("../../src/supabase/config", async () => {
  const { mockSupabase } = await import("../helpers/supabaseMock");
  return { supabase: mockSupabase };
});

import {
  getOrganizationProjects,
  getPersonalProjects,
  getCloudProjectById,
  createCloudProject,
  updateCloudProject,
  getProjectMembers,
  assignMemberToProject,
  removeMemberFromProject,
  updateProjectMemberRole,
  archiveProject,
  restoreProject,
  getArchivedProjects,
  getProjectStats,
} from "../../src/supabase/cloudProjects";

import {
  getCurrentOrganization,
  getOrganizationById,
  getOrganizationMembers,
  createTeamOrganization,
  createPersonalOrganization,
  updateOrganization,
  updateUserRole,
  removeUserFromOrganization,
  getCurrentUserProfile,
  leaveOrganization,
} from "../../src/supabase/organizations";

describe("cloudProjects", () => {
  beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
  });

  // ───────────── getOrganizationProjects ─────────────
  describe("getOrganizationProjects", () => {
    it("gets user profile then fetches org projects", async () => {
      // Get user profile → org_id
      mockResult({
        data: [{ org_id: "org-1" }],
        error: null,
      });
      // Get projects
      mockResult({
        data: [
          {
            id: "proj-1",
            name: "Project Alpha",
            scope: "organization",
            manager: { username: "admin", email: "admin@test.com" },
          },
        ],
        error: null,
      });

      const result = await getOrganizationProjects("user-1");

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Project Alpha");
      const fromCalls = getCallsFor("from");
      expect(fromCalls[0].args[0]).toBe("user_profiles");
      expect(fromCalls[1].args[0]).toBe("cloud_projects");
    });

    it("returns empty when user has no org", async () => {
      mockResult({ data: [{ org_id: null }], error: null });

      const result = await getOrganizationProjects("user-1");
      expect(result).toEqual([]);
    });

    it("falls back to auth when no userId provided", async () => {
      // Auth getUser (from the mock helper default)
      // profiles
      mockResult({ data: [{ org_id: "org-1" }], error: null });
      // projects
      mockResult({ data: [], error: null });

      const result = await getOrganizationProjects();
      expect(result).toEqual([]);
    });
  });

  // ───────────── getPersonalProjects ─────────────
  describe("getPersonalProjects", () => {
    it("fetches personal projects for user", async () => {
      mockResult({
        data: [
          {
            id: "proj-2",
            name: "My Side Project",
            scope: "personal",
            manager: { username: "me", email: "me@test.com" },
          },
        ],
        error: null,
      });

      const result = await getPersonalProjects("user-1");

      expect(result).toHaveLength(1);
      const eqCalls = getCallsFor("eq");
      expect(
        eqCalls.some((c) => c.args[0] === "scope" && c.args[1] === "personal"),
      ).toBe(true);
    });
  });

  // ───────────── getCloudProjectById ─────────────
  describe("getCloudProjectById", () => {
    it("returns project with manager info", async () => {
      mockResult({
        data: {
          id: "proj-1",
          name: "Alpha",
          manager: { username: "admin" },
        },
        error: null,
      });

      const result = await getCloudProjectById("proj-1");
      expect(result?.name).toBe("Alpha");
    });

    it("returns null when not found", async () => {
      mockResult({
        data: null,
        error: { code: "PGRST116", message: "not found" },
      });

      const result = await getCloudProjectById("nonexistent");
      expect(result).toBeNull();
    });
  });

  // ───────────── createCloudProject ─────────────
  describe("createCloudProject", () => {
    it("creates an org project when org_id provided", async () => {
      mockResult({
        data: { id: "proj-new", name: "New Project", scope: "organization" },
        error: null,
      });

      const result = await createCloudProject(
        { name: "New Project", org_id: "org-1" },
        "user-1",
      );

      expect(result.scope).toBe("organization");
      const insertCalls = getCallsFor("insert");
      expect(insertCalls[0].args[0].scope).toBe("organization");
      expect(insertCalls[0].args[0].org_id).toBe("org-1");
    });

    it("creates a personal project when no org_id", async () => {
      mockResult({
        data: { id: "proj-new", name: "Personal", scope: "personal" },
        error: null,
      });

      const result = await createCloudProject({ name: "Personal" }, "user-1");

      expect(result.scope).toBe("personal");
      const insertCalls = getCallsFor("insert");
      expect(insertCalls[0].args[0].scope).toBe("personal");
      expect(insertCalls[0].args[0].org_id).toBeNull();
    });
  });

  // ───────────── updateCloudProject ─────────────
  describe("updateCloudProject", () => {
    it("updates project fields", async () => {
      mockResult({
        data: { id: "proj-1", name: "Updated Name" },
        error: null,
      });

      const result = await updateCloudProject("proj-1", {
        name: "Updated Name",
      });

      expect(result.name).toBe("Updated Name");
    });
  });

  // ───────────── getProjectMembers ─────────────
  describe("getProjectMembers", () => {
    it("returns members with user profile info", async () => {
      mockResult({
        data: [
          {
            project_id: "proj-1",
            user_id: "u1",
            role: "member",
            user: { username: "alice", email: "alice@test.com" },
          },
        ],
        error: null,
      });

      const result = await getProjectMembers("proj-1");

      expect(result).toHaveLength(1);
      const fromCalls = getCallsFor("from");
      expect(fromCalls[0].args[0]).toBe("project_members");
    });
  });

  // ───────────── assignMemberToProject ─────────────
  describe("assignMemberToProject", () => {
    it("checks for existing then inserts", async () => {
      // Check existing → not found
      mockResult({
        data: null,
        error: { code: "PGRST116", message: "not found" },
      });
      // Insert new member
      mockResult({
        data: { project_id: "proj-1", user_id: "u2", role: "member" },
        error: null,
      });

      const result = await assignMemberToProject({
        project_id: "proj-1",
        user_id: "u2",
        role: "member",
      });

      expect(result.user_id).toBe("u2");
    });

    it("throws when user already assigned", async () => {
      mockResult({
        data: { project_id: "proj-1", user_id: "u1" },
        error: null,
      });

      await expect(
        assignMemberToProject({
          project_id: "proj-1",
          user_id: "u1",
          role: "member",
        }),
      ).rejects.toThrow("User is already assigned to this project");
    });
  });

  // ───────────── removeMemberFromProject ─────────────
  describe("removeMemberFromProject", () => {
    it("deletes the project member", async () => {
      mockResult({ data: null, error: null });

      await removeMemberFromProject("proj-1", "u1");

      const eqCalls = getCallsFor("eq");
      expect(eqCalls[0].args).toEqual(["project_id", "proj-1"]);
      expect(eqCalls[1].args).toEqual(["user_id", "u1"]);
    });
  });

  // ───────────── updateProjectMemberRole ─────────────
  describe("updateProjectMemberRole", () => {
    it("updates member role", async () => {
      mockResult({
        data: { project_id: "proj-1", user_id: "u1", role: "manager" },
        error: null,
      });

      const result = await updateProjectMemberRole("proj-1", "u1", "manager");

      expect(result.role).toBe("manager");
    });
  });

  // ───────────── archiveProject / restoreProject ─────────────
  describe("archiveProject", () => {
    it("calls archive_project RPC", async () => {
      mockResult({ data: null, error: null });

      await archiveProject("proj-1");

      const rpcCalls = getCallsFor("rpc");
      expect(rpcCalls[0].args[0]).toBe("archive_project");
      expect(rpcCalls[0].args[1]).toEqual({ p_project_id: "proj-1" });
    });
  });

  describe("restoreProject", () => {
    it("calls restore_project RPC", async () => {
      mockResult({ data: null, error: null });

      await restoreProject("proj-1");

      const rpcCalls = getCallsFor("rpc");
      expect(rpcCalls[0].args[0]).toBe("restore_project");
    });
  });

  // ───────────── getArchivedProjects ─────────────
  describe("getArchivedProjects", () => {
    it("returns archived projects for user", async () => {
      // profiles
      mockResult({ data: [{ org_id: "org-1" }], error: null });
      // archived projects
      mockResult({
        data: [{ id: "proj-old", name: "Archived", archived: true }],
        error: null,
      });

      const result = await getArchivedProjects("user-1");
      expect(result).toHaveLength(1);
    });
  });

  // ───────────── getProjectStats ─────────────
  describe("getProjectStats", () => {
    it("returns stats from RPC", async () => {
      mockResult({
        data: [
          {
            total_sessions: 10,
            total_time_seconds: 36000,
            total_members: 3,
            last_activity: "2025-01-15",
          },
        ],
        error: null,
      });

      const result = await getProjectStats("proj-1");

      expect(result.total_sessions).toBe(10);
      expect(result.total_time_seconds).toBe(36000);
      const rpcCalls = getCallsFor("rpc");
      expect(rpcCalls[0].args[0]).toBe("get_project_stats");
    });

    it("returns defaults when RPC returns empty", async () => {
      mockResult({ data: [], error: null });

      const result = await getProjectStats("proj-1");

      expect(result.total_sessions).toBe(0);
      expect(result.total_time_seconds).toBe(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Organization CRUD
// ═══════════════════════════════════════════════════════════════════

describe("organizations", () => {
  beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
  });

  // ───────────── getCurrentOrganization ─────────────
  describe("getCurrentOrganization", () => {
    it("calls get_organization_by_user_id RPC", async () => {
      mockResult({
        data: [{ id: "org-1", name: "My Team" }],
        error: null,
      });

      const result = await getCurrentOrganization("user-1");

      expect(result).toEqual({ id: "org-1", name: "My Team" });
      const rpcCalls = getCallsFor("rpc");
      expect(rpcCalls[0].args[0]).toBe("get_organization_by_user_id");
    });

    it("returns null when no org found", async () => {
      mockResult({ data: [], error: null });
      const result = await getCurrentOrganization("user-1");
      expect(result).toBeNull();
    });

    it("returns null for null RPC data", async () => {
      mockResult({ data: null, error: null });
      const result = await getCurrentOrganization("user-1");
      expect(result).toBeNull();
    });
  });

  // ───────────── getOrganizationById ─────────────
  describe("getOrganizationById", () => {
    it("fetches org, members (RPC), and project count", async () => {
      // org
      mockResult({
        data: { id: "org-1", name: "My Team" },
        error: null,
      });
      // members RPC
      mockResult({
        data: [
          { id: "u1", role: "admin" },
          { id: "u2", role: "employee" },
          { id: "u3", role: "manager" },
        ],
        error: null,
      });
      // project count
      mockResult({ data: null, error: null, count: 5 });

      const result = await getOrganizationById("org-1");

      expect(result.name).toBe("My Team");
      expect(result.member_count).toBe(3);
      expect(result.admin_count).toBe(1);
      expect(result.manager_count).toBe(1);
      expect(result.employee_count).toBe(1);
    });
  });

  // ───────────── getOrganizationMembers ─────────────
  describe("getOrganizationMembers", () => {
    it("calls get_organization_members_by_org_id RPC", async () => {
      mockResult({
        data: [
          { id: "u1", username: "alice", role: "admin" },
          { id: "u2", username: "bob", role: "employee" },
        ],
        error: null,
      });

      const result = await getOrganizationMembers("org-1");

      expect(result).toHaveLength(2);
      const rpcCalls = getCallsFor("rpc");
      expect(rpcCalls[0].args[0]).toBe("get_organization_members_by_org_id");
    });
  });

  // ───────────── createTeamOrganization ─────────────
  describe("createTeamOrganization", () => {
    it("calls create_team_organization RPC", async () => {
      mockResult({ data: "org-new-id", error: null });

      const result = await createTeamOrganization({ name: "New Team" });

      expect(result.org_id).toBe("org-new-id");
      const rpcCalls = getCallsFor("rpc");
      expect(rpcCalls[0].args[0]).toBe("create_team_organization");
      expect(rpcCalls[0].args[1]).toEqual({ org_name: "New Team" });
    });
  });

  // ───────────── createPersonalOrganization ─────────────
  describe("createPersonalOrganization", () => {
    it("calls create_personal_organization RPC", async () => {
      mockResult({ data: "org-personal-id", error: null });

      const result = await createPersonalOrganization("user-1", "Personal Org");

      expect(result.org_id).toBe("org-personal-id");
      const rpcCalls = getCallsFor("rpc");
      expect(rpcCalls[0].args[0]).toBe("create_personal_organization");
    });
  });

  // ───────────── updateOrganization ─────────────
  describe("updateOrganization", () => {
    it("updates org fields", async () => {
      mockResult({
        data: { id: "org-1", name: "Updated Name" },
        error: null,
      });

      const result = await updateOrganization("org-1", {
        name: "Updated Name",
      });

      expect(result.name).toBe("Updated Name");
    });
  });

  // ───────────── updateUserRole ─────────────
  describe("updateUserRole", () => {
    it("updates user role in user_profiles", async () => {
      mockResult({ data: null, error: null });

      await updateUserRole("user-2", "manager");

      const fromCalls = getCallsFor("from");
      expect(fromCalls[0].args[0]).toBe("user_profiles");
    });

    it("throws on error", async () => {
      mockResult({ data: null, error: { message: "Forbidden" } });
      await expect(updateUserRole("user-2", "admin")).rejects.toEqual({
        message: "Forbidden",
      });
    });
  });

  // ───────────── removeUserFromOrganization ─────────────
  describe("removeUserFromOrganization", () => {
    it("sets user org_id to null", async () => {
      mockResult({ data: null, error: null });

      await removeUserFromOrganization("user-2");

      const updateCalls = getCallsFor("update");
      expect(updateCalls[0].args[0]).toEqual({ org_id: null });
    });
  });

  // ───────────── getCurrentUserProfile ─────────────
  describe("getCurrentUserProfile", () => {
    it("calls get_user_profile_by_id RPC", async () => {
      mockResult({
        data: [
          {
            id: "user-1",
            username: "testuser",
            email: "test@test.com",
            role: "admin",
          },
        ],
        error: null,
      });

      const result = await getCurrentUserProfile("user-1");

      expect(result?.username).toBe("testuser");
      const rpcCalls = getCallsFor("rpc");
      expect(rpcCalls[0].args[0]).toBe("get_user_profile_by_id");
    });

    it("returns null when RPC returns empty", async () => {
      mockResult({ data: [], error: null });
      const result = await getCurrentUserProfile("user-1");
      expect(result).toBeNull();
    });
  });

  // ───────────── leaveOrganization ─────────────
  describe("leaveOrganization", () => {
    it("sets org_id to null and role to employee", async () => {
      mockResult({ data: null, error: null });

      await leaveOrganization("user-1");

      const updateCalls = getCallsFor("update");
      expect(updateCalls[0].args[0]).toEqual({
        org_id: null,
        role: "employee",
      });
    });
  });
});
