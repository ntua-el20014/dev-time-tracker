import { supabase } from "./config";
import { localDayStartISO, localDayEndISO } from "../utils/timeFormat";
import {
  agentTotalsByProject,
  summarizeProjectActivity,
  type AgentSessionLike,
  type AgentTotals,
  type ProjectActivity,
  type SessionLike,
} from "../../shared/projectActivity";

/**
 * The user's agent sessions with a project that started within local days
 * [startDate, endDate], optionally for some projects only.
 */
async function agentSessionsWithProject(
  userId: string,
  startDate: string,
  endDate: string,
  projectIds?: string[],
): Promise<AgentSessionLike[]> {
  let query = supabase
    .from("agent_sessions")
    .select("project_id, active_seconds, cost_usd")
    .eq("user_id", userId)
    .not("project_id", "is", null)
    .gte("started_at", localDayStartISO(startDate))
    .lte("started_at", localDayEndISO(endDate));
  if (projectIds) query = query.in("project_id", projectIds);
  const { data, error } = await query;
  if (error) throw error;
  return (data as AgentSessionLike[] | null) || [];
}

/** Agent time and reported cost per project, for Billing and invoices. */
export async function getAgentTotalsByProject(
  userId: string,
  startDate: string,
  endDate: string,
  projectIds?: string[],
): Promise<Map<string, AgentTotals>> {
  if (projectIds && projectIds.length === 0) return new Map();
  return agentTotalsByProject(
    await agentSessionsWithProject(userId, startDate, endDate, projectIds),
  );
}

/**
 * Per-project activity of the user within local days [startDate, endDate]:
 * their session time (with input / supervising), their agents' time and
 * cost, and code changed. Only the user's own work, also on org projects.
 */
export async function getProjectActivity(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<ProjectActivity[]> {
  const { data, error } = await supabase
    .from("time_tracking_sessions")
    .select("project_id, duration, supervising_seconds, code_stats")
    .eq("user_id", userId)
    .not("project_id", "is", null)
    .gte("start_time", localDayStartISO(startDate))
    .lte("start_time", localDayEndISO(endDate));
  if (error) throw error;
  const agents = await agentSessionsWithProject(userId, startDate, endDate);
  return summarizeProjectActivity((data as SessionLike[] | null) || [], agents);
}
