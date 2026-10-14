import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mockResult,
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
    it("deletes sessions by IDs", async () => {
      mockResult({ data: null, error: null });

      await deleteSessions(["s1", "s2", "s3"]);

      const inCalls = getCallsFor("in");
      expect(inCalls[0].args).toEqual(["id", ["s1", "s2", "s3"]]);
    });

    it("throws on error", async () => {
      mockResult({
        data: null,
        error: { message: "Delete failed" },
      });

      await expect(deleteSessions(["s1"])).rejects.toEqual({
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
    it("updates session fields", async () => {
      const updated = { id: "s1", title: "New Title", is_billable: true };
      mockResult({ data: updated, error: null });

      const result = await updateSession("s1", {
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
    });

    it("throws on error", async () => {
      mockResult({ data: null, error: { message: "Update failed" } });

      await expect(updateSession("s1", { title: "Fail" })).rejects.toEqual({
        message: "Update failed",
      });
    });
  });

  // ───────────── deleteSession ─────────────
  describe("deleteSession", () => {
    it("deletes a single session", async () => {
      mockResult({ data: null, error: null });

      await deleteSession("s1");

      const fromCalls = getCallsFor("from");
      expect(fromCalls[0].args[0]).toBe("time_tracking_sessions");
      const eqCalls = getCallsFor("eq");
      expect(eqCalls[0].args).toEqual(["id", "s1"]);
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
});
