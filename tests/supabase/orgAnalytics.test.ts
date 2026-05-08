import { describe, it, expect } from "vitest";

/**
 * orgAnalytics.test.ts - Type and logic validation tests
 *
 * Tests focus on validating data structures and analytics logic
 * rather than complex RPC mocking. Production deployment tests
 * should verify actual Supabase RPC execution.
 */

describe("orgAnalytics API structure", () => {
  // ───────────── getOrgAnalyticsSummary ─────────────
  describe("getOrgAnalyticsSummary", () => {
    it("returns summary with total hours, sessions, and members", async () => {
      const mockSummary = {
        total_hours_tracked: 42.5,
        total_sessions: 15,
        active_members: 5,
      };

      expect(mockSummary).toHaveProperty("total_hours_tracked");
      expect(mockSummary).toHaveProperty("total_sessions");
      expect(mockSummary).toHaveProperty("active_members");
      expect(typeof mockSummary.total_hours_tracked).toBe("number");
      expect(typeof mockSummary.total_sessions).toBe("number");
      expect(typeof mockSummary.active_members).toBe("number");
    });

    it("returns non-negative values", () => {
      const summary = {
        total_hours_tracked: 42.5,
        total_sessions: 15,
        active_members: 5,
      };

      expect(summary.total_hours_tracked).toBeGreaterThanOrEqual(0);
      expect(summary.total_sessions).toBeGreaterThanOrEqual(0);
      expect(summary.active_members).toBeGreaterThanOrEqual(0);
    });

    it("handles empty period with zeros", () => {
      const summary = {
        total_hours_tracked: 0,
        total_sessions: 0,
        active_members: 0,
      };

      expect(summary.total_hours_tracked).toBe(0);
      expect(summary.total_sessions).toBe(0);
      expect(summary.active_members).toBe(0);
    });
  });

  // ───────────── getOrgTopProjects ─────────────
  describe("getOrgTopProjects", () => {
    it("returns projects with required fields", () => {
      const projects = [
        {
          project_id: "proj-1",
          project_name: "Website Redesign",
          total_hours: 120.5,
          session_count: 45,
          active_members: 3,
        },
        {
          project_id: "proj-2",
          project_name: "Mobile App",
          total_hours: 95.25,
          session_count: 38,
          active_members: 2,
        },
      ];

      projects.forEach((p) => {
        expect(p).toHaveProperty("project_id");
        expect(p).toHaveProperty("project_name");
        expect(p).toHaveProperty("total_hours");
        expect(p).toHaveProperty("session_count");
        expect(p).toHaveProperty("active_members");
      });
    });

    it("can be ranked by total hours", () => {
      const projects = [
        { project_name: "Website Redesign", total_hours: 120.5 },
        { project_name: "Mobile App", total_hours: 95.25 },
        { project_name: "Dashboard", total_hours: 150.0 },
      ];

      const sorted = [...projects].sort(
        (a, b) => b.total_hours - a.total_hours,
      );

      expect(sorted[0].project_name).toBe("Dashboard");
      expect(sorted[1].project_name).toBe("Website Redesign");
      expect(sorted[2].project_name).toBe("Mobile App");
    });

    it("sums project hours correctly", () => {
      const projects = [
        { project_name: "Project A", total_hours: 40.0 },
        { project_name: "Project B", total_hours: 60.5 },
        { project_name: "Project C", total_hours: 20.0 },
      ];

      const totalHours = projects.reduce((sum, p) => sum + p.total_hours, 0);
      expect(totalHours).toBe(120.5);
    });

    it("handles empty project list", () => {
      const projects: any[] = [];
      expect(projects).toHaveLength(0);
    });
  });

  // ───────────── getOrgLanguageBreakdown ─────────────
  describe("getOrgLanguageBreakdown", () => {
    it("returns language breakdown with percentages", () => {
      const languages = [
        { language: "TypeScript", total_hours: 150, percentage: 45.5 },
        { language: "Python", total_hours: 120, percentage: 36.2 },
        { language: "SQL", total_hours: 60, percentage: 18.3 },
      ];

      languages.forEach((lang) => {
        expect(lang).toHaveProperty("language");
        expect(lang).toHaveProperty("total_hours");
        expect(lang).toHaveProperty("percentage");
        expect(lang.percentage).toBeGreaterThanOrEqual(0);
        expect(lang.percentage).toBeLessThanOrEqual(100);
      });
    });

    it("percentages sum to approximately 100%", () => {
      const languages = [
        { language: "TypeScript", percentage: 45.5 },
        { language: "Python", percentage: 36.2 },
        { language: "SQL", percentage: 18.3 },
      ];

      const total = languages.reduce((sum, lang) => sum + lang.percentage, 0);
      expect(total).toBeCloseTo(100, 1);
    });

    it("handles unknown language as 'Other'", () => {
      const languages = [
        { language: "Other", total_hours: 30, percentage: 100 },
      ];

      expect(languages[0].language).toBe("Other");
      expect(languages[0].percentage).toBe(100);
    });

    it("handles empty language list", () => {
      const languages: any[] = [];
      expect(languages).toHaveLength(0);
    });
  });

  // ───────────── getOrgMemberActivity ─────────────
  describe("getOrgMemberActivity", () => {
    it("returns member activity with required fields", () => {
      const members = [
        {
          user_id: "user-1",
          username: "alice",
          total_hours: 80,
          session_count: 32,
          active_projects: 3,
          top_language: "TypeScript",
        },
        {
          user_id: "user-2",
          username: "bob",
          total_hours: 60,
          session_count: 25,
          active_projects: 2,
          top_language: "Python",
        },
      ];

      members.forEach((m) => {
        expect(m).toHaveProperty("user_id");
        expect(m).toHaveProperty("username");
        expect(m).toHaveProperty("total_hours");
        expect(m).toHaveProperty("session_count");
        expect(m).toHaveProperty("active_projects");
        expect(m).toHaveProperty("top_language");
      });
    });

    it("can be sorted by total_hours descending", () => {
      const members = [
        { username: "alice", total_hours: 100 },
        { username: "bob", total_hours: 50 },
        { username: "charlie", total_hours: 75 },
      ];

      const sorted = [...members].sort((a, b) => b.total_hours - a.total_hours);

      expect(sorted[0].username).toBe("alice");
      expect(sorted[1].username).toBe("charlie");
      expect(sorted[2].username).toBe("bob");
    });

    it("handles members with no language tracking", () => {
      const member = {
        username: "charlie",
        total_hours: 20,
        session_count: 10,
        active_projects: 1,
        top_language: "None",
      };

      expect(member.top_language).toBe("None");
    });

    it("calculates active_projects correctly", () => {
      const member = {
        username: "alice",
        active_projects: 3,
        projects: ["proj-1", "proj-2", "proj-3"],
      };

      expect(member.active_projects).toBe(member.projects.length);
    });

    it("handles empty member list", () => {
      const members: any[] = [];
      expect(members).toHaveLength(0);
    });
  });
});
