import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mockResult,
  resetMockState,
  getCallsFor,
} from "../helpers/supabaseMock";

vi.mock("../../src/supabase/config", async () => {
  const { mockSupabase } = await import("../helpers/supabaseMock");
  return { supabase: mockSupabase };
});

import {
  getAllTags,
  createTag,
  updateTag,
  deleteTag,
  getSessionTags,
  setSessionTags,
  setSessionTagsByNames,
  getTagByName,
} from "../../src/supabase/tags";

describe("tags", () => {
  beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
  });

  // ───────────── getAllTags ─────────────
  describe("getAllTags", () => {
    it("returns all tags for a user ordered by name", async () => {
      const tags = [
        { id: "t1", name: "bug", color: "#ff0000" },
        { id: "t2", name: "feature", color: "#00ff00" },
      ];
      mockResult({ data: tags, error: null });

      const result = await getAllTags("user-1");

      expect(result).toEqual(tags);
      const fromCalls = getCallsFor("from");
      expect(fromCalls[0].args[0]).toBe("user_tags");
      const orderCalls = getCallsFor("order");
      expect(orderCalls[0].args).toEqual(["name", { ascending: true }]);
    });

    it("returns empty array when no tags", async () => {
      mockResult({ data: null, error: null });
      const result = await getAllTags("user-1");
      expect(result).toEqual([]);
    });

    it("throws on error", async () => {
      mockResult({ data: null, error: { message: "DB error" } });
      await expect(getAllTags("user-1")).rejects.toEqual({
        message: "DB error",
      });
    });
  });

  // ───────────── createTag ─────────────
  describe("createTag", () => {
    it("creates a new tag with default color", async () => {
      const tag = { id: "t1", name: "bugfix", color: "#f0db4f" };
      mockResult({ data: tag, error: null });

      const result = await createTag("user-1", "bugfix");

      expect(result).toEqual(tag);
      const insertCalls = getCallsFor("insert");
      expect(insertCalls[0].args[0].color).toBe("#f0db4f");
    });

    it("creates a tag with custom color", async () => {
      const tag = { id: "t1", name: "urgent", color: "#ff0000" };
      mockResult({ data: tag, error: null });

      const result = await createTag("user-1", "urgent", "#ff0000");

      expect(result).toEqual(tag);
      const insertCalls = getCallsFor("insert");
      expect(insertCalls[0].args[0].color).toBe("#ff0000");
    });

    it("returns existing tag on unique constraint violation (23505)", async () => {
      // Insert fails with 23505
      mockResult({
        data: null,
        error: { code: "23505", message: "duplicate" },
      });
      // Then fetch existing
      mockResult({
        data: { id: "t1", name: "bugfix", color: "#f0db4f" },
        error: null,
      });

      const result = await createTag("user-1", "bugfix");
      expect(result).toEqual({ id: "t1", name: "bugfix", color: "#f0db4f" });
    });

    it("throws on non-duplicate error", async () => {
      mockResult({
        data: null,
        error: { code: "42P01", message: "table not found" },
      });

      await expect(createTag("user-1", "bugfix")).rejects.toEqual({
        code: "42P01",
        message: "table not found",
      });
    });
  });

  // ───────────── updateTag ─────────────
  describe("updateTag", () => {
    it("updates tag name and color", async () => {
      const updated = { id: "t1", name: "new-name", color: "#abcdef" };
      mockResult({ data: updated, error: null });

      const result = await updateTag("t1", {
        name: "new-name",
        color: "#abcdef",
      });

      expect(result).toEqual(updated);
      const updateCalls = getCallsFor("update");
      expect(updateCalls[0].args[0].name).toBe("new-name");
      expect(updateCalls[0].args[0].updated_at).toBeDefined();
    });
  });

  // ───────────── deleteTag ─────────────
  describe("deleteTag", () => {
    it("deletes a tag by ID", async () => {
      mockResult({ data: null, error: null });

      await deleteTag("t1");

      const fromCalls = getCallsFor("from");
      expect(fromCalls[0].args[0]).toBe("user_tags");
      const eqCalls = getCallsFor("eq");
      expect(eqCalls[0].args).toEqual(["id", "t1"]);
    });

    it("throws on error", async () => {
      mockResult({ data: null, error: { message: "FK violation" } });
      await expect(deleteTag("t1")).rejects.toEqual({
        message: "FK violation",
      });
    });
  });

  // ───────────── getSessionTags ─────────────
  describe("getSessionTags", () => {
    it("returns tags for a session", async () => {
      mockResult({
        data: [
          { tag_id: "t1", user_tags: { id: "t1", name: "bug", color: "#f00" } },
          { tag_id: "t2", user_tags: { id: "t2", name: "ui", color: "#0f0" } },
        ],
        error: null,
      });

      const result = await getSessionTags("session-1");

      expect(result).toEqual([
        { id: "t1", name: "bug", color: "#f00" },
        { id: "t2", name: "ui", color: "#0f0" },
      ]);
    });

    it("filters out null user_tags entries", async () => {
      mockResult({
        data: [
          { tag_id: "t1", user_tags: { id: "t1", name: "bug", color: "#f00" } },
          { tag_id: "t2", user_tags: null },
        ],
        error: null,
      });

      const result = await getSessionTags("session-1");
      expect(result).toHaveLength(1);
    });

    it("returns empty array when no tags", async () => {
      mockResult({ data: null, error: null });
      const result = await getSessionTags("session-1");
      expect(result).toEqual([]);
    });
  });

  // ───────────── setSessionTags ─────────────
  describe("setSessionTags", () => {
    it("deletes existing and inserts new tags", async () => {
      // Delete existing
      mockResult({ data: null, error: null });
      // Insert new
      mockResult({ data: null, error: null });

      await setSessionTags("session-1", ["t1", "t2"]);

      const fromCalls = getCallsFor("from");
      expect(fromCalls[0].args[0]).toBe("session_tags");
      expect(fromCalls[1].args[0]).toBe("session_tags");
      const insertCalls = getCallsFor("insert");
      expect(insertCalls[0].args[0]).toEqual([
        { session_id: "session-1", tag_id: "t1" },
        { session_id: "session-1", tag_id: "t2" },
      ]);
    });

    it("only deletes when tagIds is empty", async () => {
      mockResult({ data: null, error: null });

      await setSessionTags("session-1", []);

      const insertCalls = getCallsFor("insert");
      expect(insertCalls.length).toBe(0);
    });
  });

  // ───────────── setSessionTagsByNames ─────────────
  describe("setSessionTagsByNames", () => {
    it("creates tags then sets them on the session", async () => {
      // createTag call 1 → returns tag
      mockResult({ data: { id: "t1", name: "bug" }, error: null });
      // createTag call 2 → returns tag
      mockResult({ data: { id: "t2", name: "feature" }, error: null });
      // setSessionTags → delete existing
      mockResult({ data: null, error: null });
      // setSessionTags → insert new
      mockResult({ data: null, error: null });

      await setSessionTagsByNames("user-1", "session-1", ["bug", "feature"]);

      // Verify session_tags inserts
      const insertCalls = getCallsFor("insert");
      // insertCalls[0] and [1] are createTag inserts, [2] is setSessionTags insert
      expect(insertCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ───────────── getTagByName ─────────────
  describe("getTagByName", () => {
    it("returns tag when found", async () => {
      const tag = { id: "t1", name: "bug", color: "#f00" };
      mockResult({ data: tag, error: null });

      const result = await getTagByName("user-1", "bug");
      expect(result).toEqual(tag);
    });

    it("returns null when not found (PGRST116)", async () => {
      mockResult({
        data: null,
        error: { code: "PGRST116", message: "not found" },
      });

      const result = await getTagByName("user-1", "nonexistent");
      expect(result).toBeNull();
    });

    it("throws on unexpected error", async () => {
      mockResult({
        data: null,
        error: { code: "42P01", message: "table error" },
      });

      await expect(getTagByName("user-1", "bug")).rejects.toEqual({
        code: "42P01",
        message: "table error",
      });
    });
  });
});
