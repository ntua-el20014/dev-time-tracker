import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockResult, resetMockState, getCallsFor } from "../helpers/supabaseMock";

vi.mock("../../src/supabase/config", async () => {
  const { mockSupabase } = await import("../helpers/supabaseMock");
  return { supabase: mockSupabase };
});

import {
  upsertAgentSessions,
  getAgentSessions,
  assignAgentSessionsProject,
  deleteAgentSessions,
} from "../../src/supabase/agentSessions";

const row = {
  source: "claude-code" as const,
  external_id: "s1",
  repo_key: "github.com/a/b",
  repo_name: "b",
  project_id: null,
  started_at: "2026-10-15T10:00:00Z",
  ended_at: "2026-10-15T10:30:00Z",
  active_seconds: 1500,
  prompts: 3,
  tool_calls: 9,
  files_changed: 2,
  lines_added: 10,
  lines_removed: 1,
  input_tokens: 1,
  output_tokens: 2,
  cache_read_tokens: 3,
  cache_write_tokens: 4,
  models: {},
  languages: {},
  cost_usd: 0.5,
};

describe("agentSessions", () => {
  beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
  });

  it("upserts rows for the user on (user_id, source, external_id)", async () => {
    mockResult({ data: null, error: null });
    await upsertAgentSessions("u1", [row]);
    const [rows, opts] = getCallsFor("upsert")[0].args;
    expect(rows).toEqual([{ ...row, user_id: "u1" }]);
    expect(opts).toEqual({ onConflict: "user_id,source,external_id" });
  });

  it("does nothing for no rows, throws on error", async () => {
    await upsertAgentSessions("u1", []);
    expect(getCallsFor("upsert")).toHaveLength(0);
    mockResult({ data: null, error: { message: "rls" } });
    await expect(upsertAgentSessions("u1", [row])).rejects.toEqual({ message: "rls" });
  });

  it("lists the user's sessions for local days, newest first", async () => {
    mockResult({ data: [{ id: "x", ...row }], error: null });
    expect(await getAgentSessions("u1", "2026-10-15", "2026-10-15")).toHaveLength(1);
    expect(getCallsFor("eq")[0].args).toEqual(["user_id", "u1"]);
    expect(getCallsFor("order")[0].args).toEqual(["started_at", { ascending: false }]);
    expect(getCallsFor("gte")).toHaveLength(1);
    expect(getCallsFor("lte")).toHaveLength(1);
  });

  it("backfills the project only on the user's unattributed sessions of that repo", async () => {
    mockResult({ data: null, error: null });
    await assignAgentSessionsProject("u1", "github.com/a/b", "p1");
    expect(getCallsFor("update")[0].args[0]).toEqual({ project_id: "p1" });
    expect(getCallsFor("eq").map((c) => c.args)).toEqual([
      ["user_id", "u1"],
      ["repo_key", "github.com/a/b"],
    ]);
    expect(getCallsFor("is")[0].args).toEqual(["project_id", null]);
  });

  it("deletes only the user's rows", async () => {
    mockResult({ data: null, error: null });
    await deleteAgentSessions("u1");
    expect(getCallsFor("delete")).toHaveLength(1);
    expect(getCallsFor("eq")[0].args).toEqual(["user_id", "u1"]);
  });
});
