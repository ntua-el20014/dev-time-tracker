import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockResults, resetMockState } from "../helpers/supabaseMock";

vi.mock("../../src/supabase/config", async () => {
  const { mockSupabase } = await import("../helpers/supabaseMock");
  return { supabase: mockSupabase };
});

import { getUserEarningsSummary } from "../../src/supabase/billableHours";

describe("getUserEarningsSummary", () => {
  beforeEach(() => {
    resetMockState();
  });

  it("prices project sessions and keeps billable sessions without a project as unassigned", async () => {
    mockResults([
      {
        data: [
          { id: "s1", project_id: "p1", duration: 3600, is_billable: true },
          { id: "s2", project_id: "p1", duration: 1800, is_billable: true },
          { id: "s3", project_id: null, duration: 1800, is_billable: true },
          // Project not visible (deleted or another org's): also unassigned
          { id: "s4", project_id: "gone", duration: 900, is_billable: true },
        ],
        error: null,
      },
      {
        data: [{ id: "p1", name: "Site", color: "#123456", hourly_rate: 100 }],
        error: null,
      },
    ]);

    const s = await getUserEarningsSummary("u1", "2026-10-01", "2026-10-31");

    expect(s.byProject).toHaveLength(1);
    expect(s.byProject[0]).toMatchObject({
      projectId: "p1",
      billableHours: 1.5,
      billableSessions: 2,
      earnings: 150,
    });
    expect(s.unassigned).toEqual({
      billableSeconds: 2700,
      billableHours: 0.75,
      billableSessions: 2,
    });
    // Totals count unassigned time but not money
    expect(s.totalBillableHours).toBe(2.25);
    expect(s.totalBillableSessions).toBe(4);
    expect(s.totalEarnings).toBe(150);
  });

  it("returns an empty unassigned bucket when every session has a project", async () => {
    mockResults([
      { data: [{ id: "s1", project_id: "p1", duration: 3600 }], error: null },
      { data: [{ id: "p1", name: "A", color: "#000", hourly_rate: null }], error: null },
    ]);

    const s = await getUserEarningsSummary("u1", "2026-10-01", "2026-10-31");

    expect(s.unassigned.billableSessions).toBe(0);
    expect(s.byProject[0].earnings).toBe(0);
    expect(s.totalBillableHours).toBe(1);
  });
});
