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

const sched = {
  createScheduledSession: vi.fn(),
  updateScheduledSession: vi.fn(),
  getScheduledSessions: vi.fn(),
};
vi.mock("../../src/supabase/scheduledSessions", () => sched);

const getCloudProjectById = vi.fn();
vi.mock("../../src/supabase/cloudProjects", () => ({
  getCloudProjectById: (id: string) => getCloudProjectById(id),
}));

vi.mock("../../src/utils/errorHandler", () => ({ logError: vi.fn() }));

beforeAll(async () => {
  await import("../../src/ipc/scheduledSessionHandlers");
});

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "u1" });
  sched.createScheduledSession.mockImplementation(async (_u, d) => ({ id: "s1", ...d }));
  getCloudProjectById.mockImplementation(async (id) => (id === "visible" ? { id } : null));
});

const base = {
  title: "Plan",
  scheduled_datetime: "2026-10-20T09:00:00.000Z",
  recurrence_type: "none" as const,
};

describe("scheduled session handlers", () => {
  it("files a scheduled session under a project the user can see", async () => {
    await handlers["create-scheduled-session"]({}, { ...base, project_id: "visible" });
    expect(sched.createScheduledSession).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ project_id: "visible" }),
    );
  });

  it("refuses a project the user can't see", async () => {
    expect(await handlers["create-scheduled-session"]({}, { ...base, project_id: "other-org" })).toBeNull();
    expect(sched.createScheduledSession).not.toHaveBeenCalled();
  });

  it("treats an empty project as none and never takes org_id from the renderer", async () => {
    await handlers["create-scheduled-session"]({}, { ...base, project_id: "", org_id: "forged" });
    const data = sched.createScheduledSession.mock.calls[0][1];
    expect(data.project_id).toBeNull();
    expect(data).not.toHaveProperty("org_id");
  });

  it("leaves the project alone on updates that don't mention it", async () => {
    await handlers["update-scheduled-session"]({}, "s1", { status: "completed" });
    expect(sched.updateScheduledSession).toHaveBeenCalledWith("s1", { status: "completed" });
    expect(getCloudProjectById).not.toHaveBeenCalled();
  });

  it("checks the project on updates that change it", async () => {
    expect(await handlers["update-scheduled-session"]({}, "s1", { project_id: "other-org" })).toBe(false);
    expect(await handlers["update-scheduled-session"]({}, "s1", { project_id: "visible" })).toBe(true);
    expect(sched.updateScheduledSession).toHaveBeenCalledTimes(1);
  });
});
