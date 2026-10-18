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

const getDefaultCurrency = vi.fn();
vi.mock("../../src/supabase/userPreferences", () => ({
  getDefaultCurrency: (...args: unknown[]) => getDefaultCurrency(...args),
}));

const getProjectActivity = vi.fn();
vi.mock("../../src/supabase/projectActivity", () => ({
  getProjectActivity: (...args: unknown[]) => getProjectActivity(...args),
}));

beforeAll(async () => {
  await import("../../src/ipc/projectHandlers");
});

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "u1" });
  getDefaultCurrency.mockResolvedValue("EUR");
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

  it("uses the user's default currency unless the form chose one", async () => {
    cp.createCloudProject.mockResolvedValue({ id: "p4" });
    await call("create-project", "X", "", "#fff", 50);
    expect(cp.createCloudProject.mock.calls[0][0].currency).toBe("EUR");

    await call("create-project", "Y", "", "#fff", 50, "personal", true, "GBP");
    expect(cp.createCloudProject.mock.calls[1][0].currency).toBe("GBP");

    // Not a currency code: the default again
    await call("create-project", "Z", "", "#fff", 50, "personal", true, "<b>");
    expect(cp.createCloudProject.mock.calls[2][0].currency).toBe("EUR");
  });

  it("falls back to USD when the default can't be read", async () => {
    cp.createCloudProject.mockResolvedValue({ id: "p5" });
    getDefaultCurrency.mockRejectedValue(new Error("offline"));
    await call("create-project", "X", "", "#fff", 50);
    expect(cp.createCloudProject.mock.calls[0][0].currency).toBe("USD");
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

describe("get-project-activity", () => {
  it("returns the signed-in user's activity for valid local days", async () => {
    getProjectActivity.mockResolvedValue([{ projectId: "p" }]);
    expect(await call("get-project-activity", { startDate: "2026-10-01", endDate: "2026-10-30" })).toEqual([
      { projectId: "p" },
    ]);
    expect(getProjectActivity).toHaveBeenCalledWith("u1", "2026-10-01", "2026-10-30");
  });

  it("rejects bad input and swallows errors", async () => {
    expect(await call("get-project-activity", { startDate: "x", endDate: "2026-10-30" })).toEqual([]);
    expect(await call("get-project-activity", null)).toEqual([]);
    getCurrentUser.mockResolvedValue(null);
    expect(await call("get-project-activity", { startDate: "2026-10-01", endDate: "2026-10-30" })).toEqual([]);
    getCurrentUser.mockResolvedValue({ id: "u1" });
    getProjectActivity.mockRejectedValue(new Error("down"));
    expect(await call("get-project-activity", { startDate: "2026-10-01", endDate: "2026-10-30" })).toEqual([]);
    expect(getProjectActivity).toHaveBeenCalledTimes(1);
  });
});
