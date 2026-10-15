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

const getCurrentOrganization = vi.fn();
vi.mock("../../src/supabase/organizations", () => ({
  getCurrentOrganization: (...args: unknown[]) =>
    getCurrentOrganization(...args),
}));

const cp = {
  createCloudProject: vi.fn(),
  getOrganizationProjects: vi.fn(),
  getPersonalProjects: vi.fn(),
  getArchivedProjects: vi.fn(),
  getProjectMembers: vi.fn(),
};
vi.mock("../../src/supabase/cloudProjects", () => cp);

beforeAll(async () => {
  await import("../../src/ipc/projectHandlers");
});

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "u1" });
});

const call = (channel: string, ...args: unknown[]) =>
  handlers[channel]({}, ...args);

describe("create-project", () => {
  it("creates a personal project by default", async () => {
    cp.createCloudProject.mockResolvedValue({ id: "p1" });
    await call("create-project", "Site", "", "#fff", 50);
    expect(cp.createCloudProject).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "personal", hourly_rate: 50 }),
      "u1",
    );
    expect(cp.createCloudProject.mock.calls[0][0].org_id).toBeUndefined();
    expect(getCurrentOrganization).not.toHaveBeenCalled();
  });

  it("puts an organization project in the caller's own org", async () => {
    cp.createCloudProject.mockResolvedValue({ id: "p2" });
    getCurrentOrganization.mockResolvedValue({ id: "org-1" });
    await call("create-project", "Team app", "", "#fff", null, "organization");
    expect(getCurrentOrganization).toHaveBeenCalledWith("u1");
    expect(cp.createCloudProject).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "organization", org_id: "org-1" }),
      "u1",
    );
  });

  it("fails an organization project when the user has no org", async () => {
    getCurrentOrganization.mockResolvedValue(null);
    const result = await call("create-project", "X", "", "#fff", null, "organization");
    expect(result).toBeNull();
    expect(cp.createCloudProject).not.toHaveBeenCalled();
  });

  it("treats an unknown scope as personal", async () => {
    cp.createCloudProject.mockResolvedValue({ id: "p3" });
    await call("create-project", "X", "", "#fff", null, "galaxy");
    expect(cp.createCloudProject.mock.calls[0][0].scope).toBe("personal");
  });
});

describe("get-all-projects-with-members", () => {
  it("includes archived projects once, with members only for org projects", async () => {
    const orgP = { id: "o1", scope: "organization", is_active: true };
    const personal = { id: "p1", scope: "personal", is_active: true };
    const archived = { id: "a1", scope: "personal", is_active: false, archived: true };
    cp.getOrganizationProjects.mockResolvedValue([orgP]);
    cp.getPersonalProjects.mockResolvedValue([personal]);
    // getArchivedProjects can overlap with nothing, but dedupe anyway
    cp.getArchivedProjects.mockResolvedValue([archived, personal]);
    cp.getProjectMembers.mockResolvedValue([{ user_id: "u2" }]);

    const result = await call("get-all-projects-with-members");

    expect(result.map((p: { id: string }) => p.id).sort()).toEqual([
      "a1",
      "o1",
      "p1",
    ]);
    expect(cp.getProjectMembers).toHaveBeenCalledTimes(1);
    expect(cp.getProjectMembers).toHaveBeenCalledWith("o1");
    const byId = Object.fromEntries(
      result.map((p: { id: string }) => [p.id, p]),
    );
    expect(byId.o1.members).toEqual([{ user_id: "u2" }]);
    expect(byId.a1.members).toEqual([]);
  });

  it("returns [] when signed out", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect(await call("get-all-projects-with-members")).toEqual([]);
  });
});
