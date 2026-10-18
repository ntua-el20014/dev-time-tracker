import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCallsFor, mockResults, resetMockState } from "../helpers/supabaseMock";

vi.mock("../../src/supabase/config", async () => {
  const { mockSupabase } = await import("../helpers/supabaseMock");
  return { supabase: mockSupabase };
});

import {
  getAgentTotalsByProject,
  getProjectActivity,
} from "../../src/supabase/projectActivity";

describe("getProjectActivity", () => {
  beforeEach(() => resetMockState());

  it("combines the user's sessions and agent sessions per project", async () => {
    mockResults([
      {
        data: [
          { project_id: "p", duration: 3600, supervising_seconds: 900, code_stats: [] },
        ],
        error: null,
      },
      { data: [{ project_id: "p", active_seconds: 1200, cost_usd: "3.20" }], error: null },
    ]);

    const [p] = await getProjectActivity("u1", "2026-10-01", "2026-10-30");

    expect(p).toMatchObject({
      projectId: "p",
      humanSeconds: 2700,
      supervisingSeconds: 900,
      agent: { activeSeconds: 1200, costUsd: 3.2 },
    });
    expect(getCallsFor("eq").map((c) => c.args)).toEqual([
      ["user_id", "u1"],
      ["status", "confirmed"], // drafts aren't the user's confirmed time
      ["user_id", "u1"],
    ]);
  });

  it("throws on a query error", async () => {
    mockResults([{ data: null, error: { message: "boom" } }]);
    await expect(getProjectActivity("u1", "2026-10-01", "2026-10-30")).rejects.toBeTruthy();
  });
});

describe("getAgentTotalsByProject", () => {
  beforeEach(() => resetMockState());

  it("filters to the given projects", async () => {
    mockResults([{ data: [{ project_id: "a", active_seconds: 60, cost_usd: 1 }], error: null }]);

    const by = await getAgentTotalsByProject("u1", "2026-10-01", "2026-10-30", ["a"]);

    expect(by.get("a")?.costUsd).toBe(1);
    expect(getCallsFor("in")[0].args).toEqual(["project_id", ["a"]]);
  });

  it("asks nothing for an empty project list", async () => {
    expect((await getAgentTotalsByProject("u1", "2026-10-01", "2026-10-30", [])).size).toBe(0);
    expect(getCallsFor("from")).toHaveLength(0);
  });
});
