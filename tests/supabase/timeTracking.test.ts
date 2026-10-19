import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mockResult,
  mockRpcResult,
  resetMockState,
  getCallsFor,
} from "../helpers/supabaseMock";

// Mock the supabase client before importing the module under test
vi.mock("../../src/supabase/config", async () => {
  const { mockSupabase } = await import("../helpers/supabaseMock");
  return { supabase: mockSupabase };
});

// Also mock the tags module since addSession calls setSessionTagsByNames
vi.mock("../../src/supabase/tags", () => ({
  setSessionTagsByNames: vi.fn().mockResolvedValue(undefined),
}));

import {
  getSmallSessions,
  deleteSessions,
  getAllSessions,
  getSessionById,
  updateSession,
  deleteSession,
  addSession,
  getSessionsInDateRange,
  saveDraftSession,
  confirmDraftSession,
  countDraftSessions,
  deleteDraftSessions,
  getDraftSessions,
} from "../../src/supabase/timeTracking";

describe("timeTracking", () => {
  beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
  });

  // ───────────── getSmallSessions ─────────────
  describe("getSmallSessions", () => {
    it("returns sessions under the duration threshold", async () => {
      const sessions = [
        { id: "s1", duration: 5 },
        { id: "s2", duration: 10 },
      ];
      mockResult({ data: sessions, error: null });

      const result = await getSmallSessions("user-1", 30);

      expect(result).toEqual(sessions);
      const lteCalls = getCallsFor("lte");
      expect(lteCalls[0].args).toEqual(["duration", 30]);
    });

    it("returns empty array when no data", async () => {
      mockResult({ data: null, error: null });

      const result = await getSmallSessions("user-1", 30);
      expect(result).toEqual([]);
    });
  });

  // ───────────── deleteSessions ─────────────
  describe("deleteSessions", () => {
    it("deletes the user's confirmed sessions by IDs", async () => {
      mockResult({ data: null, error: null });

      await deleteSessions("user-1", ["s1", "s2", "s3"]);

      const inCalls = getCallsFor("in");
      expect(inCalls[0].args).toEqual(["id", ["s1", "s2", "s3"]]);
      expect(getCallsFor("eq").map((c) => c.args)).toEqual([
        ["user_id", "user-1"],
        ["status", "confirmed"],
      ]);
    });

    it("throws on error", async () => {
      mockResult({
        data: null,
        error: { message: "Delete failed" },
      });

      await expect(deleteSessions("user-1", ["s1"])).rejects.toEqual({
        message: "Delete failed",
      });
    });
  });

  // ───────────── getAllSessions ─────────────
  describe("getAllSessions", () => {
    it("returns all sessions for a user", async () => {
      const sessions = [
        { id: "s1", user_id: "user-1" },
        { id: "s2", user_id: "user-1" },
      ];
      mockResult({ data: sessions, error: null });

      const result = await getAllSessions("user-1");

      expect(result).toEqual(sessions);
      const eqCalls = getCallsFor("eq");
      expect(eqCalls[0].args).toEqual(["user_id", "user-1"]);
    });

    it("applies date range filters", async () => {
      mockResult({ data: [], error: null });

      await getAllSessions("user-1", {
        startDate: "2025-01-01",
        endDate: "2025-01-31",
      });

      const gteCalls = getCallsFor("gte");
      // Date-only bounds are expanded to the user's local day
      expect(gteCalls[0].args).toEqual([
        "start_time",
        new Date("2025-01-01T00:00:00").toISOString(),
      ]);
      const lteCalls = getCallsFor("lte");
      expect(lteCalls[0].args).toEqual([
        "start_time",
        new Date("2025-01-31T23:59:59.999").toISOString(),
      ]);
    });

    it("applies project filter", async () => {
      mockResult({ data: [], error: null });

      await getAllSessions("user-1", { projectId: "proj-1" });

      const eqCalls = getCallsFor("eq");
      expect(eqCalls.some((c) => c.args[0] === "project_id")).toBe(true);
    });

    it("applies billable filter", async () => {
      mockResult({ data: [], error: null });

      await getAllSessions("user-1", { isBillable: true });

      const eqCalls = getCallsFor("eq");
      expect(eqCalls.some((c) => c.args[0] === "is_billable")).toBe(true);
    });

    it("filters by tag name (tag flow)", async () => {
      // 1. Lookup tag by name → tag id
      mockResult({ data: { id: "tag-1" }, error: null });
      // 2. Get session_tags for that tag
      mockResult({
        data: [{ session_id: "s1" }, { session_id: "s2" }],
        error: null,
      });
      // 3. Get sessions with those IDs
      mockResult({
        data: [
          { id: "s1", user_id: "user-1" },
          { id: "s2", user_id: "user-1" },
        ],
        error: null,
      });

      const result = await getAllSessions("user-1", { tag: "important" });

      expect(result).toHaveLength(2);
      // Verify user_tags was queried
      const fromCalls = getCallsFor("from");
      expect(fromCalls[0].args[0]).toBe("user_tags");
      expect(fromCalls[1].args[0]).toBe("session_tags");
      expect(fromCalls[2].args[0]).toBe("time_tracking_sessions");
    });

    it("returns empty when tag not found", async () => {
      mockResult({
        data: null,
        error: { code: "PGRST116", message: "not found" },
      });

      const result = await getAllSessions("user-1", { tag: "nonexistent" });
      expect(result).toEqual([]);
    });

    it("returns empty array on null data", async () => {
      mockResult({ data: null, error: null });

      const result = await getAllSessions("user-1");
      expect(result).toEqual([]);
    });

    it("applies limit and offset", async () => {
      mockResult({ data: [], error: null });

      await getAllSessions("user-1", { limit: 10, offset: 20 });

      const limitCalls = getCallsFor("limit");
      expect(limitCalls[0].args[0]).toBe(10);
      const rangeCalls = getCallsFor("range");
      expect(rangeCalls[0].args).toEqual([20, 29]);
    });
  });

  // ───────────── getSessionById ─────────────
  describe("getSessionById", () => {
    it("returns a session by ID", async () => {
      const session = { id: "s1", title: "My Session" };
      mockResult({ data: session, error: null });

      const result = await getSessionById("s1");

      expect(result).toEqual(session);
      const eqCalls = getCallsFor("eq");
      expect(eqCalls[0].args).toEqual(["id", "s1"]);
    });

    it("returns null when not found (PGRST116)", async () => {
      mockResult({
        data: null,
        error: { code: "PGRST116", message: "not found" },
      });

      const result = await getSessionById("nonexistent");
      expect(result).toBeNull();
    });

    it("throws on unexpected error", async () => {
      mockResult({
        data: null,
        error: { code: "42P01", message: "table not found" },
      });

      await expect(getSessionById("s1")).rejects.toEqual({
        code: "42P01",
        message: "table not found",
      });
    });
  });

  // ───────────── updateSession ─────────────
  describe("updateSession", () => {
    it("updates the fields of the user's confirmed session", async () => {
      const updated = { id: "s1", title: "New Title", is_billable: true };
      mockResult({ data: [updated], error: null });

      const result = await updateSession("user-1", "s1", {
        title: "New Title",
        is_billable: true,
      });

      expect(result).toEqual(updated);
      const updateCalls = getCallsFor("update");
      expect(updateCalls.length).toBe(1);
      const updateArg = updateCalls[0].args[0];
      expect(updateArg.title).toBe("New Title");
      expect(updateArg.is_billable).toBe(true);
      expect(updateArg.updated_at).toBeDefined();
      expect(getCallsFor("eq").map((c) => c.args)).toEqual([
        ["id", "s1"],
        ["user_id", "user-1"],
        ["status", "confirmed"],
      ]);
    });

    it("returns null when no confirmed session matched (e.g. a draft)", async () => {
      mockResult({ data: [], error: null });
      expect(await updateSession("user-1", "d1", { title: "X" })).toBeNull();
    });

    it("throws on error", async () => {
      mockResult({ data: null, error: { message: "Update failed" } });

      await expect(updateSession("user-1", "s1", { title: "Fail" })).rejects.toEqual({
        message: "Update failed",
      });
    });
  });

  // ───────────── deleteSession ─────────────
  describe("deleteSession", () => {
    it("deletes a single session", async () => {
      mockResult({ data: null, error: null });

      await deleteSession("user-1", "s1");

      const fromCalls = getCallsFor("from");
      expect(fromCalls[0].args[0]).toBe("time_tracking_sessions");
      expect(getCallsFor("eq").map((c) => c.args)).toEqual([
        ["id", "s1"],
        ["user_id", "user-1"],
        ["status", "confirmed"],
      ]);
    });
  });

  // ───────────── addSession ─────────────
  describe("addSession", () => {
    it("inserts a completed session with all fields", async () => {
      const session = {
        id: "s1",
        user_id: "user-1",
        start_time: "2025-01-15T10:00:00.000Z",
        duration: 1800,
        title: "Retrospective",
      };
      mockResult({ data: session, error: null });

      const result = await addSession(
        "user-1",
        "2025-01-15T10:00:00.000Z",
        1800,
        "Retrospective",
        "desc",
        undefined,
        "proj-1",
        true,
      );

      expect(result).toEqual(session);
      const insertCalls = getCallsFor("insert");
      const insertArg = insertCalls[0].args[0];
      expect(insertArg.duration).toBe(1800);
      expect(insertArg.is_billable).toBe(true);
      expect(insertArg.project_id).toBe("proj-1");
    });

    it("stores end_time alongside active duration when provided", async () => {
      mockResult({ data: { id: "s1" }, error: null });

      await addSession(
        "user-1",
        "2025-01-15T10:00:00.000Z",
        1800, // 30 min active
        "Session",
        undefined,
        undefined,
        undefined,
        false,
        "2025-01-15T11:00:00.000Z", // 60 min wall clock (30 min paused)
      );

      const insertArg = getCallsFor("insert")[0].args[0];
      expect(insertArg.duration).toBe(1800);
      expect(insertArg.end_time).toBe("2025-01-15T11:00:00.000Z");
    });

    it("leaves end_time null when not provided", async () => {
      mockResult({ data: { id: "s1" }, error: null });

      await addSession("user-1", "2025-01-15T10:00:00.000Z", 1800, "Session");

      expect(getCallsFor("insert")[0].args[0].end_time).toBeNull();
    });

    it("calls setSessionTagsByNames when tags provided", async () => {
      const session = { id: "s1", user_id: "user-1" };
      mockResult({ data: session, error: null });

      const { setSessionTagsByNames: mockSetTags } =
        await import("../../src/supabase/tags");

      await addSession(
        "user-1",
        "2025-01-15T10:00:00.000Z",
        1800,
        "Session",
        undefined,
        ["tag1", "tag2"],
      );

      expect(mockSetTags).toHaveBeenCalledWith("user-1", "s1", [
        "tag1",
        "tag2",
      ]);
    });
  });

  // ───────────── getSessionsInDateRange ─────────────
  describe("getSessionsInDateRange", () => {
    it("queries with date range filters", async () => {
      mockResult({ data: [{ id: "s1" }], error: null });

      const result = await getSessionsInDateRange(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );

      expect(result).toHaveLength(1);
      const gteCalls = getCallsFor("gte");
      // Date-only bounds are expanded to the user's local day
      expect(gteCalls[0].args).toEqual([
        "start_time",
        new Date("2025-01-01T00:00:00").toISOString(),
      ]);
      const lteCalls = getCallsFor("lte");
      expect(lteCalls[0].args).toEqual([
        "start_time",
        new Date("2025-01-31T23:59:59.999").toISOString(),
      ]);
    });

    it("returns empty array on null data", async () => {
      mockResult({ data: null, error: null });

      const result = await getSessionsInDateRange(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      expect(result).toEqual([]);
    });
  });

  // ───────────── drafts (Phase D) ─────────────
  describe("drafts", () => {
    const draft = {
      clientId: "6f1c0a52-0000-4000-8000-000000000001",
      startTime: "2026-10-18T09:00:00.000Z",
      endTime: "2026-10-18T09:40:00.000Z",
      duration: 2100,
      title: "dev-time-tracker",
      projectId: "p1",
      supervising: {
        seconds: 300,
        spans: [["2026-10-18T09:10:00.000Z", "2026-10-18T09:15:00.000Z"]] as [string, string][],
      },
      appUsage: [{ app: "VS Code", language: "TypeScript", category: null, seconds: 1800 }],
    };

    it("session lists only show confirmed sessions", async () => {
      mockResult({ data: [], error: null });
      await getAllSessions("u1");
      mockResult({ data: [], error: null });
      await getSessionsInDateRange("u1", "2026-10-01", "2026-10-31");
      mockResult({ data: [], error: null });
      await getSmallSessions("u1", 60);
      const statusFilters = getCallsFor("eq").filter((c) => c.args[0] === "status");
      expect(statusFilters).toEqual([
        { method: "eq", args: ["status", "confirmed"] },
        { method: "eq", args: ["status", "confirmed"] },
        { method: "eq", args: ["status", "confirmed"] },
      ]);
    });

    const rpcCall = () => {
      const calls = getCallsFor("rpc");
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0]).toBe("save_draft_session");
      return calls[0].args[1];
    };

    it("saves a growing segment in one call, keeping its code stats", async () => {
      mockRpcResult("save_draft_session", { data: "saved", error: null });
      expect(await saveDraftSession("u1", draft)).toBe("saved");

      expect(getCallsFor("insert")).toHaveLength(0);
      expect(getCallsFor("update")).toHaveLength(0);
      expect(rpcCall()).toEqual({
        p_user_id: "u1",
        p_client_id: draft.clientId,
        p_start_time: draft.startTime,
        p_end_time: draft.endTime,
        p_duration: 2100,
        p_title: "dev-time-tracker",
        p_project_id: "p1",
        p_supervising_seconds: 300,
        p_supervising_spans: draft.supervising.spans,
        p_app_usage: draft.appUsage,
        // Growth saves don't carry code stats: null keeps the stored ones
        p_code_stats: null,
      });
    });

    it("sends the code stats of a segment that ended", async () => {
      mockRpcResult("save_draft_session", { data: "saved", error: null });
      const codeStats = [
        {
          repo_key: "github.com/me/a",
          repo_name: "a",
          commits: 1,
          files_changed: 2,
          lines_added: 10,
          lines_removed: 1,
          languages: {},
        },
      ];
      expect(await saveDraftSession("u1", { ...draft, codeStats })).toBe("saved");
      expect(rpcCall().p_code_stats).toEqual(codeStats);
    });

    it("reports a row the user already confirmed", async () => {
      mockRpcResult("save_draft_session", { data: "confirmed", error: null });
      expect(await saveDraftSession("u1", draft)).toBe("confirmed");
    });

    it("throws errors", async () => {
      mockRpcResult("save_draft_session", { data: null, error: { message: "fetch failed" } });
      await expect(saveDraftSession("u1", draft)).rejects.toMatchObject({
        message: "fetch failed",
      });
    });
  });

  // ───────────── review inbox (Phase D3) ─────────────
  describe("review inbox", () => {
    const eqArgs = () => getCallsFor("eq").map((c) => c.args);

    it("lists only the user's drafts", async () => {
      mockResult({ data: [{ id: "d1" }], error: null });
      expect(await getDraftSessions("u1")).toEqual([{ id: "d1" }]);
      expect(eqArgs()).toEqual([
        ["user_id", "u1"],
        ["status", "draft"],
      ]);
      expect(getCallsFor("gte")).toHaveLength(0);
    });

    it("lists the drafts starting within some local days", async () => {
      mockResult({ data: [], error: null });
      await getDraftSessions("u1", { startDate: "2026-10-18", endDate: "2026-10-18" });
      expect(eqArgs()).toEqual([
        ["user_id", "u1"],
        ["status", "draft"],
      ]);
      expect(getCallsFor("gte")[0].args).toEqual([
        "start_time",
        new Date(2026, 9, 18, 0, 0, 0, 0).toISOString(),
      ]);
      expect(getCallsFor("lte")[0].args[0]).toBe("start_time");
    });

    it("counts drafts without fetching them", async () => {
      mockResult({ data: null, error: null, count: 4 });
      expect(await countDraftSessions("u1")).toBe(4);
      expect(getCallsFor("select")[0].args).toEqual([
        "id",
        { count: "exact", head: true },
      ]);
    });

    it("confirms only a draft of the user", async () => {
      mockResult({ data: [{ id: "d1" }], error: null });
      const ok = await confirmDraftSession("u1", "d1", {
        title: "Checkout",
        description: null,
        projectId: "p1",
        isBillable: true,
      });
      expect(ok).toBe(true);
      expect(getCallsFor("update")[0].args[0]).toMatchObject({
        status: "confirmed",
        title: "Checkout",
        project_id: "p1",
        is_billable: true,
      });
      expect(eqArgs()).toEqual([
        ["id", "d1"],
        ["user_id", "u1"],
        ["status", "draft"],
      ]);

      mockResult({ data: [], error: null }); // already confirmed, or not ours
      expect(
        await confirmDraftSession("u1", "d1", {
          title: "x",
          description: null,
          projectId: null,
          isBillable: false,
        }),
      ).toBe(false);
    });

    it("deletes drafts only, never confirmed sessions", async () => {
      mockResult({ data: null, error: null });
      await deleteDraftSessions("u1", ["d1", "d2"]);
      expect(eqArgs()).toEqual([
        ["user_id", "u1"],
        ["status", "draft"],
      ]);
      expect(getCallsFor("in")[0].args).toEqual(["id", ["d1", "d2"]]);

      await deleteDraftSessions("u1", []);
      expect(getCallsFor("delete")).toHaveLength(1);
    });
  });
});
