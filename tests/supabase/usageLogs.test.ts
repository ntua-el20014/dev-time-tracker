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
  getUsageSummary,
  getDailySummary,
  getEditorUsage,
  getLanguageUsage,
  getUsageDetailsForAppDate,
  getUsageDetailsForSession,
  getLoggedDaysOfMonth,
  getLanguageSummaryByDateRange,
  getUserEditors,
  getUserLangExts,
  getBrowserUsage,
  addUsageToDailySummary,
} from "../../src/supabase/usageLogs";

describe("usageLogs", () => {
  beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
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

    it("breaks a browser's time down by category and keeps its icon (C5)", async () => {
      mockResult({
        data: [
          { app_name: "Chrome", icon_url: null, category: "docs", time_spent_seconds: 600 },
          { app_name: "Chrome", icon_url: "chrome.png", category: null, time_spent_seconds: 300 },
          { app_name: "Chrome", icon_url: null, category: "code-review", time_spent_seconds: 1200 },
          { app_name: "VS Code", icon_url: "code.png", category: null, time_spent_seconds: 100 },
        ],
        error: null,
      });

      const [chrome, code] = await getUsageSummary("user-1", "2025-01-15");

      expect(chrome).toMatchObject({ app: "Chrome", icon: "chrome.png", time_spent: 2100 });
      expect(chrome.categories).toEqual([
        { category: "code-review", seconds: 1200 },
        { category: "docs", seconds: 600 },
        { category: null, seconds: 300 },
      ]);
      expect(code.categories).toBeUndefined();
    });
  });

  describe("getBrowserUsage", () => {
    it("sums the browsers' time per category over a range", async () => {
      mockResult({
        data: [
          { category: "ai-chat", time_spent_seconds: 60 },
          { category: "ai-chat", time_spent_seconds: 60 },
          { category: null, time_spent_seconds: 30 },
        ],
        error: null,
      });

      const result = await getBrowserUsage("user-1", "2025-01-01", "2025-01-30", ["Chrome", "Opera"]);

      expect(result).toEqual([
        { category: "ai-chat", seconds: 120 },
        { category: null, seconds: 30 },
      ]);
      expect(getCallsFor("in")[0].args).toEqual(["app_name", ["Chrome", "Opera"]]);
    });

    it("asks nothing without browsers", async () => {
      expect(await getBrowserUsage("user-1", "2025-01-01", "2025-01-30", [])).toEqual([]);
      expect(getCallsFor("from")).toHaveLength(0);
    });
  });

  describe("addUsageToDailySummary", () => {
    it("throws when the RPC fails", async () => {
      mockResult({ data: null, error: { message: "rpc failed" } });
      await expect(
        addUsageToDailySummary({
          userId: "u", date: "2025-01-15", appName: "VS Code", language: null, languageExtension: null, icon: null, seconds: 10,
        }),
      ).rejects.toEqual({ message: "rpc failed" });
    });

    it("sends the local day, icon and category (C5) to the summary", async () => {
      mockResult({ data: null, error: null });
      await addUsageToDailySummary({
        userId: "u", date: "2025-01-15", appName: "Chrome", language: null, languageExtension: null, category: "docs", icon: null, seconds: 10,
      });
      expect(getCallsFor("rpc").at(-1)?.args).toEqual([
        "update_daily_usage_summary",
        expect.objectContaining({ p_date: "2025-01-15", p_category: "docs", p_icon_url: null, p_time_spent_seconds: 10 }),
      ]);
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
    it("reads one app's summary rows for a day, per language/category", async () => {
      mockResult({
        data: [
          { language: null, language_extension: null, category: "docs", time_spent_seconds: 120 },
          { language: null, language_extension: null, category: null, time_spent_seconds: 30 },
        ],
        error: null,
      });

      const result = await getUsageDetailsForAppDate("user-1", "Chrome", "2025-01-15");

      expect(result).toEqual([
        { language: null, language_extension: null, category: "docs", seconds: 120 },
        { language: null, language_extension: null, category: null, seconds: 30 },
      ]);
      expect(getCallsFor("from")[0].args[0]).toBe("daily_usage_summary");
      const eqCalls = getCallsFor("eq").map((c) => c.args);
      expect(eqCalls).toContainEqual(["user_id", "user-1"]);
      expect(eqCalls).toContainEqual(["app_name", "Chrome"]);
      expect(eqCalls).toContainEqual(["date", "2025-01-15"]);
    });
  });

  // ───────────── getUsageDetailsForSession ─────────────
  describe("getUsageDetailsForSession", () => {
    it("returns the user's session with its app usage", async () => {
      const appUsage = [{ app: "VS Code", language: "TypeScript", category: null, seconds: 600 }];
      mockResult({
        data: { id: "session-1", start_time: "2025-01-15T10:00:00.000Z", duration: 3600, app_usage: appUsage },
        error: null,
      });

      const result = await getUsageDetailsForSession("user-1", "session-1");

      expect(result.session).toMatchObject({ duration: 3600, app_usage: appUsage });
      expect(getCallsFor("from").map((c) => c.args[0])).toEqual(["time_tracking_sessions"]);
      expect(getCallsFor("select")[0].args[0]).toContain("app_usage");
      expect(getCallsFor("eq").map((c) => c.args)).toContainEqual(["user_id", "user-1"]);
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
