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
    expect(s.earningsByCurrency).toEqual([{ currency: "USD", amount: 150 }]);
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

  it("leaves supervising time out where the project doesn't bill it", async () => {
    mockResults([
      {
        data: [
          { id: "s1", project_id: "billed", duration: 3600, supervising_seconds: 1800 },
          { id: "s2", project_id: "unbilled", duration: 3600, supervising_seconds: 1800 },
        ],
        error: null,
      },
      {
        data: [
          { id: "billed", name: "A", color: "#000", hourly_rate: 100 },
          { id: "unbilled", name: "B", color: "#000", hourly_rate: 100, bill_supervising: false },
        ],
        error: null,
      },
    ]);

    const s = await getUserEarningsSummary("u1", "2026-10-01", "2026-10-31");
    const by = Object.fromEntries(s.byProject.map((p) => [p.projectId, p]));
    expect(by.billed).toMatchObject({ billableSeconds: 3600, earnings: 100, supervisingSeconds: 1800, billSupervising: true });
    expect(by.unbilled).toMatchObject({ billableSeconds: 1800, earnings: 50, supervisingSeconds: 1800, billSupervising: false });
    expect(s.earningsByCurrency).toEqual([{ currency: "USD", amount: 150 }]);
  });

  it("adds reported AI agent cost per project, apart from earnings", async () => {
    mockResults([
      { data: [{ id: "s1", project_id: "p1", duration: 3600 }], error: null },
      {
        data: [
          { id: "p1", name: "A", color: "#000", hourly_rate: 100 },
          { id: "p2", name: "Agents only", color: "#000", hourly_rate: 100 },
        ],
        error: null,
      },
      {
        data: [
          { project_id: "p1", active_seconds: 600, cost_usd: "1.25" },
          { project_id: "p1", active_seconds: 600, cost_usd: null },
          { project_id: "p2", active_seconds: 60, cost_usd: 0.5 },
          // Project not visible any more: dropped
          { project_id: "gone", active_seconds: 60, cost_usd: 9 },
        ],
        error: null,
      },
    ]);

    const s = await getUserEarningsSummary("u1", "2026-10-01", "2026-10-31");
    const by = Object.fromEntries(s.byProject.map((p) => [p.projectId, p]));
    expect(by.p1).toMatchObject({ earnings: 100, agentCostUsd: 1.25, agentCostIncomplete: true, agentSessions: 2 });
    expect(by.p2).toMatchObject({ billableSessions: 0, earnings: 0, agentCostUsd: 0.5, agentSessions: 1 });
    expect(by.gone).toBeUndefined();
    expect(s.totalAgentCostUsd).toBe(1.75);
    expect(s.earningsByCurrency).toEqual([{ currency: "USD", amount: 100 }]);
    expect(s.totalBillableSessions).toBe(1);
  });

  it("keeps earnings per currency and never adds them up", async () => {
    mockResults([
      {
        data: [
          { id: "s1", project_id: "eur", duration: 3600, is_billable: true },
          { id: "s2", project_id: "usd", duration: 7200, is_billable: true },
          { id: "s3", project_id: "eur2", duration: 1800, is_billable: true },
        ],
        error: null,
      },
      {
        data: [
          { id: "eur", name: "EU client", color: "#000", hourly_rate: 80, currency: "EUR" },
          { id: "eur2", name: "EU client 2", color: "#000", hourly_rate: 100, currency: "EUR" },
          { id: "usd", name: "US client", color: "#000", hourly_rate: 50, currency: "USD" },
        ],
        error: null,
      },
    ]);

    const s = await getUserEarningsSummary("u1", "2026-10-01", "2026-10-31");

    const by = Object.fromEntries(s.byProject.map((p) => [p.projectId, p]));
    expect(by.eur).toMatchObject({ currency: "EUR", earnings: 80 });
    expect(by.usd).toMatchObject({ currency: "USD", earnings: 100 });
    expect(s.earningsByCurrency).toEqual([
      { currency: "EUR", amount: 130 },
      { currency: "USD", amount: 100 },
    ]);
  });

  it("treats a project without a valid currency as USD", async () => {
    mockResults([
      { data: [{ id: "s1", project_id: "p1", duration: 3600, is_billable: true }], error: null },
      { data: [{ id: "p1", name: "A", color: "#000", hourly_rate: 10, currency: null }], error: null },
    ]);

    const s = await getUserEarningsSummary("u1", "2026-10-01", "2026-10-31");
    expect(s.byProject[0].currency).toBe("USD");
  });
});
