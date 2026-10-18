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
const saveDraftSession = vi.fn();
vi.mock("../../src/supabase/timeTracking", () => ({
  addSession: (...args: unknown[]) => addSession(...args),
  saveDraftSession: (...args: unknown[]) => saveDraftSession(...args),
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
    saveDraftSession.mockReset().mockResolvedValue("saved");
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

  describe("drafts", () => {
    const draft = (duration: number, extra = {}) => ({
      clientId: "seg-1",
      startTime: "2026-10-18T09:00:00.000Z",
      endTime: "2026-10-18T09:30:00.000Z",
      duration,
      title: null,
      projectId: null,
      supervising: { seconds: 0, spans: [] as [string, string][] },
      appUsage: [],
      ...extra,
    });
    const codeStats = [
      {
        repo_key: "github.com/me/a",
        repo_name: "a",
        commits: 1,
        files_changed: 1,
        lines_added: 3,
        lines_removed: 0,
        languages: {},
      },
    ];

    it("keeps only the latest version of a segment, with its code stats", async () => {
      const q = await freshQueue();
      signedInAs(null);
      q.enqueueDraftSession("user-A", draft(600, { codeStats }));
      q.enqueueDraftSession("user-A", draft(900));
      expect(q.getPendingCount()).toBe(1);
      expect(q.hasQueuedDraftSession("user-A", "seg-1")).toBe(true);
      expect(q.hasQueuedDraftSession("user-B", "seg-1")).toBe(false);

      signedInAs("user-A");
      expect(await q.flush()).toBe(1);
      expect(saveDraftSession).toHaveBeenCalledTimes(1);
      expect(saveDraftSession).toHaveBeenCalledWith(
        "user-A",
        expect.objectContaining({ clientId: "seg-1", duration: 900, codeStats }),
      );
      expect(q.hasQueuedDraftSession("user-A", "seg-1")).toBe(false);
    });

    it("a version queued while the older one is being sent is sent after it", async () => {
      const q = await freshQueue();
      signedInAs("user-A");
      q.enqueueDraftSession("user-A", draft(600));
      let release!: () => void;
      saveDraftSession.mockImplementationOnce(
        () => new Promise<string>((resolve) => (release = () => resolve("saved"))),
      );

      const flushing = q.flush();
      await vi.waitFor(() => expect(saveDraftSession).toHaveBeenCalledTimes(1));
      q.enqueueDraftSession("user-A", draft(1200));
      release();
      expect(await flushing).toBe(2);

      expect(saveDraftSession.mock.calls.map((c) => c[1].duration)).toEqual([600, 1200]);
      expect(q.getPendingCount()).toBe(0);
    });

    it("keeps a draft on network errors", async () => {
      const q = await freshQueue();
      signedInAs("user-A");
      q.enqueueDraftSession("user-A", draft(600));
      saveDraftSession.mockRejectedValueOnce(new Error("fetch failed"));
      expect(await q.flush()).toBe(0);
      expect(q.hasQueuedDraftSession("user-A", "seg-1")).toBe(true);
    });
  });
});
