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

const repos = { getRepoLinks: vi.fn(), unlinkRepo: vi.fn() };
vi.mock("../../src/supabase/projectRepositories", () => repos);

const tracker = {
  getDetectedRepo: vi.fn(),
  linkRepo: vi.fn(),
  reloadRepoLinks: vi.fn(),
};
vi.mock("../../src/tracking/tracker", () => tracker);

let projectsChanged: (() => void) | null = null;
vi.mock("../../src/ipc/projectHandlers", () => ({
  onProjectsChanged: (listener: () => void) => {
    projectsChanged = listener;
  },
}));

beforeAll(async () => {
  await import("../../src/ipc/repoHandlers");
});

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "u1" });
});

const shop = { key: "github.com/acme/shop", name: "shop", root: "C:\\code\\shop" };

describe("repo handlers", () => {
  it("lists the signed-in user's links", async () => {
    repos.getRepoLinks.mockResolvedValue([{ repo_key: shop.key }]);
    expect(await handlers["get-repo-links"]({})).toEqual([{ repo_key: shop.key }]);
    expect(repos.getRepoLinks).toHaveBeenCalledWith("u1");
  });

  it("links only the repo main detected", async () => {
    tracker.getDetectedRepo.mockReturnValue(shop);
    tracker.linkRepo.mockResolvedValue(undefined);
    expect(await handlers["link-detected-repo"]({}, "p1")).toBe(true);
    expect(tracker.linkRepo).toHaveBeenCalledWith(shop, "p1");
  });

  it("refuses without a detected repo or with a bad project id", async () => {
    tracker.getDetectedRepo.mockReturnValue(null);
    expect(await handlers["link-detected-repo"]({}, "p1")).toBe(false);
    tracker.getDetectedRepo.mockReturnValue(shop);
    expect(await handlers["link-detected-repo"]({}, { id: "p1" })).toBe(false);
    expect(await handlers["link-detected-repo"]({}, "x'; drop")).toBe(false);
    expect(tracker.linkRepo).not.toHaveBeenCalled();
  });

  it("unlinks for the signed-in user and reloads the links", async () => {
    repos.unlinkRepo.mockResolvedValue(undefined);
    expect(await handlers["unlink-repo"]({}, shop.key)).toBe(true);
    expect(repos.unlinkRepo).toHaveBeenCalledWith("u1", shop.key);
    expect(tracker.reloadRepoLinks).toHaveBeenCalled();
  });

  it("rejects malformed repo keys and signed-out callers", async () => {
    expect(await handlers["unlink-repo"]({}, "")).toBe(false);
    expect(await handlers["unlink-repo"]({}, "x".repeat(513))).toBe(false);
    getCurrentUser.mockResolvedValue(null);
    expect(await handlers["unlink-repo"]({}, shop.key)).toBe(false);
    expect(repos.unlinkRepo).not.toHaveBeenCalled();
  });

  it("reloads links when projects are archived or restored", () => {
    projectsChanged?.();
    expect(tracker.reloadRepoLinks).toHaveBeenCalled();
  });
});
