import { supabase } from "./config";
import { localDayStartISO, localDayEndISO } from "../utils/timeFormat";
import type { AgentSessionRow } from "../tracking/agentIngest";

export interface AgentSession extends AgentSessionRow {
  id: string;
}

const COLUMNS =
  "id, source, external_id, repo_key, repo_name, project_id, started_at, ended_at, active_seconds, prompts, tool_calls, files_changed, lines_added, lines_removed, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, models, languages, cost_usd";

/** Insert or update the user's agent sessions (keyed by source + external_id). */
export async function upsertAgentSessions(
  userId: string,
  rows: AgentSessionRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await (supabase as any)
    .from("agent_sessions")
    .upsert(
      rows.map((r) => ({ ...r, user_id: userId })),
      { onConflict: "user_id,source,external_id" },
    );
  if (error) throw error;
}

/** The user's agent sessions that started within local days [startDate, endDate]. */
export async function getAgentSessions(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<AgentSession[]> {
  const { data, error } = await supabase
    .from("agent_sessions")
    .select(COLUMNS)
    .eq("user_id", userId)
    .gte("started_at", localDayStartISO(startDate))
    .lte("started_at", localDayEndISO(endDate))
    .order("started_at", { ascending: false });
  if (error) throw error;
  return (data as AgentSession[] | null) || [];
}

/** A repo was just linked: give its earlier, unattributed agent sessions the project. */
export async function assignAgentSessionsProject(
  userId: string,
  repoKey: string,
  projectId: string,
): Promise<void> {
  const { error } = await (supabase as any)
    .from("agent_sessions")
    .update({ project_id: projectId })
    .eq("user_id", userId)
    .eq("repo_key", repoKey)
    .is("project_id", null);
  if (error) throw error;
}

/** Remove everything the app uploaded about the user's agent sessions. */
export async function deleteAgentSessions(userId: string): Promise<void> {
  const { error } = await supabase
    .from("agent_sessions")
    .delete()
    .eq("user_id", userId);
  if (error) throw error;
}
