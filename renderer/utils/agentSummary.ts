/**
 * Per-project totals of AI agent sessions (C3 data) for the Projects page.
 * Pure, so it can be tested.
 */

export interface AgentSessionLike {
  project_id: string | null;
  active_seconds: number;
  cost_usd: number | string | null;
}

export interface ProjectAgentSummary {
  sessions: number;
  activeSeconds: number;
  /** Sum of the costs the agents reported */
  costUsd: number;
  /** Some sessions had no reported cost, so costUsd is a lower bound */
  costIncomplete: boolean;
}

export function summarizeAgentSessionsByProject(
  sessions: AgentSessionLike[],
): Map<string, ProjectAgentSummary> {
  const byProject = new Map<string, ProjectAgentSummary>();
  for (const s of sessions) {
    if (!s.project_id) continue;
    const summary = byProject.get(s.project_id) ?? {
      sessions: 0,
      activeSeconds: 0,
      costUsd: 0,
      costIncomplete: false,
    };
    summary.sessions += 1;
    summary.activeSeconds += s.active_seconds || 0;
    // PostgREST returns NUMERIC as a number or a string
    const cost = s.cost_usd === null ? NaN : Number(s.cost_usd);
    if (Number.isFinite(cost)) summary.costUsd += cost;
    else summary.costIncomplete = true;
    byProject.set(s.project_id, summary);
  }
  return byProject;
}

/** "3h 10m · $42.10 · 5 sessions" ("$42.10+" when some costs are unknown). */
export function formatAgentSummary(s: ProjectAgentSummary): string {
  const h = Math.floor(s.activeSeconds / 3600);
  const m = Math.round((s.activeSeconds % 3600) / 60);
  const time = h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
  const cost =
    s.costUsd > 0 || !s.costIncomplete
      ? `$${s.costUsd.toFixed(2)}${s.costIncomplete ? "+" : ""}`
      : "cost unknown";
  return `${time} · ${cost} · ${s.sessions} session${s.sessions === 1 ? "" : "s"}`;
}
