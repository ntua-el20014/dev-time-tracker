/**
 * Organization Analytics IPC Handlers
 * Bridges renderer process to Supabase org analytics APIs
 */

import { ipcMain } from "electron";
import * as analyticsApi from "../supabase/orgAnalytics";
import { getCurrentUser } from "../supabase/api";
import * as orgApi from "../supabase/organizations";
import { logError } from "../utils/errorHandler";

/**
 * Get organization analytics summary
 */
ipcMain.handle(
  "org:get-analytics-summary",
  async (
    _event,
    startDate: string,
    endDate: string,
    billableOnly: boolean = false,
  ) => {
    try {
      const user = await getCurrentUser();
      if (!user) throw new Error("Not authenticated");

      // Get user's org
      const org = await orgApi.getCurrentOrganization(user.id);
      if (!org) throw new Error("User not in an organization");

      // Check if user is admin or manager (enforced by RPC, but double-check here)
      const profile = await orgApi.getCurrentUserProfile(user.id);
      if (!profile || !["admin", "manager"].includes(profile.role)) {
        throw new Error("Only admins and managers can view analytics");
      }

      return await analyticsApi.getOrgAnalyticsSummary(
        org.id,
        startDate,
        endDate,
        billableOnly,
      );
    } catch (err) {
      logError("org:get-analytics-summary", err);
      throw err;
    }
  },
);

/**
 * Get top projects by tracked duration
 */
ipcMain.handle(
  "org:get-top-projects",
  async (
    _event,
    startDate: string,
    endDate: string,
    projectIds?: string[],
    billableOnly: boolean = false,
    limit: number = 10,
  ) => {
    try {
      const user = await getCurrentUser();
      if (!user) throw new Error("Not authenticated");

      const org = await orgApi.getCurrentOrganization(user.id);
      if (!org) throw new Error("User not in an organization");

      const profile = await orgApi.getCurrentUserProfile(user.id);
      if (!profile || !["admin", "manager"].includes(profile.role)) {
        throw new Error("Only admins and managers can view analytics");
      }

      return await analyticsApi.getOrgTopProjects(
        org.id,
        startDate,
        endDate,
        projectIds,
        billableOnly,
        limit,
      );
    } catch (err) {
      logError("org:get-top-projects", err);
      throw err;
    }
  },
);

/**
 * Get language breakdown
 */
ipcMain.handle(
  "org:get-language-breakdown",
  async (
    _event,
    startDate: string,
    endDate: string,
    projectIds?: string[],
    memberIds?: string[],
    billableOnly: boolean = false,
  ) => {
    try {
      const user = await getCurrentUser();
      if (!user) throw new Error("Not authenticated");

      const org = await orgApi.getCurrentOrganization(user.id);
      if (!org) throw new Error("User not in an organization");

      const profile = await orgApi.getCurrentUserProfile(user.id);
      if (!profile || !["admin", "manager"].includes(profile.role)) {
        throw new Error("Only admins and managers can view analytics");
      }

      return await analyticsApi.getOrgLanguageBreakdown(
        org.id,
        startDate,
        endDate,
        projectIds,
        memberIds,
        billableOnly,
      );
    } catch (err) {
      logError("org:get-language-breakdown", err);
      throw err;
    }
  },
);

/**
 * Get team member activity
 */
ipcMain.handle(
  "org:get-member-activity",
  async (
    _event,
    startDate: string,
    endDate: string,
    projectIds?: string[],
    memberIds?: string[],
    billableOnly: boolean = false,
  ) => {
    try {
      const user = await getCurrentUser();
      if (!user) throw new Error("Not authenticated");

      const org = await orgApi.getCurrentOrganization(user.id);
      if (!org) throw new Error("User not in an organization");

      const profile = await orgApi.getCurrentUserProfile(user.id);
      if (!profile || !["admin", "manager"].includes(profile.role)) {
        throw new Error("Only admins and managers can view analytics");
      }

      return await analyticsApi.getOrgMemberActivity(
        org.id,
        startDate,
        endDate,
        projectIds,
        memberIds,
        billableOnly,
      );
    } catch (err) {
      logError("org:get-member-activity", err);
      throw err;
    }
  },
);
