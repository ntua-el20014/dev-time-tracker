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
const logUsage = vi.fn();
vi.mock("../../src/supabase/usageLogs", () => ({
  logUsage: (...args: unknown[]) => logUsage(...args),
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

async function freshQueue() {
  vi.resetModules();
  return await import("../../src/utils/offlineQueue");
}

describe("offlineQueue.flush", () => {
  beforeEach(() => {
    getSession.mockReset();
    logUsage.mockReset().mockResolvedValue({});
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
    q.enqueueUsageLog("user-A", "VS Code", "a.ts", null, null, null, 10, "2026-10-14T10:00:00.000Z");
    logUsage.mockRejectedValueOnce(new Error("fetch failed"));
    expect(await q.flush()).toBe(0);
    expect(q.getPendingCount()).toBe(1);

    logUsage.mockRejectedValueOnce(new Error("JWT expired"));
    expect(await q.flush()).toBe(0);
    expect(q.getPendingCount()).toBe(1);
  });

  it("discards items that fail permanently so they don't block the queue", async () => {
    const q = await freshQueue();
    signedInAs("user-A");
    q.enqueueUsageLog("user-A", "VS Code", "a.ts", null, null, null, 10, "2026-10-14T10:00:00.000Z");
    q.enqueueUsageLog("user-A", "VS Code", "b.ts", null, null, null, 10, "2026-10-14T10:00:10.000Z");
    logUsage.mockRejectedValueOnce(new Error("duplicate key value"));

    expect(await q.flush()).toBe(2);
    expect(q.getPendingCount()).toBe(0);
  });
});
