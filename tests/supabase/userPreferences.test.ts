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
  getUserPreferences,
  updateUserPreferences,
  getEditorColors,
  setEditorColor,
  getTheme,
  setTheme,
  getAccentColor,
  setAccentColor,
  getNotificationSettings,
  setNotificationSettings,
  getIdleTimeout,
  setIdleTimeout,
} from "../../src/supabase/userPreferences";

const DEFAULT_PREFS_ROW = {
  user_id: "user-1",
  theme: "dark" as const,
  accent_color: { light: "#007acc", dark: "#f0db4f" },
  editor_colors: { "VS Code": "#007acc" },
  notification_settings: {
    enabled: true,
    scheduledSessions: true,
    dailyGoals: true,
  },
  idle_timeout_seconds: 300,
  created_at: "2025-01-01",
  updated_at: "2025-01-01",
};

describe("userPreferences", () => {
  beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
  });

  // ───────────── getUserPreferences ─────────────
  describe("getUserPreferences", () => {
    it("returns parsed preferences", async () => {
      mockResult({ data: DEFAULT_PREFS_ROW, error: null });

      const result = await getUserPreferences("user-1");

      expect(result.theme).toBe("dark");
      expect(result.accent_color.light).toBe("#007acc");
      expect(result.editor_colors["VS Code"]).toBe("#007acc");
      expect(result.idle_timeout_seconds).toBe(300);
    });

    it("creates defaults when PGRST116 (not found)", async () => {
      // First call: select → not found
      mockResult({
        data: null,
        error: { code: "PGRST116", message: "not found" },
      });
      // Second call: insert defaults → returns new row
      mockResult({
        data: {
          user_id: "user-1",
          theme: "dark",
          accent_color: { light: "#007acc", dark: "#f0db4f" },
          editor_colors: {},
          notification_settings: {
            enabled: true,
            scheduledSessions: true,
            dailyGoals: true,
          },
          idle_timeout_seconds: 300,
        },
        error: null,
      });

      const result = await getUserPreferences("user-1");

      expect(result.theme).toBe("dark");
      expect(result.idle_timeout_seconds).toBe(300);
      // Verify insert was called
      const insertCalls = getCallsFor("insert");
      expect(insertCalls.length).toBe(1);
    });

    it("throws on unexpected error", async () => {
      mockResult({
        data: null,
        error: { code: "42P01", message: "table not found" },
      });

      await expect(getUserPreferences("user-1")).rejects.toEqual({
        code: "42P01",
        message: "table not found",
      });
    });
  });

  // ───────────── updateUserPreferences ─────────────
  describe("updateUserPreferences", () => {
    it("updates specified fields", async () => {
      mockResult({
        data: { ...DEFAULT_PREFS_ROW, theme: "light" },
        error: null,
      });

      const result = await updateUserPreferences("user-1", {
        theme: "light",
      });

      expect(result.theme).toBe("light");
      const updateCalls = getCallsFor("update");
      expect(updateCalls[0].args[0].theme).toBe("light");
      expect(updateCalls[0].args[0].updated_at).toBeDefined();
    });

    it("updates multiple fields at once", async () => {
      mockResult({
        data: {
          ...DEFAULT_PREFS_ROW,
          theme: "system",
          idle_timeout_seconds: 600,
        },
        error: null,
      });

      const result = await updateUserPreferences("user-1", {
        theme: "system",
        idle_timeout_seconds: 600,
      });

      expect(result.theme).toBe("system");
      expect(result.idle_timeout_seconds).toBe(600);
    });
  });

  // ───────────── getEditorColors ─────────────
  describe("getEditorColors", () => {
    it("returns editor color map", async () => {
      mockResult({ data: DEFAULT_PREFS_ROW, error: null });

      const result = await getEditorColors("user-1");

      expect(result).toEqual({ "VS Code": "#007acc" });
    });
  });

  // ───────────── setEditorColor ─────────────
  describe("setEditorColor", () => {
    it("gets current colors, adds new one, and updates", async () => {
      // getEditorColors → getUserPreferences
      mockResult({ data: DEFAULT_PREFS_ROW, error: null });
      // updateUserPreferences → update
      mockResult({
        data: {
          ...DEFAULT_PREFS_ROW,
          editor_colors: { "VS Code": "#007acc", IntelliJ: "#ff5733" },
        },
        error: null,
      });

      await setEditorColor("user-1", "IntelliJ", "#ff5733");

      const updateCalls = getCallsFor("update");
      expect(updateCalls.length).toBe(1);
    });
  });

  // ───────────── getTheme / setTheme ─────────────
  describe("getTheme", () => {
    it("returns current theme", async () => {
      mockResult({ data: DEFAULT_PREFS_ROW, error: null });
      const result = await getTheme("user-1");
      expect(result).toBe("dark");
    });
  });

  describe("setTheme", () => {
    it("updates theme preference", async () => {
      mockResult({
        data: { ...DEFAULT_PREFS_ROW, theme: "light" },
        error: null,
      });

      await setTheme("user-1", "light");

      const updateCalls = getCallsFor("update");
      expect(updateCalls[0].args[0].theme).toBe("light");
    });
  });

  // ───────────── getAccentColor / setAccentColor ─────────────
  describe("getAccentColor", () => {
    it("returns accent for light mode", async () => {
      mockResult({ data: DEFAULT_PREFS_ROW, error: null });
      const result = await getAccentColor("user-1", "light");
      expect(result).toBe("#007acc");
    });

    it("returns accent for dark mode", async () => {
      mockResult({ data: DEFAULT_PREFS_ROW, error: null });
      const result = await getAccentColor("user-1", "dark");
      expect(result).toBe("#f0db4f");
    });
  });

  describe("setAccentColor", () => {
    it("updates accent color for specified mode", async () => {
      // getUserPreferences
      mockResult({ data: DEFAULT_PREFS_ROW, error: null });
      // updateUserPreferences
      mockResult({
        data: {
          ...DEFAULT_PREFS_ROW,
          accent_color: { light: "#ff0000", dark: "#f0db4f" },
        },
        error: null,
      });

      await setAccentColor("user-1", "#ff0000", "light");

      const updateCalls = getCallsFor("update");
      expect(updateCalls[0].args[0].accent_color.light).toBe("#ff0000");
      expect(updateCalls[0].args[0].accent_color.dark).toBe("#f0db4f");
    });
  });

  // ───────────── getNotificationSettings / setNotificationSettings ─────────────
  describe("getNotificationSettings", () => {
    it("returns notification settings", async () => {
      mockResult({ data: DEFAULT_PREFS_ROW, error: null });
      const result = await getNotificationSettings("user-1");
      expect(result.enabled).toBe(true);
      expect(result.scheduledSessions).toBe(true);
    });
  });

  describe("setNotificationSettings", () => {
    it("updates notification settings", async () => {
      mockResult({
        data: {
          ...DEFAULT_PREFS_ROW,
          notification_settings: { enabled: false },
        },
        error: null,
      });

      await setNotificationSettings("user-1", { enabled: false });

      const updateCalls = getCallsFor("update");
      expect(updateCalls[0].args[0].notification_settings).toEqual({
        enabled: false,
      });
    });
  });

  // ───────────── getIdleTimeout / setIdleTimeout ─────────────
  describe("getIdleTimeout", () => {
    it("returns idle timeout in seconds", async () => {
      mockResult({ data: DEFAULT_PREFS_ROW, error: null });
      const result = await getIdleTimeout("user-1");
      expect(result).toBe(300);
    });
  });

  describe("setIdleTimeout", () => {
    it("updates idle timeout", async () => {
      mockResult({
        data: { ...DEFAULT_PREFS_ROW, idle_timeout_seconds: 600 },
        error: null,
      });

      await setIdleTimeout("user-1", 600);

      const updateCalls = getCallsFor("update");
      expect(updateCalls[0].args[0].idle_timeout_seconds).toBe(600);
    });
  });
});
