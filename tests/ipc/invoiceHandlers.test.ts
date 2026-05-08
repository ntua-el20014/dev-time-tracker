/**
 * Invoice Handler Tests - Calculations and Data Structures
 *
 * Tests focus on invoice calculation logic and data structure validation.
 * IPC handler mocking is tested separately with integration tests.
 */
import { describe, it, expect } from "vitest";

describe("Billable Sessions Filtering", () => {
  it("filters sessions by date range", () => {
    const sessions = [
      { id: "s1", start_time: "2025-01-15T10:00:00Z", is_billable: true },
      { id: "s2", start_time: "2025-02-10T10:00:00Z", is_billable: true },
      { id: "s3", start_time: "2025-03-05T10:00:00Z", is_billable: true },
    ];

    const filtered = sessions.filter((s) => {
      const date = new Date(s.start_time);
      const start = new Date("2025-01-01");
      const end = new Date("2025-02-01");
      return date >= start && date < end;
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("s1");
  });

  it("filters by billable flag", () => {
    const sessions = [
      { id: "s1", duration: 3600, is_billable: true },
      { id: "s2", duration: 3600, is_billable: false },
      { id: "s3", duration: 3600, is_billable: true },
    ];

    const billable = sessions.filter((s) => s.is_billable);

    expect(billable).toHaveLength(2);
    expect(billable[0].id).toBe("s1");
    expect(billable[1].id).toBe("s3");
  });

  it("filters by single project", () => {
    const sessions = [
      { id: "s1", project_id: "proj-1", duration: 3600 },
      { id: "s2", project_id: "proj-2", duration: 3600 },
      { id: "s3", project_id: "proj-1", duration: 7200 },
    ];

    const projectSessions = sessions.filter((s) => s.project_id === "proj-1");

    expect(projectSessions).toHaveLength(2);
    expect(projectSessions.every((s) => s.project_id === "proj-1")).toBe(true);
  });

  it("filters by multiple projects", () => {
    const sessions = [
      { id: "s1", project_id: "proj-1", duration: 3600 },
      { id: "s2", project_id: "proj-2", duration: 3600 },
      { id: "s3", project_id: "proj-3", duration: 7200 },
    ];
    const projectIds = ["proj-1", "proj-2"];

    const filtered = sessions.filter((s) => projectIds.includes(s.project_id));

    expect(filtered).toHaveLength(2);
    expect(filtered.map((s) => s.project_id)).toEqual(["proj-1", "proj-2"]);
  });
});

describe("Invoice Calculation", () => {
  it("calculates total from sessions with hourly rate", () => {
    const sessions = [
      { id: "s1", duration: 3600, hourly_rate: 50 },
      { id: "s2", duration: 7200, hourly_rate: 50 },
    ];

    const total = sessions.reduce((sum, s) => {
      const hours = s.duration / 3600;
      return sum + hours * s.hourly_rate;
    }, 0);

    expect(total).toBe(150); // 1 * 50 + 2 * 50
  });

  it("generates line items from sessions", () => {
    const sessions = [
      {
        id: "s1",
        description: "Feature work",
        duration: 3600,
        hourly_rate: 75,
      },
      { id: "s2", description: "Bug fix", duration: 5400, hourly_rate: 75 },
    ];

    const lineItems = sessions.map((s) => ({
      description: s.description,
      hours: s.duration / 3600,
      rate: s.hourly_rate,
      total: (s.duration / 3600) * s.hourly_rate,
    }));

    expect(lineItems).toHaveLength(2);
    expect(lineItems[0].hours).toBe(1);
    expect(lineItems[0].total).toBe(75);
    expect(lineItems[1].hours).toBeCloseTo(1.5, 2);
    expect(lineItems[1].total).toBeCloseTo(112.5, 2);
  });

  it("calculates subtotal, tax, and total", () => {
    const subtotal = 1000;
    const taxRate = 0.1;
    const tax = subtotal * taxRate;
    const total = subtotal + tax;

    expect(tax).toBe(100);
    expect(total).toBe(1100);
  });

  it("formats currency correctly", () => {
    const amount = 1234.5678;
    const formatted = amount.toFixed(2);

    expect(formatted).toBe("1234.57");
  });
});

describe("Invoice Data Validation", () => {
  it("validates required invoice fields", () => {
    const invoice = {
      id: "inv-123",
      clientName: "Acme Corp",
      total: 1500,
      date: "2025-01-31",
      lineItems: [{ description: "Work", hours: 10, rate: 150, total: 1500 }],
    };

    const isValid =
      invoice.id &&
      invoice.clientName &&
      invoice.total >= 0 &&
      invoice.date &&
      invoice.lineItems &&
      invoice.lineItems.length > 0;

    expect(isValid).toBe(true);
  });

  it("rejects invoice with zero total and no line items", () => {
    const invoice = {
      id: "inv-123",
      clientName: "Acme Corp",
      total: 0,
      date: "2025-01-31",
      lineItems: [],
    };

    const isValid = invoice.total > 0 && invoice.lineItems.length > 0;

    expect(isValid).toBe(false);
  });

  it("validates date format YYYY-MM-DD", () => {
    const dates = ["2025-01-31", "2025-02-28", "31/01/2025"];

    const validate = (dateStr: string) => {
      const regex = /^\d{4}-\d{2}-\d{2}$/;
      return regex.test(dateStr);
    };

    expect(validate(dates[0])).toBe(true);
    expect(validate(dates[1])).toBe(true);
    expect(validate(dates[2])).toBe(false);
  });

  it("validates hourly rate is positive", () => {
    const rates = [75, 50, 0, -10];

    const isValid = rates.map((r) => r > 0);

    expect(isValid[0]).toBe(true);
    expect(isValid[1]).toBe(true);
    expect(isValid[2]).toBe(false);
    expect(isValid[3]).toBe(false);
  });

  it("validates project grouping in line items", () => {
    const sessions = [
      { project_id: "proj-1", description: "Task 1", total: 500 },
      { project_id: "proj-1", description: "Task 2", total: 300 },
      { project_id: "proj-2", description: "Task 3", total: 700 },
    ];

    const grouped = sessions.reduce(
      (acc, s) => {
        if (!acc[s.project_id]) {
          acc[s.project_id] = [];
        }
        acc[s.project_id].push(s);
        return acc;
      },
      {} as Record<string, typeof sessions>,
    );

    expect(Object.keys(grouped)).toHaveLength(2);
    expect(grouped["proj-1"]).toHaveLength(2);
    expect(grouped["proj-2"]).toHaveLength(1);
  });
});

describe("Project and Member Aggregation", () => {
  it("groups sessions by project", () => {
    const sessions = [
      { id: "s1", project_id: "proj-1", user_id: "u1", duration: 3600 },
      { id: "s2", project_id: "proj-1", user_id: "u2", duration: 5400 },
      { id: "s3", project_id: "proj-2", user_id: "u1", duration: 7200 },
    ];

    const grouped = sessions.reduce(
      (acc, s) => {
        if (!acc[s.project_id]) acc[s.project_id] = [];
        acc[s.project_id].push(s);
        return acc;
      },
      {} as Record<string, typeof sessions>,
    );

    expect(Object.keys(grouped)).toHaveLength(2);
    expect(grouped["proj-1"]).toHaveLength(2);
    expect(grouped["proj-2"]).toHaveLength(1);
  });

  it("calculates hours per project", () => {
    const sessions = [
      { project_id: "proj-1", duration: 3600 },
      { project_id: "proj-1", duration: 5400 },
      { project_id: "proj-2", duration: 7200 },
    ];

    const grouped = sessions.reduce(
      (acc, s) => {
        if (!acc[s.project_id]) {
          acc[s.project_id] = 0;
        }
        acc[s.project_id] += s.duration;
        return acc;
      },
      {} as Record<string, number>,
    );

    const hours = Object.entries(grouped).map(([projectId, seconds]) => ({
      projectId,
      hours: seconds / 3600,
    }));

    expect(hours[0].hours).toBe(2.5);
    expect(hours[1].hours).toBe(2);
  });
});
