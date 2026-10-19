/**
 * Per-project activity (C6): your time (with input / supervising an agent),
 * AI agent time and reported cost, and code changed (git, C2). Pure, used
 * by main (Billing, invoices) and the renderer (Projects).
 *
 * Agent time overlaps your time (an agent often works while you supervise
 * it), so the two are shown side by side, never added up.
 */
import {
  addCodeStats,
  emptyTotals,
  type CodeTotals,
  type RepoCodeStats,
} from "./codeStats";

export interface AgentSessionLike {
  project_id: string | null;
  active_seconds: number | null;
  /** PostgREST returns NUMERIC as a number or a string */
  cost_usd: number | string | null;
}

export interface AgentTotals {
  sessions: number;
  activeSeconds: number;
  /** Sum of the costs the agents reported */
  costUsd: number;
  /** Some sessions had no reported cost, so costUsd is a lower bound */
  costIncomplete: boolean;
}

export interface SessionLike {
  project_id: string | null;
  duration: number | null;
  supervising_seconds?: number | null;
  code_stats?: RepoCodeStats[] | null;
}

export interface ProjectActivity {
  projectId: string;
  sessions: number;
  /** Session time with keyboard/mouse input (duration minus supervising) */
  humanSeconds: number;
  /** Session time spent supervising an AI agent */
  supervisingSeconds: number;
  agent: AgentTotals;
  code: CodeTotals;
}

export function emptyAgentTotals(): AgentTotals {
  return { sessions: 0, activeSeconds: 0, costUsd: 0, costIncomplete: false };
}

/** Add one agent session to running totals. */
export function addAgentSession(t: AgentTotals, s: AgentSessionLike): AgentTotals {
  t.sessions += 1;
  t.activeSeconds += s.active_seconds || 0;
  const cost = s.cost_usd === null || s.cost_usd === "" ? NaN : Number(s.cost_usd);
  if (Number.isFinite(cost)) t.costUsd += cost;
  else t.costIncomplete = true;
  return t;
}

/** Agent totals per project (sessions without a project are left out). */
export function agentTotalsByProject(
  sessions: AgentSessionLike[],
): Map<string, AgentTotals> {
  const byProject = new Map<string, AgentTotals>();
  for (const s of sessions) {
    if (!s.project_id) continue;
    const t = byProject.get(s.project_id) ?? emptyAgentTotals();
    byProject.set(s.project_id, addAgentSession(t, s));
  }
  return byProject;
}

/** Activity per project from your sessions and your agents' sessions. */
export function summarizeProjectActivity(
  sessions: SessionLike[],
  agentSessions: AgentSessionLike[],
): ProjectActivity[] {
  const byProject = new Map<string, ProjectActivity>();
  const entry = (projectId: string) => {
    let a = byProject.get(projectId);
    if (!a) {
      a = {
        projectId,
        sessions: 0,
        humanSeconds: 0,
        supervisingSeconds: 0,
        agent: emptyAgentTotals(),
        code: emptyTotals(),
      };
      byProject.set(projectId, a);
    }
    return a;
  };
  for (const s of sessions) {
    if (!s.project_id) continue;
    const a = entry(s.project_id);
    const duration = Math.max(0, s.duration || 0);
    const supervising = Math.min(duration, Math.max(0, s.supervising_seconds || 0));
    a.sessions += 1;
    a.humanSeconds += duration - supervising;
    a.supervisingSeconds += supervising;
    addCodeStats(a.code, s.code_stats);
  }
  for (const s of agentSessions) {
    if (s.project_id) addAgentSession(entry(s.project_id).agent, s);
  }
  return [...byProject.values()];
}

/** Whole money amount in USD, rounded to cents. */
export const roundUsd = (n: number) => Math.round(n * 100) / 100;

/** "$42.10", "$42.10+" when some costs are unknown, or "cost unknown". */
export function formatAgentCost(t: AgentTotals): string {
  if (t.costUsd > 0 || !t.costIncomplete) {
    return `$${t.costUsd.toFixed(2)}${t.costIncomplete ? "+" : ""}`;
  }
  return "cost unknown";
}

/** "3h 05m" or "42m". */
export function formatSpan(seconds: number): string {
  const total = Math.round(Math.max(0, seconds) / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** "3h 10m · $42.10 · 5 sessions" */
export function formatAgentTotals(t: AgentTotals): string {
  return `${formatSpan(t.activeSeconds)} · ${formatAgentCost(t)} · ${t.sessions} session${t.sessions === 1 ? "" : "s"}`;
}

/**
 * The projects with the most going on (Home's widget): ordered by your time
 * plus agent time (only to rank them; the two overlap and are never shown
 * added up), projects with nothing left out.
 */
export function busiestProjects(list: ProjectActivity[], limit: number): ProjectActivity[] {
  const weight = (a: ProjectActivity) =>
    a.humanSeconds + a.supervisingSeconds + a.agent.activeSeconds;
  return list
    .filter((a) => a.sessions > 0 || a.agent.sessions > 0)
    .sort((x, y) => weight(y) - weight(x))
    .slice(0, limit);
}
