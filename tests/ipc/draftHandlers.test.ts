import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const handlers: Record<string, Function> = {};
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      handlers[channel] = handler;
    }),
  },
}));

const getCurrentUser = vi.fn();
vi.mock("../../src/supabase/api", () => ({
  getCurrentUser: () => getCurrentUser(),
}));

const tt = {
  getDraftSessions: vi.fn(),
  getDraftSessionsByIds: vi.fn(),
  countDraftSessions: vi.fn(),
  confirmDraftSession: vi.fn(),
  updateDraftSession: vi.fn(),
  deleteDraftSessions: vi.fn(),
};
vi.mock("../../src/supabase/timeTracking", () => tt);

const projects = {
  getOrganizationProjects: vi.fn(),
  getPersonalProjects: vi.fn(),
};
vi.mock("../../src/supabase/cloudProjects", () => projects);

const tracker = { openDraftClientId: vi.fn(), settleDraft: vi.fn() };
vi.mock("../../src/tracking/tracker", () => tracker);

vi.mock("../../src/ipc/sessionHandlers", () => ({
  enrichSessions: async (rows: unknown[]) => rows,
}));
vi.mock("../../src/utils/errorHandler", () => ({ logError: vi.fn() }));

beforeAll(async () => {
  await import("../../src/ipc/draftHandlers");
});

const draft = (id: string, hour: number, over = {}) => ({
  id,
  client_id: `c-${id}`,
  title: "shop",
  start_time: new Date(Date.UTC(2026, 9, 18, hour)).toISOString(),
  end_time: new Date(Date.UTC(2026, 9, 18, hour, 30)).toISOString(),
  duration: 1800,
  project_id: null,
  supervising_seconds: 0,
  supervising_spans: [],
  code_stats: [],
  app_usage: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "u1" });
  projects.getOrganizationProjects.mockResolvedValue([{ id: "org-p" }]);
  projects.getPersonalProjects.mockResolvedValue([{ id: "my-p" }]);
  tracker.settleDraft.mockResolvedValue(undefined);
  tracker.openDraftClientId.mockReturnValue(null);
});

describe("draft handlers", () => {
  it("lists drafts and marks the one being recorded", async () => {
    tt.getDraftSessions.mockResolvedValue([draft("a", 9), draft("b", 10)]);
    tracker.openDraftClientId.mockReturnValue("c-b");
    const rows = await handlers["get-draft-sessions"]({});
    expect(rows.map((r: any) => [r.id, r.in_progress])).toEqual([
      ["a", false],
      ["b", true],
    ]);
    expect(tt.getDraftSessions).toHaveBeenCalledWith("u1");
  });

  it("confirms into a visible project, after settling the draft", async () => {
    tt.getDraftSessionsByIds.mockResolvedValue([draft("a", 9)]);
    tt.confirmDraftSession.mockResolvedValue(true);
    const ok = await handlers["confirm-draft-session"]({}, {
      id: "a",
      title: "  Checkout flow  ",
      description: "",
      projectId: "my-p",
      isBillable: true,
    });
    expect(ok).toBe(true);
    expect(tracker.settleDraft).toHaveBeenCalledWith("u1", "c-a", "keep");
    expect(tt.confirmDraftSession).toHaveBeenCalledWith("u1", "a", {
      title: "Checkout flow",
      description: null,
      projectId: "my-p",
      isBillable: true,
    });
    // Settled before the update
    expect(tracker.settleDraft.mock.invocationCallOrder[0]).toBeLessThan(
      tt.confirmDraftSession.mock.invocationCallOrder[0],
    );
  });

  it("refuses unknown projects, empty titles and bad ids", async () => {
    expect(
      await handlers["confirm-draft-session"]({}, { id: "a", title: "x", projectId: "someone-elses" }),
    ).toBe(false);
    expect(await handlers["confirm-draft-session"]({}, { id: "a", title: "  " })).toBe(false);
    expect(await handlers["confirm-draft-session"]({}, { id: "a'; drop", title: "x" })).toBe(false);
    expect(tt.confirmDraftSession).not.toHaveBeenCalled();
  });

  it("only takes billable === true", async () => {
    tt.getDraftSessionsByIds.mockResolvedValue([draft("a", 9)]);
    tt.confirmDraftSession.mockResolvedValue(true);
    await handlers["confirm-draft-session"]({}, { id: "a", title: "x", isBillable: "yes" });
    expect(tt.confirmDraftSession.mock.calls[0][2].isBillable).toBe(false);
  });

  it("merges into the earliest draft and deletes the rest", async () => {
    const rows = [draft("b", 11), draft("a", 9)];
    tt.getDraftSessionsByIds.mockResolvedValue(rows);
    tt.updateDraftSession.mockResolvedValue(true);
    expect(await handlers["merge-draft-sessions"]({}, ["a", "b"])).toBe("a");
    // Both settled (kept) first; the deleted one is then forgotten
    expect(tracker.settleDraft.mock.calls).toEqual([
      ["u1", "c-b", "keep"],
      ["u1", "c-a", "keep"],
      ["u1", "c-b", "forget"],
    ]);
    expect(tt.updateDraftSession).toHaveBeenCalledWith(
      "u1",
      "a",
      expect.objectContaining({ duration: 3600 }),
    );
    expect(tt.deleteDraftSessions).toHaveBeenCalledWith("u1", ["b"]);
  });

  it("doesn't merge fewer than two drafts, or delete when the update failed", async () => {
    tt.getDraftSessionsByIds.mockResolvedValue([draft("a", 9)]);
    expect(await handlers["merge-draft-sessions"]({}, ["a", "zzz"])).toBeNull();
    tt.getDraftSessionsByIds.mockResolvedValue([draft("a", 9), draft("b", 10)]);
    tt.updateDraftSession.mockResolvedValue(false); // confirmed meanwhile
    expect(await handlers["merge-draft-sessions"]({}, ["a", "b"])).toBeNull();
    expect(tt.deleteDraftSessions).not.toHaveBeenCalled();
  });

  it("discards only the user's drafts, forgetting them first", async () => {
    tt.getDraftSessionsByIds.mockResolvedValue([draft("a", 9)]);
    expect(await handlers["discard-draft-sessions"]({}, ["a", "not-mine"])).toBe(1);
    expect(tt.getDraftSessionsByIds).toHaveBeenCalledWith("u1", ["a", "not-mine"]);
    expect(tracker.settleDraft).toHaveBeenCalledWith("u1", "c-a", "forget");
    expect(tt.deleteDraftSessions).toHaveBeenCalledWith("u1", ["a"]);
  });

  it("counts drafts, 0 when signed out", async () => {
    tt.countDraftSessions.mockResolvedValue(3);
    expect(await handlers["get-draft-count"]({})).toBe(3);
    getCurrentUser.mockResolvedValue(null);
    expect(await handlers["get-draft-count"]({})).toBe(0);
  });
});
