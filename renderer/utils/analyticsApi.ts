/**
 * Organization Analytics API for Renderer Process
 * Provides typed wrappers around IPC calls to analytics handlers
 */

import { safeIpcInvoke } from "./ipcHelpers";
import type {
  OrgAnalyticsSummary,
  TopProject,
  LanguageBreakdown,
  MemberActivity,
} from "../../src/supabase/orgAnalytics";

export async function getOrgAnalyticsSummary(
  startDate: string,
  endDate: string,
  billableOnly: boolean = false,
): Promise<OrgAnalyticsSummary | null> {
  return await safeIpcInvoke<OrgAnalyticsSummary | null>(
    "org:get-analytics-summary",
    [startDate, endDate, billableOnly],
    { fallback: null },
  );
}

export async function getOrgTopProjects(
  startDate: string,
  endDate: string,
  projectIds?: string[],
  billableOnly: boolean = false,
  limit: number = 10,
): Promise<TopProject[]> {
  return await safeIpcInvoke<TopProject[]>(
    "org:get-top-projects",
    [startDate, endDate, projectIds, billableOnly, limit],
    { fallback: [] },
  );
}

export async function getOrgLanguageBreakdown(
  startDate: string,
  endDate: string,
  projectIds?: string[],
  memberIds?: string[],
  billableOnly: boolean = false,
): Promise<LanguageBreakdown[]> {
  return await safeIpcInvoke<LanguageBreakdown[]>(
    "org:get-language-breakdown",
    [startDate, endDate, projectIds, memberIds, billableOnly],
    { fallback: [] },
  );
}

export async function getOrgMemberActivity(
  startDate: string,
  endDate: string,
  projectIds?: string[],
  memberIds?: string[],
  billableOnly: boolean = false,
): Promise<MemberActivity[]> {
  return await safeIpcInvoke<MemberActivity[]>(
    "org:get-member-activity",
    [startDate, endDate, projectIds, memberIds, billableOnly],
    { fallback: [] },
  );
}
