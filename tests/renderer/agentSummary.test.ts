import { describe, expect, it } from "vitest";
import {
  formatAgentSummary,
  summarizeAgentSessionsByProject,
} from "../../renderer/utils/agentSummary";

describe("summarizeAgentSessionsByProject", () => {
  it("sums time and reported cost per project, skipping unattributed sessions", () => {
    const by = summarizeAgentSessionsByProject([
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

describe("formatAgentSummary", () => {
  it("formats time, cost and sessions", () => {
    expect(formatAgentSummary({ sessions: 5, activeSeconds: 11_400, costUsd: 42.1, costIncomplete: false })).toBe(
      "3h 10m · $42.10 · 5 sessions",
    );
    expect(formatAgentSummary({ sessions: 1, activeSeconds: 300, costUsd: 1, costIncomplete: true })).toBe(
      "5m · $1.00+ · 1 session",
    );
    expect(formatAgentSummary({ sessions: 1, activeSeconds: 60, costUsd: 0, costIncomplete: true })).toBe(
      "1m · cost unknown · 1 session",
    );
  });
});
