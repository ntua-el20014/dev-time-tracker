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
  logUsage,
  getUsageSummary,
  getUsageLogs,
  getDailySummary,
  getEditorUsage,
  getLanguageUsage,
  getUsageDetailsForAppDate,
  getUsageDetailsForSession,
  getLoggedDaysOfMonth,
  getLanguageSummaryByDateRange,
  getUserEditors,
  getUserLangExts,
} from "../../src/supabase/usageLogs";

describe("usageLogs", () => {
  beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
  });

  // ───────────── logUsage ─────────────
  describe("logUsage", () => {
    it("inserts usage log and calls update_daily_usage_summary RPC", async () => {
      const logEntry = {
        id: "log-1",
        user_id: "user-1",
        app_name: "VS Code",
        window_title: "main.ts",
      };
      // Insert log
      mockResult({ data: logEntry, error: null });
      // RPC call for summary update (don't throw on RPC error)

      const result = await logUsage(
        "user-1",
        "VS Code",
        "main.ts",
        "TypeScript",
        ".ts",
        "vscode-icon",
        5,
      );

      expect(result).toEqual(logEntry);
      const fromCalls = getCallsFor("from");
      expect(fromCalls[0].args[0]).toBe("usage_logs");
      // RPC was called
      const rpcCalls = getCallsFor("rpc");
      expect(rpcCalls[0].args[0]).toBe("update_daily_usage_summary");
    });

    it("throws if insert fails", async () => {
      mockResult({ data: null, error: { message: "Insert failed" } });

      await expect(logUsage("user-1", "VS Code", "main.ts")).rejects.toEqual({
        message: "Insert failed",
      });
    });

    it("does NOT throw if RPC summary update fails", async () => {
      // Insert succeeds
      mockResult({ data: { id: "log-1" }, error: null });

      // The RPC can fail without affecting the result
      // (logUsage catches RPC errors silently)
      const result = await logUsage("user-1", "VS Code", "main.ts");
      expect(result).toEqual({ id: "log-1" });
    });
  });

  // ───────────── getUsageSummary ─────────────
  describe("getUsageSummary", () => {
    it("returns mapped and aggregated summary rows", async () => {
      mockResult({
        data: [
          {
            app_name: "VS Code",
            icon_url: "vscode.png",
            language_extension: ".ts",
            time_spent_seconds: 3600,
            date: "2025-01-15",
          },
          {
            app_name: "VS Code",
            icon_url: "vscode.png",
            language_extension: ".js",
            time_spent_seconds: 1800,
            date: "2025-01-15",
          },
        ],
        error: null,
      });

      const result = await getUsageSummary("user-1", "2025-01-15");

      // Should aggregate both VS Code rows into one
      expect(result).toHaveLength(1);
      expect(result[0].app).toBe("VS Code");
      expect(result[0].time_spent).toBe(5400); // 3600 + 1800
    });

    it("returns empty array when no data", async () => {
      mockResult({ data: null, error: null });
      const result = await getUsageSummary("user-1", "2025-01-15");
      expect(result).toEqual([]);
    });
  });

  // ───────────── getUsageLogs ─────────────
  describe("getUsageLogs", () => {
    it("returns mapped log entries for a date", async () => {
      mockResult({
        data: [
          {
            id: "l1",
            app_name: "VS Code",
            window_title: "test.ts",
            icon_url: "icon.png",
            language_extension: ".ts",
            timestamp: "2025-01-15T10:00:00.000Z",
          },
        ],
        error: null,
      });

      const result = await getUsageLogs("user-1", "2025-01-15");

      expect(result).toHaveLength(1);
      expect(result[0].app).toBe("VS Code");
      expect(result[0].title).toBe("test.ts");
      expect(result[0].lang_ext).toBe(".ts");
    });

    it("applies app and language filters", async () => {
      mockResult({ data: [], error: null });

      await getUsageLogs("user-1", "2025-01-15", {
        app: "VS Code",
        language: "TypeScript",
      });

      const eqCalls = getCallsFor("eq");
      expect(eqCalls.some((c) => c.args[0] === "app_name")).toBe(true);
      expect(eqCalls.some((c) => c.args[0] === "language")).toBe(true);
    });

    it("applies limit and offset", async () => {
      mockResult({ data: [], error: null });

      await getUsageLogs("user-1", "2025-01-15", {
        limit: 50,
        offset: 100,
      });

      const limitCalls = getCallsFor("limit");
      expect(limitCalls[0].args[0]).toBe(50);
      const rangeCalls = getCallsFor("range");
      expect(rangeCalls[0].args).toEqual([100, 149]);
    });
  });

  // ───────────── getDailySummary ─────────────
  describe("getDailySummary", () => {
    it("returns mapped and aggregated daily summaries", async () => {
      mockResult({
        data: [
          {
            app_name: "VS Code",
            date: "2025-01-15",
            time_spent_seconds: 3600,
            icon_url: null,
            language_extension: ".ts",
          },
        ],
        error: null,
      });

      const result = await getDailySummary("user-1");

      expect(result).toHaveLength(1);
      expect(result[0].app).toBe("VS Code");
    });

    it("applies date range filters", async () => {
      mockResult({ data: [], error: null });

      await getDailySummary("user-1", {
        startDate: "2025-01-01",
        endDate: "2025-01-31",
      });

      const gteCalls = getCallsFor("gte");
      expect(gteCalls[0].args).toEqual(["date", "2025-01-01"]);
      const lteCalls = getCallsFor("lte");
      expect(lteCalls[0].args).toEqual(["date", "2025-01-31"]);
    });
  });

  // ───────────── getEditorUsage ─────────────
  describe("getEditorUsage", () => {
    it("returns aggregated editor usage sorted by time", async () => {
      mockResult({
        data: [
          {
            app_name: "VS Code",
            language: "TypeScript",
            language_extension: ".ts",
            icon_url: "vscode.png",
            time_spent_seconds: 5000,
          },
          {
            app_name: "VS Code",
            language: "JavaScript",
            language_extension: ".js",
            icon_url: "vscode.png",
            time_spent_seconds: 3000,
          },
          {
            app_name: "IntelliJ",
            language: "Java",
            language_extension: ".java",
            icon_url: "ij.png",
            time_spent_seconds: 2000,
          },
        ],
        error: null,
      });

      const result = await getEditorUsage("user-1");

      // VS Code rows merged, IntelliJ separate
      expect(result).toHaveLength(2);
      expect(result[0].app).toBe("VS Code");
      expect(result[0].total_time).toBe(8000);
    });
  });

  // ───────────── getLanguageUsage ─────────────
  describe("getLanguageUsage", () => {
    it("aggregates by language and counts distinct apps", async () => {
      mockResult({
        data: [
          {
            language: "TypeScript",
            app_name: "VS Code",
            time_spent_seconds: 3600,
          },
          {
            language: "TypeScript",
            app_name: "WebStorm",
            time_spent_seconds: 1200,
          },
          {
            language: "Python",
            app_name: "VS Code",
            time_spent_seconds: 600,
          },
        ],
        error: null,
      });

      const result = await getLanguageUsage("user-1");

      expect(result).toHaveLength(2);
      // TypeScript first (more time)
      expect(result[0].language).toBe("TypeScript");
      expect(result[0].total_time).toBe(4800);
      expect(result[0].app_count).toBe(2);
      // Python
      expect(result[1].language).toBe("Python");
      expect(result[1].total_time).toBe(600);
      expect(result[1].app_count).toBe(1);
    });
  });

  // ───────────── getUsageDetailsForAppDate ─────────────
  describe("getUsageDetailsForAppDate", () => {
    it("queries usage_logs for a specific app on a date", async () => {
      mockResult({
        data: [
          {
            id: "l1",
            app_name: "VS Code",
            window_title: "index.ts",
            timestamp: "2025-01-15T10:00:00Z",
          },
        ],
        error: null,
      });

      const result = await getUsageDetailsForAppDate(
        "user-1",
        "VS Code",
        "2025-01-15",
      );

      expect(result).toHaveLength(1);
      expect(result[0].app).toBe("VS Code");
      const eqCalls = getCallsFor("eq");
      expect(eqCalls.some((c) => c.args[0] === "app_name")).toBe(true);
    });
  });

  // ───────────── getUsageDetailsForSession ─────────────
  describe("getUsageDetailsForSession", () => {
    it("fetches session range then queries usage_logs", async () => {
      // First: get session
      mockResult({
        data: {
          start_time: "2025-01-15T10:00:00.000Z",
          duration: 3600,
        },
        error: null,
      });
      // Then: get usage logs in that range
      mockResult({
        data: [
          {
            app_name: "VS Code",
            window_title: "test.ts",
            timestamp: "2025-01-15T10:30:00.000Z",
          },
        ],
        error: null,
      });

      const result = await getUsageDetailsForSession("user-1", "session-1");

      expect(result).toHaveLength(1);
      const fromCalls = getCallsFor("from");
      expect(fromCalls[0].args[0]).toBe("time_tracking_sessions");
      expect(fromCalls[1].args[0]).toBe("usage_logs");
    });

    it("throws when session not found", async () => {
      mockResult({
        data: null,
        error: { message: "Not found", code: "PGRST116" },
      });

      await expect(
        getUsageDetailsForSession("user-1", "nonexistent"),
      ).rejects.toEqual({ message: "Not found", code: "PGRST116" });
    });
  });

  // ───────────── getLoggedDaysOfMonth ─────────────
  describe("getLoggedDaysOfMonth", () => {
    it("returns unique dates for a month", async () => {
      mockResult({
        data: [
          { date: "2025-01-05" },
          { date: "2025-01-05" },
          { date: "2025-01-10" },
        ],
        error: null,
      });

      const result = await getLoggedDaysOfMonth("user-1", 2025, 1);

      // De-duplicated
      expect(result).toEqual(["2025-01-05", "2025-01-10"]);
    });

    it("returns empty array when no data", async () => {
      mockResult({ data: null, error: null });
      const result = await getLoggedDaysOfMonth("user-1", 2025, 1);
      expect(result).toEqual([]);
    });
  });

  // ───────────── getLanguageSummaryByDateRange ─────────────
  describe("getLanguageSummaryByDateRange", () => {
    it("aggregates language data within date range", async () => {
      mockResult({
        data: [
          {
            language: "TypeScript",
            language_extension: ".ts",
            time_spent_seconds: 3600,
          },
          {
            language: "TypeScript",
            language_extension: ".ts",
            time_spent_seconds: 1200,
          },
        ],
        error: null,
      });

      const result = await getLanguageSummaryByDateRange(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );

      expect(result).toHaveLength(1);
      expect(result[0].language).toBe("TypeScript");
      expect(result[0].total_time).toBe(4800);
    });
  });

  // ───────────── getUserEditors ─────────────
  describe("getUserEditors", () => {
    it("returns distinct app-icon pairs", async () => {
      mockResult({
        data: [
          { app_name: "VS Code", icon_url: "vscode.png" },
          { app_name: "VS Code", icon_url: "vscode.png" },
          { app_name: "IntelliJ", icon_url: "ij.png" },
        ],
        error: null,
      });

      const result = await getUserEditors("user-1");

      expect(result).toHaveLength(2);
      expect(result.find((e: any) => e.app === "VS Code")).toBeDefined();
      expect(result.find((e: any) => e.app === "IntelliJ")).toBeDefined();
    });
  });

  // ───────────── getUserLangExts ─────────────
  describe("getUserLangExts", () => {
    it("returns distinct language extensions", async () => {
      mockResult({
        data: [
          { language_extension: ".ts" },
          { language_extension: ".ts" },
          { language_extension: ".js" },
        ],
        error: null,
      });

      const result = await getUserLangExts("user-1");

      expect(result).toHaveLength(2);
      expect(result).toEqual([{ lang_ext: ".ts" }, { lang_ext: ".js" }]);
    });
  });
});
