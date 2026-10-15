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
  getRepoLinks,
  linkRepoToProject,
  unlinkRepo,
} from "../../src/supabase/projectRepositories";

describe("projectRepositories", () => {
  beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
  });

  it("lists the user's links by repo name", async () => {
    const links = [{ repo_key: "github.com/a/b", repo_name: "b", project_id: "p1" }];
    mockResult({ data: links, error: null });

    expect(await getRepoLinks("u1")).toEqual(links);
    expect(getCallsFor("from")[0].args[0]).toBe("project_repositories");
    expect(getCallsFor("eq")[0].args).toEqual(["user_id", "u1"]);
    expect(getCallsFor("order")[0].args).toEqual(["repo_name", { ascending: true }]);
  });

  it("returns [] when there are none and throws on error", async () => {
    mockResult({ data: null, error: null });
    expect(await getRepoLinks("u1")).toEqual([]);
    mockResult({ data: null, error: { message: "boom" } });
    await expect(getRepoLinks("u1")).rejects.toEqual({ message: "boom" });
  });

  it("upserts a link on (user_id, repo_key)", async () => {
    mockResult({ data: null, error: null });
    await linkRepoToProject("u1", {
      repo_key: "github.com/a/b",
      repo_name: "b",
      project_id: "p1",
    });
    const [row, opts] = getCallsFor("upsert")[0].args;
    expect(row).toEqual({
      user_id: "u1",
      repo_key: "github.com/a/b",
      repo_name: "b",
      project_id: "p1",
    });
    expect(opts).toEqual({ onConflict: "user_id,repo_key" });
  });

  it("throws when linking fails (e.g. project not visible)", async () => {
    mockResult({ data: null, error: { message: "rls" } });
    await expect(
      linkRepoToProject("u1", { repo_key: "k", repo_name: "n", project_id: "p" }),
    ).rejects.toEqual({ message: "rls" });
  });

  it("unlinks only the user's own row for that repo", async () => {
    mockResult({ data: null, error: null });
    await unlinkRepo("u1", "github.com/a/b");
    expect(getCallsFor("delete")).toHaveLength(1);
    expect(getCallsFor("eq").map((c) => c.args)).toEqual([
      ["user_id", "u1"],
      ["repo_key", "github.com/a/b"],
    ]);
  });
});
