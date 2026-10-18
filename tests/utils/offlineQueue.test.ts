import { describe, it, expect, vi, beforeEach } from "vitest";

// Never touch the real ~/.dev-time-tracker/offline-queue.json
vi.mock("fs", () => {
  const fsMock = {
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => "[]"),
    writeFileSync: vi.fn(),
  };
  return { default: fsMock, ...fsMock };
});
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

const getSession = vi.fn();
vi.mock("../../src/supabase/config", () => ({
  supabase: { auth: { getSession: () => getSession() } },
}));
const addUsageToDailySummary = vi.fn();
vi.mock("../../src/supabase/usageLogs", () => ({
  addUsageToDailySummary: (...args: unknown[]) => addUsageToDailySummary(...args),
}));
const addSession = vi.fn();
vi.mock("../../src/supabase/timeTracking", () => ({
  addSession: (...args: unknown[]) => addSession(...args),
}));
vi.mock("../../src/utils/errorHandler", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  logError: vi.fn(),
}));

const signedInAs = (id: string | null) =>
  getSession.mockResolvedValue({
    data: { session: id ? { user: { id } } : null },
  });

const increment = (overrides = {}) => ({
  userId: "user-A",
  date: "2026-10-14",
  appName: "VS Code",
  language: null,
  languageExtension: null,
  category: null,
  iconUrl: null,
  seconds: 10,
  ...overrides,
});

async function freshQueue() {
  vi.resetModules();
  return await import("../../src/utils/offlineQueue");
}

describe("offlineQueue.flush", () => {
  beforeEach(() => {
    getSession.mockReset();
    addUsageToDailySummary.mockReset().mockResolvedValue(undefined);
    addSession.mockReset().mockResolvedValue({});
  });

  it("keeps everything while signed out instead of discarding it", async () => {
    const q = await freshQueue();
    signedInAs(null);
    q.enqueueSession("user-A", "2026-10-14T10:00:00.000Z", 600, "Work");

    expect(await q.flush()).toBe(0);
    expect(addSession).not.toHaveBeenCalled();
    expect(q.getPendingCount()).toBe(1);
  });

  it("flushes only the signed-in user's items", async () => {
    const q = await freshQueue();
    signedInAs("user-B");
    q.enqueueSession("user-A", "2026-10-14T10:00:00.000Z", 600, "A's work");
    q.enqueueSession("user-B", "2026-10-14T11:00:00.000Z", 300, "B's work");

    expect(await q.flush()).toBe(1);
    expect(addSession).toHaveBeenCalledTimes(1);
    expect(addSession.mock.calls[0][0]).toBe("user-B");
    expect(q.getPendingCount()).toBe(1); // A's item is still queued
  });

  it("passes end_time through when replaying sessions", async () => {
    const q = await freshQueue();
    signedInAs("user-A");
    q.enqueueSession(
      "user-A",
      "2026-10-14T10:00:00.000Z",
      600,
      "Work",
      undefined,
      undefined,
      undefined,
      false,
      "2026-10-14T10:20:00.000Z",
    );
    await q.flush();
    expect(addSession.mock.calls[0][8]).toBe("2026-10-14T10:20:00.000Z");
  });

  it("keeps items and stops on network or auth errors", async () => {
    const q = await freshQueue();
    signedInAs("user-A");
    q.enqueueUsageSummary(increment());
    addUsageToDailySummary.mockRejectedValueOnce(new Error("fetch failed"));
    expect(await q.flush()).toBe(0);
    expect(q.getPendingCount()).toBe(1);

    addUsageToDailySummary.mockRejectedValueOnce(new Error("JWT expired"));
    expect(await q.flush()).toBe(0);
    expect(q.getPendingCount()).toBe(1);
  });

  it("discards items that fail permanently so they don't block the queue", async () => {
    const q = await freshQueue();
    signedInAs("user-A");
    q.enqueueUsageSummary(increment());
    q.enqueueUsageSummary(increment({ appName: "Chrome" }));
    addUsageToDailySummary.mockRejectedValueOnce(new Error("duplicate key value"));

    expect(await q.flush()).toBe(2);
    expect(q.getPendingCount()).toBe(0);
  });

  it("replays summary increments with their icon", async () => {
    const q = await freshQueue();
    signedInAs("user-A");
    q.enqueueUsageSummary(increment({ iconUrl: "data:icon", seconds: 40 }));
    expect(await q.flush()).toBe(1);
    expect(addUsageToDailySummary).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-A", date: "2026-10-14", seconds: 40, icon: "data:icon" }),
    );
  });

  it("passes app usage through when replaying sessions", async () => {
    const q = await freshQueue();
    signedInAs("user-A");
    const appUsage = [{ app: "VS Code", language: "TypeScript", category: null, seconds: 600 }];
    q.enqueueSession(
      "user-A", "2026-10-14T10:00:00.000Z", 600, "Work",
      undefined, undefined, undefined, false, undefined, undefined, undefined, appUsage,
    );
    await q.flush();
    expect(addSession.mock.calls[0][11]).toEqual(appUsage);
  });
});
