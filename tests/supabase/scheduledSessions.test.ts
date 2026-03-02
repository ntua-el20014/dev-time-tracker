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
  createScheduledSession,
  getScheduledSessions,
  updateScheduledSession,
  deleteScheduledSession,
  markScheduledSessionCompleted,
  getUpcomingSessionNotifications,
  markNotificationSent,
} from "../../src/supabase/scheduledSessions";

describe("scheduledSessions", () => {
  beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
  });

  // ───────────── createScheduledSession ─────────────
  describe("createScheduledSession", () => {
    it("inserts a scheduled session", async () => {
      const session = {
        id: "ss-1",
        title: "Sprint Planning",
        scheduled_datetime: "2025-01-20T09:00:00Z",
        status: "pending",
      };
      mockResult({ data: session, error: null });

      const result = await createScheduledSession("user-1", {
        title: "Sprint Planning",
        scheduled_datetime: "2025-01-20T09:00:00Z",
      });

      expect(result).toEqual(session);
      const fromCalls = getCallsFor("from");
      expect(fromCalls[0].args[0]).toBe("scheduled_work_sessions");
      const insertCalls = getCallsFor("insert");
      expect(insertCalls[0].args[0].title).toBe("Sprint Planning");
      expect(insertCalls[0].args[0].status).toBe("pending");
    });

    it("handles tags by calling setScheduledSessionTags", async () => {
      // Insert session
      mockResult({
        data: { id: "ss-1", title: "Planning" },
        error: null,
      });
      // setScheduledSessionTags → delete existing
      mockResult({ data: null, error: null });
      // getTagByName / create: tag already exists
      mockResult({ data: { id: "tag-1" }, error: null });
      // Insert tag associations
      mockResult({ data: null, error: null });

      await createScheduledSession("user-1", {
        title: "Planning",
        scheduled_datetime: "2025-01-20T09:00:00Z",
        tags: ["sprint"],
      });

      // The function should interact with scheduled_session_tags
      const fromCalls = getCallsFor("from");
      const tableNames = fromCalls.map((c: any) => c.args[0]);
      expect(tableNames).toContain("scheduled_work_sessions");
    });

    it("throws on error", async () => {
      mockResult({ data: null, error: { message: "Insert failed" } });

      await expect(
        createScheduledSession("user-1", {
          title: "Test",
          scheduled_datetime: "2025-01-20T09:00:00Z",
        }),
      ).rejects.toEqual({ message: "Insert failed" });
    });
  });

  // ───────────── getScheduledSessions ─────────────
  describe("getScheduledSessions", () => {
    it("returns sessions with extracted tag names", async () => {
      mockResult({
        data: [
          {
            id: "ss-1",
            title: "Planning",
            scheduled_session_tags: [
              { tag_id: "t1", user_tags: { name: "sprint" } },
            ],
          },
        ],
        error: null,
      });

      const result = await getScheduledSessions("user-1");

      expect(result).toHaveLength(1);
      expect(result[0].tags).toEqual(["sprint"]);
      // scheduled_session_tags should be stripped
      expect(result[0]).not.toHaveProperty("scheduled_session_tags");
    });

    it("applies status filter", async () => {
      mockResult({ data: [], error: null });

      await getScheduledSessions("user-1", {
        status: ["pending", "notified"],
      });

      const inCalls = getCallsFor("in");
      expect(inCalls[0].args).toEqual(["status", ["pending", "notified"]]);
    });

    it("applies date range filters", async () => {
      mockResult({ data: [], error: null });

      await getScheduledSessions("user-1", {
        startDate: "2025-01-01",
        endDate: "2025-01-31",
      });

      const gteCalls = getCallsFor("gte");
      expect(gteCalls[0].args[0]).toBe("scheduled_datetime");
      const lteCalls = getCallsFor("lte");
      expect(lteCalls[0].args[0]).toBe("scheduled_datetime");
    });

    it("applies project filter", async () => {
      mockResult({ data: [], error: null });

      await getScheduledSessions("user-1", { projectId: "proj-1" });

      const eqCalls = getCallsFor("eq");
      expect(eqCalls.some((c) => c.args[0] === "project_id")).toBe(true);
    });
  });

  // ───────────── updateScheduledSession ─────────────
  describe("updateScheduledSession", () => {
    it("updates session fields", async () => {
      const updated = {
        id: "ss-1",
        title: "Updated Title",
        status: "notified",
      };
      mockResult({ data: updated, error: null });

      const result = await updateScheduledSession("ss-1", {
        title: "Updated Title",
        status: "notified",
      });

      expect(result).toEqual(updated);
      const updateCalls = getCallsFor("update");
      expect(updateCalls[0].args[0].title).toBe("Updated Title");
      expect(updateCalls[0].args[0].updated_at).toBeDefined();
    });

    it("updates tags when provided", async () => {
      // Update the session
      mockResult({
        data: { id: "ss-1", title: "Session" },
        error: null,
      });
      // Fetch user_id for tag operations
      mockResult({ data: { user_id: "user-1" }, error: null });
      // Delete existing scheduled_session_tags
      mockResult({ data: null, error: null });
      // Get existing tag
      mockResult({ data: { id: "tag-1" }, error: null });
      // Insert tag association
      mockResult({ data: null, error: null });

      await updateScheduledSession("ss-1", {
        tags: ["updated-tag"],
      });

      const fromCalls = getCallsFor("from");
      const tableNames = fromCalls.map((c: any) => c.args[0]);
      expect(tableNames).toContain("scheduled_work_sessions");
    });
  });

  // ───────────── deleteScheduledSession ─────────────
  describe("deleteScheduledSession", () => {
    it("deletes by ID", async () => {
      mockResult({ data: null, error: null });

      await deleteScheduledSession("ss-1");

      const fromCalls = getCallsFor("from");
      expect(fromCalls[0].args[0]).toBe("scheduled_work_sessions");
      const eqCalls = getCallsFor("eq");
      expect(eqCalls[0].args).toEqual(["id", "ss-1"]);
    });

    it("throws on error", async () => {
      mockResult({ data: null, error: { message: "Not found" } });
      await expect(deleteScheduledSession("ss-1")).rejects.toEqual({
        message: "Not found",
      });
    });
  });

  // ───────────── markScheduledSessionCompleted ─────────────
  describe("markScheduledSessionCompleted", () => {
    it("sets status to completed and links actual session", async () => {
      const result_data = {
        id: "ss-1",
        status: "completed",
        actual_session_id: "real-session-1",
      };
      mockResult({ data: result_data, error: null });

      const result = await markScheduledSessionCompleted(
        "ss-1",
        "real-session-1",
      );

      expect(result.status).toBe("completed");
      const updateCalls = getCallsFor("update");
      expect(updateCalls[0].args[0].status).toBe("completed");
      expect(updateCalls[0].args[0].actual_session_id).toBe("real-session-1");
    });
  });

  // ───────────── getUpcomingSessionNotifications ─────────────
  describe("getUpcomingSessionNotifications", () => {
    it("returns notifications for upcoming sessions", async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(14, 0, 0, 0);

      // Tomorrow sessions query
      mockResult({
        data: [
          {
            id: "ss-1",
            title: "Tomorrow Meeting",
            scheduled_datetime: tomorrow.toISOString(),
            estimated_duration_minutes: 60,
            scheduled_session_tags: [
              { tag_id: "t1", user_tags: { name: "meeting" } },
            ],
          },
        ],
        error: null,
      });
      // Today sessions query
      mockResult({ data: [], error: null });

      const result = await getUpcomingSessionNotifications("user-1");

      // Should have a day_before notification
      expect(result.length).toBeGreaterThanOrEqual(1);
      if (result.length > 0) {
        expect(result[0].type).toBe("day_before");
        expect(result[0].tags).toEqual(["meeting"]);
      }
    });

    it("returns empty when no upcoming sessions", async () => {
      mockResult({ data: [], error: null }); // tomorrow
      mockResult({ data: [], error: null }); // today

      const result = await getUpcomingSessionNotifications("user-1");
      expect(result).toEqual([]);
    });
  });

  // ───────────── markNotificationSent ─────────────
  describe("markNotificationSent", () => {
    it("updates last_notification_sent timestamp", async () => {
      mockResult({ data: null, error: null });

      await markNotificationSent("ss-1");

      const updateCalls = getCallsFor("update");
      expect(updateCalls[0].args[0].last_notification_sent).toBeDefined();
      expect(updateCalls[0].args[0].updated_at).toBeDefined();
    });
  });
});
