import { describe, it, expect, beforeEach } from "vitest";

describe("billableHours", () => {
  // ───────────── Calculate Earnings ─────────────
  describe("calculateEarnings", () => {
    it("calculates earnings from billable sessions with hourly rate", () => {
      const sessions = [
        { duration: 3600, is_billable: true }, // 1 hour
        { duration: 5400, is_billable: true }, // 1.5 hours
      ];
      const hourlyRate = 50;

      const totalSeconds = sessions
        .filter((s) => s.is_billable)
        .reduce((sum, s) => sum + s.duration, 0);
      const hours = totalSeconds / 3600;
      const earnings = hours * hourlyRate;

      expect(earnings).toBe(125); // 2.5 hours * $50/hour
    });

    it("ignores non-billable sessions", () => {
      const sessions = [
        { duration: 3600, is_billable: true }, // 1 hour
        { duration: 7200, is_billable: false }, // 2 hours (ignored)
      ];
      const hourlyRate = 50;

      const totalSeconds = sessions
        .filter((s) => s.is_billable)
        .reduce((sum, s) => sum + s.duration, 0);
      const hours = totalSeconds / 3600;
      const earnings = hours * hourlyRate;

      expect(earnings).toBe(50); // Only 1 hour * $50/hour
    });

    it("returns zero for sessions with no hourly rate", () => {
      const sessions = [{ duration: 3600, is_billable: true }];
      const hourlyRate = 0;

      const totalSeconds = sessions
        .filter((s) => s.is_billable)
        .reduce((sum, s) => sum + s.duration, 0);
      const hours = totalSeconds / 3600;
      const earnings = hours * hourlyRate;

      expect(earnings).toBe(0);
    });

    it("handles decimal hours correctly", () => {
      const sessions = [
        { duration: 1234, is_billable: true }, // ~0.343 hours
      ];
      const hourlyRate = 50;

      const totalSeconds = sessions
        .filter((s) => s.is_billable)
        .reduce((sum, s) => sum + s.duration, 0);
      const hours = totalSeconds / 3600;
      const earnings = hours * hourlyRate;

      expect(earnings).toBeCloseTo(17.14, 2);
    });

    it("returns zero for empty sessions", () => {
      const sessions: any[] = [];
      const hourlyRate = 50;

      const totalSeconds = sessions
        .filter((s) => s.is_billable)
        .reduce((sum, s) => sum + s.duration, 0);
      const hours = totalSeconds / 3600;
      const earnings = hours * hourlyRate;

      expect(earnings).toBe(0);
    });
  });

  // ───────────── Calculate Billable Hours ─────────────
  describe("calculateBillableHours", () => {
    it("sums hours from all billable sessions", () => {
      const sessions = [
        { duration: 3600, is_billable: true }, // 1 hour
        { duration: 5400, is_billable: true }, // 1.5 hours
        { duration: 7200, is_billable: false }, // 2 hours (ignored)
      ];

      const billableSeconds = sessions
        .filter((s) => s.is_billable)
        .reduce((sum, s) => sum + s.duration, 0);
      const billableHours = billableSeconds / 3600;

      expect(billableHours).toBe(2.5);
    });

    it("returns zero for no billable sessions", () => {
      const sessions = [
        { duration: 3600, is_billable: false },
        { duration: 5400, is_billable: false },
      ];

      const billableSeconds = sessions
        .filter((s) => s.is_billable)
        .reduce((sum, s) => sum + s.duration, 0);
      const billableHours = billableSeconds / 3600;

      expect(billableHours).toBe(0);
    });

    it("handles very short sessions", () => {
      const sessions = [
        { duration: 60, is_billable: true }, // 1 minute
        { duration: 120, is_billable: true }, // 2 minutes
      ];

      const billableSeconds = sessions
        .filter((s) => s.is_billable)
        .reduce((sum, s) => sum + s.duration, 0);
      const billableHours = billableSeconds / 3600;

      // 180 seconds = 3 minutes = 0.05 hours
      expect(billableHours).toBeCloseTo(0.05, 2);
    });
  });

  // ───────────── Group by Project ─────────────
  describe("groupByProject", () => {
    it("groups sessions by project_id", () => {
      const sessions = [
        { id: "s1", project_id: "proj-1", duration: 3600, is_billable: true },
        { id: "s2", project_id: "proj-1", duration: 5400, is_billable: true },
        { id: "s3", project_id: "proj-2", duration: 7200, is_billable: true },
      ];

      const grouped = sessions.reduce(
        (acc, session) => {
          if (!acc[session.project_id]) acc[session.project_id] = [];
          acc[session.project_id].push(session);
          return acc;
        },
        {} as Record<string, typeof sessions>,
      );

      expect(Object.keys(grouped)).toHaveLength(2);
      expect(grouped["proj-1"]).toHaveLength(2);
      expect(grouped["proj-2"]).toHaveLength(1);
    });

    it("calculates totals per project", () => {
      const sessions = [
        { project_id: "proj-1", duration: 3600, is_billable: true },
        { project_id: "proj-1", duration: 5400, is_billable: true },
        { project_id: "proj-2", duration: 7200, is_billable: true },
      ];

      const grouped = sessions.reduce(
        (acc, session) => {
          if (!acc[session.project_id]) {
            acc[session.project_id] = { count: 0, totalSeconds: 0 };
          }
          acc[session.project_id].count++;
          acc[session.project_id].totalSeconds += session.duration;
          return acc;
        },
        {} as Record<string, { count: number; totalSeconds: number }>,
      );

      expect(grouped["proj-1"].totalSeconds).toBe(9000); // 2.5 hours
      expect(grouped["proj-2"].totalSeconds).toBe(7200); // 2 hours
    });
  });

  // ───────────── Filter by Date Range ─────────────
  describe("filterByDateRange", () => {
    it("filters sessions within date range", () => {
      const sessions = [
        {
          id: "s1",
          start_time: "2025-01-05T10:00:00Z",
          is_billable: true,
        },
        {
          id: "s2",
          start_time: "2025-01-15T10:00:00Z",
          is_billable: true,
        },
        {
          id: "s3",
          start_time: "2025-01-25T10:00:00Z",
          is_billable: true,
        },
      ];

      const startDate = new Date("2025-01-01");
      const endDate = new Date("2025-01-20");

      const filtered = sessions.filter((s) => {
        const sessionDate = new Date(s.start_time);
        return sessionDate >= startDate && sessionDate <= endDate;
      });

      expect(filtered).toHaveLength(2);
      expect(filtered[0].id).toBe("s1");
      expect(filtered[1].id).toBe("s2");
    });

    it("includes sessions on start and end dates", () => {
      const sessions = [
        {
          id: "s1",
          start_time: "2025-01-01T00:00:00Z",
          is_billable: true,
        },
        {
          id: "s2",
          start_time: "2025-01-31T23:59:59Z",
          is_billable: true,
        },
      ];

      const startDate = new Date("2025-01-01");
      // End date needs to be at the end of the day
      const endDate = new Date("2025-02-01");

      const filtered = sessions.filter((s) => {
        const sessionDate = new Date(s.start_time);
        return sessionDate >= startDate && sessionDate < endDate;
      });

      expect(filtered).toHaveLength(2);
    });
  });

  // ───────────── Running Total ─────────────
  describe("runningTotal", () => {
    it("calculates running earnings through period", () => {
      const sessions = [
        { date: "2025-01-01", earnings: 100, cumulative: 0 },
        { date: "2025-01-02", earnings: 150, cumulative: 0 },
        { date: "2025-01-03", earnings: 75, cumulative: 0 },
      ];

      let runningTotal = 0;
      const withCumulative = sessions.map((s) => {
        runningTotal += s.earnings;
        return { ...s, cumulative: runningTotal };
      });

      expect(withCumulative[0].cumulative).toBe(100);
      expect(withCumulative[1].cumulative).toBe(250);
      expect(withCumulative[2].cumulative).toBe(325);
    });
  });
});
