/**
 * IPC Handler Tests
 *
 * These test the IPC handler layer that bridges renderer ↔ main process.
 * The pattern: ipcMain.handle("channel", handler) captures handlers;
 * we extract them via a mock and invoke them directly.
 *
 * Each handler typically: getCurrentUser() → call supabase module → return result
 * On error: logError() → return fallback ([], false, null, 0)
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// ─── Mock electron ───
const registeredHandlers: Record<string, Function> = {};

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      registeredHandlers[channel] = handler;
    }),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  app: {
    getPath: vi.fn().mockReturnValue("/tmp"),
    isReady: vi.fn().mockReturnValue(true),
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(),
}));

// ─── Mock Supabase config (client) ───
import {
  createMockSupabase,
  mockResult,
  mockResults,
  resetMockState,
  getCallsFor,
} from "../helpers/supabaseMock";

const mockSupabase = createMockSupabase();
vi.mock("../../src/supabase/config", () => ({
  supabase: mockSupabase,
}));

// ─── Mock getCurrentUser ───
const mockGetCurrentUser = vi.fn();
vi.mock("../../src/supabase/api", () => ({
  getCurrentUser: (...args: any[]) => mockGetCurrentUser(...args),
}));

// ─── Mock supabase modules ───
const mockGetAllSessions = vi.fn();
const mockUpdateSession = vi.fn();
const mockDeleteSession = vi.fn();
const mockGetSmallSessions = vi.fn();
const mockDeleteSessions = vi.fn();

vi.mock("../../src/supabase/timeTracking", () => ({
  getAllSessions: (...args: any[]) => mockGetAllSessions(...args),
  updateSession: (...args: any[]) => mockUpdateSession(...args),
  deleteSession: (...args: any[]) => mockDeleteSession(...args),
  getSmallSessions: (...args: any[]) => mockGetSmallSessions(...args),
  deleteSessions: (...args: any[]) => mockDeleteSessions(...args),
}));

const mockSetSessionTagsByNames = vi.fn();
vi.mock("../../src/supabase/tags", () => ({
  setSessionTagsByNames: (...args: any[]) => mockSetSessionTagsByNames(...args),
}));

const mockSetDailyGoal = vi.fn();
const mockGetDailyGoal = vi.fn();
const mockDeleteDailyGoal = vi.fn();
const mockCompleteDailyGoal = vi.fn();
const mockGetTotalTimeForDay = vi.fn();
const mockGetAllDailyGoals = vi.fn();

vi.mock("../../src/supabase/goals", () => ({
  setDailyGoal: (...args: any[]) => mockSetDailyGoal(...args),
  getDailyGoal: (...args: any[]) => mockGetDailyGoal(...args),
  deleteDailyGoal: (...args: any[]) => mockDeleteDailyGoal(...args),
  completeDailyGoal: (...args: any[]) => mockCompleteDailyGoal(...args),
  getTotalTimeForDay: (...args: any[]) => mockGetTotalTimeForDay(...args),
  getAllDailyGoals: (...args: any[]) => mockGetAllDailyGoals(...args),
}));

// ─── Mock logError (suppress console noise) ───
vi.mock("../../src/utils/errorHandler", () => ({
  logError: vi.fn(),
}));

// ─── Import the handler modules to trigger registration ───
beforeAll(async () => {
  await import("../../src/ipc/sessionHandlers");
  await import("../../src/ipc/goalHandlers");
});

describe("IPC: Session Handlers", () => {
  const fakeEvent = {} as any;
  const fakeUser = { id: "user-1", email: "test@test.com" };

  beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue(fakeUser);
  });

  describe("get-sessions", () => {
    it("returns enriched sessions for authenticated user", async () => {
      const rawSessions = [
        { id: "s1", start_time: "2025-01-15T10:00:00Z", project_id: null },
      ];
      mockGetAllSessions.mockResolvedValue(rawSessions);
      // enrichSessions: session_tags query
      mockResult({ data: [], error: null });

      const handler = registeredHandlers["get-sessions"];
      const result = await handler(fakeEvent);

      expect(mockGetAllSessions).toHaveBeenCalledWith("user-1", {});
      expect(result).toHaveLength(1);
      expect(result[0].date).toBe("2025-01-15");
      expect(result[0].tags).toEqual([]);
    });

    it("returns [] when user not authenticated", async () => {
      mockGetCurrentUser.mockResolvedValue(null);

      const handler = registeredHandlers["get-sessions"];
      const result = await handler(fakeEvent);

      expect(result).toEqual([]);
    });

    it("returns [] on error", async () => {
      mockGetAllSessions.mockRejectedValue(new Error("DB down"));

      const handler = registeredHandlers["get-sessions"];
      const result = await handler(fakeEvent);

      expect(result).toEqual([]);
    });

    it("passes filters correctly", async () => {
      mockGetAllSessions.mockResolvedValue([]);

      const handler = registeredHandlers["get-sessions"];
      await handler(fakeEvent, {
        tag: "bug",
        startDate: "2025-01-01",
        endDate: "2025-01-31",
        projectId: 42,
        billableOnly: true,
      });

      expect(mockGetAllSessions).toHaveBeenCalledWith("user-1", {
        tag: "bug",
        startDate: "2025-01-01",
        endDate: "2025-01-31",
        projectId: "42",
        isBillable: true,
      });
    });
  });

  describe("edit-session", () => {
    it("updates session fields and tags", async () => {
      mockUpdateSession.mockResolvedValue({});
      mockSetSessionTagsByNames.mockResolvedValue(undefined);

      const handler = registeredHandlers["edit-session"];
      const result = await handler(fakeEvent, {
        id: "s1",
        title: "New Title",
        tags: ["bug", "ui"],
      });

      expect(result).toBe(true);
      expect(mockUpdateSession).toHaveBeenCalledWith("s1", {
        title: "New Title",
      });
      expect(mockSetSessionTagsByNames).toHaveBeenCalledWith("user-1", "s1", [
        "bug",
        "ui",
      ]);
    });

    it("returns false on error", async () => {
      mockUpdateSession.mockRejectedValue(new Error("fail"));

      const handler = registeredHandlers["edit-session"];
      const result = await handler(fakeEvent, {
        id: "s1",
        title: "X",
      });

      expect(result).toBe(false);
    });
  });

  describe("delete-session", () => {
    it("deletes and returns true", async () => {
      mockDeleteSession.mockResolvedValue(undefined);

      const handler = registeredHandlers["delete-session"];
      const result = await handler(fakeEvent, "s1");

      expect(result).toBe(true);
      expect(mockDeleteSession).toHaveBeenCalledWith("s1");
    });

    it("returns false on error", async () => {
      mockDeleteSession.mockRejectedValue(new Error("fail"));

      const handler = registeredHandlers["delete-session"];
      const result = await handler(fakeEvent, "s1");

      expect(result).toBe(false);
    });
  });

  describe("get-small-sessions", () => {
    it("returns enriched small sessions", async () => {
      mockGetSmallSessions.mockResolvedValue([
        { id: "s1", duration: 5, start_time: "2025-01-15T10:00:00Z" },
      ]);
      // enrichSessions batch queries
      mockResult({ data: [], error: null });

      const handler = registeredHandlers["get-small-sessions"];
      const result = await handler(fakeEvent, 30);

      expect(mockGetSmallSessions).toHaveBeenCalledWith("user-1", 30);
      expect(result).toHaveLength(1);
    });
  });

  describe("delete-sessions", () => {
    it("batch deletes and returns true", async () => {
      mockDeleteSessions.mockResolvedValue(undefined);

      const handler = registeredHandlers["delete-sessions"];
      const result = await handler(fakeEvent, ["s1", "s2", 3]);

      expect(result).toBe(true);
      expect(mockDeleteSessions).toHaveBeenCalledWith(["s1", "s2", "3"]);
    });
  });
});

describe("IPC: Goal Handlers", () => {
  const fakeEvent = {} as any;
  const fakeUser = { id: "user-1", email: "test@test.com" };

  beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue(fakeUser);
  });

  describe("set-daily-goal", () => {
    it("sets goal and returns true", async () => {
      mockSetDailyGoal.mockResolvedValue({});

      const handler = registeredHandlers["set-daily-goal"];
      const result = await handler(fakeEvent, "2025-01-15", 120, "Focus");

      expect(result).toBe(true);
      expect(mockSetDailyGoal).toHaveBeenCalledWith(
        "user-1",
        "2025-01-15",
        120,
        "Focus",
      );
    });

    it("returns false on error", async () => {
      mockSetDailyGoal.mockRejectedValue(new Error("fail"));

      const handler = registeredHandlers["set-daily-goal"];
      const result = await handler(fakeEvent, "2025-01-15", 120, "Focus");

      expect(result).toBe(false);
    });

    it("returns false when not authenticated", async () => {
      mockGetCurrentUser.mockResolvedValue(null);

      const handler = registeredHandlers["set-daily-goal"];
      const result = await handler(fakeEvent, "2025-01-15", 120, "Focus");

      expect(result).toBe(false);
    });
  });

  describe("get-daily-goal", () => {
    it("returns goal data", async () => {
      const goal = { date: "2025-01-15", target_minutes: 120 };
      mockGetDailyGoal.mockResolvedValue(goal);

      const handler = registeredHandlers["get-daily-goal"];
      const result = await handler(fakeEvent, "2025-01-15");

      expect(result).toEqual(goal);
    });

    it("returns null on error", async () => {
      mockGetDailyGoal.mockRejectedValue(new Error("fail"));

      const handler = registeredHandlers["get-daily-goal"];
      const result = await handler(fakeEvent, "2025-01-15");

      expect(result).toBeNull();
    });
  });

  describe("delete-daily-goal", () => {
    it("deletes and returns true", async () => {
      mockDeleteDailyGoal.mockResolvedValue(undefined);

      const handler = registeredHandlers["delete-daily-goal"];
      const result = await handler(fakeEvent, "2025-01-15");

      expect(result).toBe(true);
    });
  });

  describe("get-total-time-for-day", () => {
    it("returns total minutes", async () => {
      mockGetTotalTimeForDay.mockResolvedValue(90);

      const handler = registeredHandlers["get-total-time-for-day"];
      const result = await handler(fakeEvent, "2025-01-15");

      expect(result).toBe(90);
    });

    it("returns 0 on error", async () => {
      mockGetTotalTimeForDay.mockRejectedValue(new Error("fail"));

      const handler = registeredHandlers["get-total-time-for-day"];
      const result = await handler(fakeEvent, "2025-01-15");

      expect(result).toBe(0);
    });
  });

  describe("complete-daily-goal", () => {
    it("completes goal and returns true", async () => {
      mockCompleteDailyGoal.mockResolvedValue({});

      const handler = registeredHandlers["complete-daily-goal"];
      const result = await handler(fakeEvent, "2025-01-15");

      expect(result).toBe(true);
    });
  });

  describe("get-all-daily-goals", () => {
    it("returns all goals", async () => {
      const goals = [
        { date: "2025-01-15", target_minutes: 120 },
        { date: "2025-01-16", target_minutes: 90 },
      ];
      mockGetAllDailyGoals.mockResolvedValue(goals);

      const handler = registeredHandlers["get-all-daily-goals"];
      const result = await handler(fakeEvent);

      expect(result).toEqual(goals);
    });

    it("returns [] on error", async () => {
      mockGetAllDailyGoals.mockRejectedValue(new Error("fail"));

      const handler = registeredHandlers["get-all-daily-goals"];
      const result = await handler(fakeEvent);

      expect(result).toEqual([]);
    });
  });
});
