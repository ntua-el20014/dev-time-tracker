import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCallsFor, mockResult, resetMockState } from "../helpers/supabaseMock";

vi.mock("../../src/supabase/config", async () => {
  const { mockSupabase } = await import("../helpers/supabaseMock");
  return { supabase: mockSupabase };
});

import {
  getOrgAnalyticsSummary,
  getOrgMemberActivity,
  getOrgTopProjects,
  localTimeZone,
} from "../../src/supabase/orgAnalytics";

describe("org analytics RPCs", () => {
  beforeEach(() => resetMockState());

  it("group sessions by the viewer's local day (time zone sent)", async () => {
    mockResult({ data: [{ total_hours_tracked: 1, total_sessions: 1, active_members: 1 }], error: null });
    await getOrgAnalyticsSummary("org", "2026-11-15", "2026-11-15", true);
    const [fn, params] = getCallsFor("rpc")[0].args;
    expect(fn).toBe("get_org_analytics_summary");
    expect(params).toMatchObject({ p_billable_only: true, p_time_zone: localTimeZone() });
  });

  it("accept an explicit time zone for every session-based query", async () => {
    mockResult({ data: [], error: null });
    mockResult({ data: [], error: null });
    await getOrgTopProjects("org", "2026-11-01", "2026-11-30", undefined, false, 5, "Europe/Athens");
    await getOrgMemberActivity("org", "2026-11-01", "2026-11-30", undefined, undefined, false, "Europe/Athens");
    const calls = getCallsFor("rpc").map((c) => c.args[1].p_time_zone);
    expect(calls).toEqual(["Europe/Athens", "Europe/Athens"]);
  });

  it("knows this machine's time zone", () => {
    expect(localTimeZone()).toMatch(/\w/);
  });
});
