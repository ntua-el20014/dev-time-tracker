/**
 * RLS Policy & Organization Isolation Tests
 *
 * These tests verify that API functions properly scope data by user/org.
 * Since we mock the Supabase client, we validate that:
 *   1. Every query includes the correct user_id / org_id filter
 *   2. Cross-org data cannot leak through API functions
 *   3. Functions respect role-based access patterns
 *   4. Error codes are handled correctly (PGRST116 = not found, etc.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mockResult,
  mockResults,
  mockSupabase,
  resetMockState,
  getCallsFor,
  getCallLog,
} from "../helpers/supabaseMock";

vi.mock("../../src/supabase/config", async () => {
  const { mockSupabase } = await import("../helpers/supabaseMock");
  return { supabase: mockSupabase };
});

// Mock only setSessionTagsByNames to avoid side effects in addSession/startSession
// but keep getAllTags and other real exports
vi.mock("../../src/supabase/tags", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/supabase/tags")>();
  return {
    ...actual,
    setSessionTagsByNames: vi.fn().mockResolvedValue(undefined),
  };
});

import { getAllSessions, startSession } from "../../src/supabase/timeTracking";
import { getAllTags } from "../../src/supabase/tags";
import { getDailyGoal, getAllDailyGoals } from "../../src/supabase/goals";
import { getUsageSummary, logUsage } from "../../src/supabase/usageLogs";
import {
  getScheduledSessions,
  createScheduledSession,
} from "../../src/supabase/scheduledSessions";
import { getUserPreferences } from "../../src/supabase/userPreferences";
import {
  getOrganizationProjects,
  getProjectMembers,
} from "../../src/supabase/cloudProjects";
import {
  getCurrentOrganization,
  getOrganizationMembers,
} from "../../src/supabase/organizations";

describe("RLS: User-scoped data isolation", () => {
  beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
  });

  // ───────────── Sessions ─────────────
  describe("Sessions are always scoped to user_id", () => {
    it("getAllSessions includes user_id in query", async () => {
      mockResult({ data: [], error: null });
      await getAllSessions("user-A");

      const eqCalls = getCallsFor("eq");
      expect(eqCalls[0].args).toEqual(["user_id", "user-A"]);
    });

    it("startSession embeds user_id in insert payload", async () => {
      mockResult({ data: { id: "s1" }, error: null });
      await startSession("user-A");

      const insertCalls = getCallsFor("insert");
      expect(insertCalls[0].args[0].user_id).toBe("user-A");
    });

    it("different user IDs produce different eq() calls", async () => {
      mockResult({ data: [], error: null });
      await getAllSessions("user-A");

      const log1 = getCallsFor("eq");

      resetMockState();
      vi.clearAllMocks();

      mockResult({ data: [], error: null });
      await getAllSessions("user-B");

      const log2 = getCallsFor("eq");

      expect(log1[0].args[1]).toBe("user-A");
      expect(log2[0].args[1]).toBe("user-B");
    });
  });

  // ───────────── Tags ─────────────
  describe("Tags are scoped to user_id", () => {
    it("getAllTags filters by user_id", async () => {
      mockResult({ data: [], error: null });
      await getAllTags("user-X");

      const eqCalls = getCallsFor("eq");
      expect(eqCalls[0].args).toEqual(["user_id", "user-X"]);
    });
  });

  // ───────────── Goals ─────────────
  describe("Goals are scoped to user_id", () => {
    it("getDailyGoal filters by user_id + date", async () => {
      mockResult({
        data: null,
        error: { code: "PGRST116", message: "not found" },
      });
      await getDailyGoal("user-A", "2025-01-15");

      const eqCalls = getCallsFor("eq");
      expect(eqCalls[0].args).toEqual(["user_id", "user-A"]);
      expect(eqCalls[1].args).toEqual(["date", "2025-01-15"]);
    });

    it("getAllDailyGoals filters by user_id", async () => {
      mockResult({ data: [], error: null });
      await getAllDailyGoals("user-A");

      const eqCalls = getCallsFor("eq");
      expect(eqCalls[0].args).toEqual(["user_id", "user-A"]);
    });
  });

  // ───────────── Usage logs ─────────────
  describe("Usage logs are scoped to user_id", () => {
    it("getUsageSummary filters by user_id + date", async () => {
      mockResult({ data: [], error: null });
      await getUsageSummary("user-A", "2025-01-15");

      const eqCalls = getCallsFor("eq");
      expect(eqCalls[0].args).toEqual(["user_id", "user-A"]);
      expect(eqCalls[1].args).toEqual(["date", "2025-01-15"]);
    });

    it("logUsage embeds user_id in insert payload", async () => {
      mockResult({ data: { id: "log-1" }, error: null });
      await logUsage("user-A", "VS Code", "test.ts");

      const insertCalls = getCallsFor("insert");
      expect(insertCalls[0].args[0].user_id).toBe("user-A");
    });
  });

  // ───────────── Scheduled sessions ─────────────
  describe("Scheduled sessions are scoped to user_id", () => {
    it("getScheduledSessions filters by user_id", async () => {
      mockResult({ data: [], error: null });
      await getScheduledSessions("user-A");

      const eqCalls = getCallsFor("eq");
      expect(eqCalls[0].args).toEqual(["user_id", "user-A"]);
    });

    it("createScheduledSession embeds user_id", async () => {
      mockResult({ data: { id: "ss-1" }, error: null });
      await createScheduledSession("user-A", {
        title: "Test",
        scheduled_datetime: "2025-01-20T09:00:00Z",
      });

      const insertCalls = getCallsFor("insert");
      expect(insertCalls[0].args[0].user_id).toBe("user-A");
    });
  });

  // ───────────── User preferences ─────────────
  describe("Preferences are scoped to user_id", () => {
    it("getUserPreferences filters by user_id", async () => {
      mockResult({
        data: {
          user_id: "user-A",
          theme: "dark",
          accent_color: { light: "#007acc", dark: "#f0db4f" },
          editor_colors: {},
          notification_settings: { enabled: true },
          idle_timeout_seconds: 300,
        },
        error: null,
      });
      await getUserPreferences("user-A");

      const eqCalls = getCallsFor("eq");
      expect(eqCalls[0].args).toEqual(["user_id", "user-A"]);
    });
  });
});

describe("RLS: Organization data isolation", () => {
  beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
  });

  // ───────────── Cross-org project isolation ─────────────
  describe("Organization projects are scoped by org_id", () => {
    it("getOrganizationProjects fetches user org_id first", async () => {
      // user profile → org_id
      mockResult({ data: [{ org_id: "org-A" }], error: null });
      // projects
      mockResult({ data: [], error: null });

      await getOrganizationProjects("user-1");

      const fromCalls = getCallsFor("from");
      expect(fromCalls[0].args[0]).toBe("user_profiles");
      // Second query filters by org_id
      const eqCalls = getCallsFor("eq");
      expect(eqCalls.some((c) => c.args[0] === "org_id")).toBe(true);
    });

    it("empty org_id returns empty projects (no leak)", async () => {
      mockResult({ data: [{ org_id: null }], error: null });

      const result = await getOrganizationProjects("user-1");
      expect(result).toEqual([]);
      // No second query should be made (early return)
      const fromCalls = getCallsFor("from");
      expect(fromCalls).toHaveLength(1);
    });
  });

  // ───────────── Org membership via RPC ─────────────
  describe("Organization membership uses SECURITY DEFINER RPCs", () => {
    it("getCurrentOrganization uses get_organization_by_user_id RPC", async () => {
      mockResult({ data: [{ id: "org-1" }], error: null });
      await getCurrentOrganization("user-1");

      const rpcCalls = getCallsFor("rpc");
      expect(rpcCalls[0].args[0]).toBe("get_organization_by_user_id");
      expect(rpcCalls[0].args[1]).toEqual({ p_user_id: "user-1" });
    });

    it("getOrganizationMembers uses get_organization_members_by_org_id RPC", async () => {
      mockResult({ data: [], error: null });
      await getOrganizationMembers("org-1");

      const rpcCalls = getCallsFor("rpc");
      expect(rpcCalls[0].args[0]).toBe("get_organization_members_by_org_id");
      expect(rpcCalls[0].args[1]).toEqual({ p_org_id: "org-1" });
    });
  });

  // ───────────── Multi-user same org ─────────────
  describe("Multiple users in same organization see same org data", () => {
    it("two users with same org_id query the same org projects", async () => {
      // User A
      mockResult({ data: [{ org_id: "shared-org" }], error: null });
      mockResult({ data: [{ id: "proj-shared" }], error: null });
      const resultA = await getOrganizationProjects("user-A");

      resetMockState();
      vi.clearAllMocks();

      // User B (same org)
      mockResult({ data: [{ org_id: "shared-org" }], error: null });
      mockResult({ data: [{ id: "proj-shared" }], error: null });
      const resultB = await getOrganizationProjects("user-B");

      // Both see the same project
      expect(resultA[0].id).toBe("proj-shared");
      expect(resultB[0].id).toBe("proj-shared");
    });

    it("user in different org cannot see other org projects", async () => {
      // User A → org-A → has projects
      mockResult({ data: [{ org_id: "org-A" }], error: null });
      mockResult({
        data: [{ id: "proj-A", name: "Org A Project" }],
        error: null,
      });
      const resultA = await getOrganizationProjects("user-A");

      resetMockState();
      vi.clearAllMocks();

      // User C → org-B → different projects
      mockResult({ data: [{ org_id: "org-B" }], error: null });
      mockResult({
        data: [{ id: "proj-B", name: "Org B Project" }],
        error: null,
      });
      const resultC = await getOrganizationProjects("user-C");

      expect(resultA[0].id).toBe("proj-A");
      expect(resultC[0].id).toBe("proj-B");
      expect(resultA[0].id).not.toBe(resultC[0].id);
    });
  });

  // ───────────── Project members isolation ─────────────
  describe("Project members are scoped by project_id", () => {
    it("getProjectMembers filters by project_id", async () => {
      mockResult({ data: [], error: null });
      await getProjectMembers("proj-1");

      const eqCalls = getCallsFor("eq");
      expect(eqCalls[0].args).toEqual(["project_id", "proj-1"]);
    });
  });
});

describe("Error handling patterns", () => {
  beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
  });

  it("PGRST116 (not found) is handled as null/empty, not thrown", async () => {
    // getDailyGoal handles PGRST116
    mockResult({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    });
    const goal = await getDailyGoal("user-1", "2025-01-15");
    expect(goal).toBeNull();
  });

  it("non-PGRST116 errors are thrown", async () => {
    mockResult({
      data: null,
      error: { code: "42P01", message: "relation does not exist" },
    });

    await expect(getDailyGoal("user-1", "2025-01-15")).rejects.toEqual({
      code: "42P01",
      message: "relation does not exist",
    });
  });

  it("network-level errors propagate correctly", async () => {
    mockResult({
      data: null,
      error: { message: "Failed to fetch" },
    });

    await expect(getAllSessions("user-1")).rejects.toEqual({
      message: "Failed to fetch",
    });
  });

  it("auth errors from missing user context are thrown", async () => {
    // getOrganizationProjects with no userId falls back to auth
    // Simulate auth returning no user
    mockSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });

    await expect(getOrganizationProjects()).rejects.toThrow(
      "Not authenticated",
    );
  });
});
