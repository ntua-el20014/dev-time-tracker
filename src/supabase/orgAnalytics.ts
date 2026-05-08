/**
 * Organization Analytics API (Supabase)
 * Fetches team-wide analytics and aggregated statistics
 */

import { supabase } from "./config";

export interface OrgAnalyticsSummary {
  total_hours_tracked: number;
  total_sessions: number;
  active_members: number;
}

export interface TopProject {
  project_id: string;
  project_name: string;
  total_hours: number;
  session_count: number;
  active_members: number;
}

export interface LanguageBreakdown {
  language: string;
  total_hours: number;
  percentage: number;
}

export interface MemberActivity {
  user_id: string;
  username: string;
  total_hours: number;
  session_count: number;
  active_projects: number;
  top_language: string;
}

/**
 * Get organization analytics summary (total hours, sessions, active members)
 */
export async function getOrgAnalyticsSummary(
  orgId: string,
  startDate: string,
  endDate: string,
  billableOnly: boolean = false,
): Promise<OrgAnalyticsSummary> {
  const { data, error } = await (supabase as any).rpc(
    "get_org_analytics_summary",
    {
      p_org_id: orgId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_billable_only: billableOnly,
    },
  );

  if (error) throw error;

  if (!data || data.length === 0) {
    return {
      total_hours_tracked: 0,
      total_sessions: 0,
      active_members: 0,
    };
  }

  return data[0] as OrgAnalyticsSummary;
}

/**
 * Get top projects by tracked duration
 */
export async function getOrgTopProjects(
  orgId: string,
  startDate: string,
  endDate: string,
  projectIds?: string[],
  billableOnly: boolean = false,
  limit: number = 10,
): Promise<TopProject[]> {
  const { data, error } = await (supabase as any).rpc("get_org_top_projects", {
    p_org_id: orgId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_project_ids: projectIds || null,
    p_billable_only: billableOnly,
    p_limit: limit,
  });

  if (error) throw error;
  return (data || []) as TopProject[];
}

/**
 * Get language breakdown for organization
 */
export async function getOrgLanguageBreakdown(
  orgId: string,
  startDate: string,
  endDate: string,
  projectIds?: string[],
  memberIds?: string[],
  billableOnly: boolean = false,
): Promise<LanguageBreakdown[]> {
  const { data, error } = await (supabase as any).rpc(
    "get_org_language_breakdown",
    {
      p_org_id: orgId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_project_ids: projectIds || null,
      p_member_ids: memberIds || null,
      p_billable_only: billableOnly,
    },
  );

  if (error) throw error;
  return (data || []) as LanguageBreakdown[];
}

/**
 * Get team member activity (hours, sessions, projects, top language)
 */
export async function getOrgMemberActivity(
  orgId: string,
  startDate: string,
  endDate: string,
  projectIds?: string[],
  memberIds?: string[],
  billableOnly: boolean = false,
): Promise<MemberActivity[]> {
  const { data, error } = await (supabase as any).rpc(
    "get_org_member_activity",
    {
      p_org_id: orgId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_project_ids: projectIds || null,
      p_member_ids: memberIds || null,
      p_billable_only: billableOnly,
    },
  );

  if (error) throw error;
  return (data || []) as MemberActivity[];
}
