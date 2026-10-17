import { describe, expect, it, vi } from "vitest";

vi.mock("../../renderer/utils/saveFile", () => ({ savePdf: vi.fn() }));

import {
  calculateInvoiceData,
  generateInvoicePDF,
} from "../../renderer/utils/invoiceUtils";

const project = {
  projectId: "p",
  projectName: "Site",
  hourlyRate: 100,
  billableSessions: [
    { id: "s", start_time: "2026-10-10T09:00:00Z", duration: 7200, billed_seconds: 3600 } as any,
  ],
  agentCostUsd: 12.5,
  agentSessions: 3,
};
const range = { startDate: new Date("2026-10-01"), endDate: new Date("2026-10-31") };

describe("invoice AI agent cost line (C6)", () => {
  it("is left out unless asked for", () => {
    const data = calculateInvoiceData([project], range, { companyName: "Me" });
    expect(data.projects[0]).toMatchObject({ subtotal: 100, agentCost: 0, agentSessions: 0 });
  });

  it("adds the reported cost at cost to the project subtotal", () => {
    const data = calculateInvoiceData([project], range, { companyName: "Me" }, undefined, true);
    expect(data.projects[0]).toMatchObject({ subtotal: 112.5, agentCost: 12.5, agentSessions: 3 });
  });

  it("invoices a project where only agents worked", () => {
    const data = calculateInvoiceData(
      [{ ...project, billableSessions: [] }],
      range,
      { companyName: "Me" },
      undefined,
      true,
    );
    expect(data.projects[0].subtotal).toBe(12.5);
    const text = (generateInvoicePDF(data).output() as string);
    expect(text).toContain("AI coding agent usage");
    expect(text).toContain("3 sessions, at cost");
    expect(text).toContain("TOTAL: $12.50");
  });
});
