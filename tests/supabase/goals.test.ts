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
  setDailyGoal,
  getDailyGoal,
  completeDailyGoal,
  deleteDailyGoal,
  getAllDailyGoals,
  getTotalTimeForDay,
} from "../../src/supabase/goals";

describe("goals", () => {
  beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
  });

  // ───────────── setDailyGoal ─────────────
  describe("setDailyGoal", () => {
    it("upserts a daily goal", async () => {
      const goal = {
        id: "g1",
        user_id: "user-1",
        date: "2025-01-15",
        target_minutes: 120,
        is_completed: false,
      };
      mockResult({ data: goal, error: null });

      const result = await setDailyGoal("user-1", "2025-01-15", 120);

      expect(result).toEqual(goal);
      const upsertCalls = getCallsFor("upsert");
      expect(upsertCalls[0].args[0].target_minutes).toBe(120);
      expect(upsertCalls[0].args[1]).toEqual({
        onConflict: "user_id,date",
      });
    });

    it("includes description when provided", async () => {
      mockResult({
        data: { id: "g1", description: "Focus on frontend" },
        error: null,
      });

      await setDailyGoal("user-1", "2025-01-15", 120, "Focus on frontend");

      const upsertCalls = getCallsFor("upsert");
      expect(upsertCalls[0].args[0].description).toBe("Focus on frontend");
    });

    it("throws on error", async () => {
      mockResult({ data: null, error: { message: "Upsert failed" } });
      await expect(setDailyGoal("user-1", "2025-01-15", 120)).rejects.toEqual({
        message: "Upsert failed",
      });
    });
  });

  // ───────────── getDailyGoal ─────────────
  describe("getDailyGoal", () => {
    it("returns goal for a specific date", async () => {
      const goal = { id: "g1", date: "2025-01-15", target_minutes: 120 };
      mockResult({ data: goal, error: null });

      const result = await getDailyGoal("user-1", "2025-01-15");

      expect(result).toEqual(goal);
      const eqCalls = getCallsFor("eq");
      expect(eqCalls.some((c) => c.args[0] === "date")).toBe(true);
    });

    it("returns null when not found (PGRST116)", async () => {
      mockResult({
        data: null,
        error: { code: "PGRST116", message: "not found" },
      });

      const result = await getDailyGoal("user-1", "2025-01-15");
      expect(result).toBeNull();
    });

    it("throws on unexpected error", async () => {
      mockResult({
        data: null,
        error: { code: "42P01", message: "table error" },
      });

      await expect(getDailyGoal("user-1", "2025-01-15")).rejects.toEqual({
        code: "42P01",
        message: "table error",
      });
    });
  });

  // ───────────── completeDailyGoal ─────────────
  describe("completeDailyGoal", () => {
    it("marks a goal as completed", async () => {
      const completedGoal = {
        id: "g1",
        is_completed: true,
        completed_at: "2025-01-15T18:00:00.000Z",
      };
      mockResult({ data: completedGoal, error: null });

      const result = await completeDailyGoal("user-1", "2025-01-15");

      expect(result.is_completed).toBe(true);
      const updateCalls = getCallsFor("update");
      expect(updateCalls[0].args[0].is_completed).toBe(true);
      expect(updateCalls[0].args[0].completed_at).toBeDefined();
    });
  });

  // ───────────── deleteDailyGoal ─────────────
  describe("deleteDailyGoal", () => {
    it("deletes a daily goal by user+date", async () => {
      mockResult({ data: null, error: null });

      await deleteDailyGoal("user-1", "2025-01-15");

      const fromCalls = getCallsFor("from");
      expect(fromCalls[0].args[0]).toBe("daily_work_goals");
      const eqCalls = getCallsFor("eq");
      expect(eqCalls[0].args).toEqual(["user_id", "user-1"]);
      expect(eqCalls[1].args).toEqual(["date", "2025-01-15"]);
    });

    it("throws on error", async () => {
      mockResult({ data: null, error: { message: "Delete failed" } });
      await expect(deleteDailyGoal("user-1", "2025-01-15")).rejects.toEqual({
        message: "Delete failed",
      });
    });
  });

  // ───────────── getAllDailyGoals ─────────────
  describe("getAllDailyGoals", () => {
    it("returns all goals ordered by date descending", async () => {
      const goals = [
        { id: "g2", date: "2025-01-16" },
        { id: "g1", date: "2025-01-15" },
      ];
      mockResult({ data: goals, error: null });

      const result = await getAllDailyGoals("user-1");

      expect(result).toEqual(goals);
      const orderCalls = getCallsFor("order");
      expect(orderCalls[0].args).toEqual(["date", { ascending: false }]);
    });

    it("returns empty array when no goals", async () => {
      mockResult({ data: null, error: null });
      const result = await getAllDailyGoals("user-1");
      expect(result).toEqual([]);
    });
  });

  // ───────────── getTotalTimeForDay ─────────────
  describe("getTotalTimeForDay", () => {
    it("sums time_spent_seconds and converts to minutes", async () => {
      mockResult({
        data: [{ time_spent_seconds: 1800 }, { time_spent_seconds: 1200 }],
        error: null,
      });

      const result = await getTotalTimeForDay("user-1", "2025-01-15");

      expect(result).toBe(50); // (1800 + 1200) / 60
    });

    it("returns 0 when no data", async () => {
      mockResult({ data: null, error: null });

      const result = await getTotalTimeForDay("user-1", "2025-01-15");
      expect(result).toBe(0);
    });

    it("returns 0 for empty array", async () => {
      mockResult({ data: [], error: null });

      const result = await getTotalTimeForDay("user-1", "2025-01-15");
      expect(result).toBe(0);
    });

    it("handles null time_spent_seconds gracefully", async () => {
      mockResult({
        data: [{ time_spent_seconds: null }, { time_spent_seconds: 600 }],
        error: null,
      });

      const result = await getTotalTimeForDay("user-1", "2025-01-15");
      expect(result).toBe(10); // 600 / 60
    });
  });
});
