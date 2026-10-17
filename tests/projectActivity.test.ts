import { describe, expect, it } from "vitest";
import {
  agentTotalsByProject,
  formatAgentTotals,
  formatSpan,
  summarizeProjectActivity,
} from "../shared/projectActivity";

describe("agentTotalsByProject", () => {
  it("sums time and reported cost per project, skipping unattributed sessions", () => {
    const by = agentTotalsByProject([
      { project_id: "a", active_seconds: 3600, cost_usd: 10 },
      { project_id: "a", active_seconds: 600, cost_usd: "2.5" },
      { project_id: "b", active_seconds: 60, cost_usd: null },
      { project_id: null, active_seconds: 999, cost_usd: 99 },
    ]);
    expect([...by.keys()].sort()).toEqual(["a", "b"]);
    expect(by.get("a")).toEqual({ sessions: 2, activeSeconds: 4200, costUsd: 12.5, costIncomplete: false });
    expect(by.get("b")).toEqual({ sessions: 1, activeSeconds: 60, costUsd: 0, costIncomplete: true });
  });
});

describe("summarizeProjectActivity", () => {
  const stats = (added: number, removed: number, commits = 0) => ({
    repo_key: "github.com/o/r",
    repo_name: "r",
    commits,
    files_changed: 1,
    lines_added: added,
    lines_removed: removed,
    languages: { TypeScript: { added, removed } },
  });

  it("splits your time into input and supervising, next to agent time and code", () => {
    const [a, ...rest] = summarizeProjectActivity(
      [
        { project_id: "p", duration: 3600, supervising_seconds: 600, code_stats: [stats(10, 2, 1)] },
        { project_id: "p", duration: 1800, supervising_seconds: null, code_stats: [stats(5, 0)] },
        { project_id: null, duration: 999, supervising_seconds: 0 },
      ],
      [
        { project_id: "p", active_seconds: 2400, cost_usd: "1.50" },
        { project_id: null, active_seconds: 100, cost_usd: 9 },
      ],
    );
    expect(rest).toEqual([]);
    expect(a).toMatchObject({
      projectId: "p",
      sessions: 2,
      humanSeconds: 4800,
      supervisingSeconds: 600,
      agent: { sessions: 1, activeSeconds: 2400, costUsd: 1.5, costIncomplete: false },
    });
    expect(a.code).toMatchObject({ commits: 1, filesChanged: 2, linesAdded: 15, linesRemoved: 2 });
    expect(a.code.languages.TypeScript).toEqual({ added: 15, removed: 2 });
  });

  it("lists projects with only agent work, and clamps bad supervising values", () => {
    const out = summarizeProjectActivity(
      [{ project_id: "x", duration: 100, supervising_seconds: 500 }],
      [{ project_id: "y", active_seconds: 60, cost_usd: null }],
    );
    const x = out.find((p) => p.projectId === "x")!;
    const y = out.find((p) => p.projectId === "y")!;
    expect(x).toMatchObject({ humanSeconds: 0, supervisingSeconds: 100 });
    expect(y).toMatchObject({ sessions: 0, humanSeconds: 0, agent: { sessions: 1, costIncomplete: true } });
  });
});

describe("formatting", () => {
  it("formats time, cost and sessions", () => {
    expect(formatAgentTotals({ sessions: 5, activeSeconds: 11_400, costUsd: 42.1, costIncomplete: false })).toBe(
      "3h 10m · $42.10 · 5 sessions",
    );
    expect(formatAgentTotals({ sessions: 1, activeSeconds: 300, costUsd: 1, costIncomplete: true })).toBe(
      "5m · $1.00+ · 1 session",
    );
    expect(formatAgentTotals({ sessions: 1, activeSeconds: 60, costUsd: 0, costIncomplete: true })).toBe(
      "1m · cost unknown · 1 session",
    );
  });

  it("never shows 60 minutes", () => {
    expect(formatSpan(3599)).toBe("1h 00m");
    expect(formatSpan(29)).toBe("0m");
  });
});
