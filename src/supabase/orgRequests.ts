/**
 * Organization Join Requests API (Supabase)
 * Handles requests to join organizations
 */

import { supabase } from "./config";
import type {
  OrgJoinRequest,
  OrgJoinRequestWithUser,
} from "../types/organization.types";

/**
 * Create a request to join an organization
 */
export async function requestToJoinOrganization(
  orgId: string,
  userId?: string,
): Promise<OrgJoinRequest> {
  let currentUserId = userId;

  // If userId not provided, try to get from auth
  if (!currentUserId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    currentUserId = user.id;
  }

  // Check if user already has a pending request for this org
  const { data: existing } = await supabase
    .from("org_join_requests")
    .select("*")
    .eq("user_id", currentUserId)
    .eq("org_id", orgId)
    .eq("status", "pending")
    .single();

  if (existing) {
    throw new Error("You already have a pending request for this organization");
  }

  // Create the join request
  const { data, error } = await supabase
    .from("org_join_requests")
    .insert({
      user_id: currentUserId,
      org_id: orgId,
      status: "pending",
    } as any)
    .select()
    .single();

  if (error) throw error;
  return data as OrgJoinRequest;
}

/**
 * Get all join requests for the current user
 */
export async function getMyJoinRequests(
  userId?: string,
): Promise<OrgJoinRequest[]> {
  let currentUserId = userId;

  // If userId not provided, try to get from auth
  if (!currentUserId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    currentUserId = user.id;
  }

  const { data, error } = await supabase
    .from("org_join_requests")
    .select("*")
    .eq("user_id", currentUserId)
    .order("requested_at", { ascending: false });

  if (error) throw error;
  return (data || []) as OrgJoinRequest[];
}

/**
 * Get pending join requests for the current user's organization (admin only)
 */
export async function getPendingJoinRequests(
  userId?: string,
): Promise<OrgJoinRequestWithUser[]> {
  let currentUserId = userId;

  // If userId not provided, try to get from auth
  if (!currentUserId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    currentUserId = user.id;
  }

  // Use SECURITY DEFINER function to get user profile (bypasses RLS)
  const { data: profileData, error: profileError } = await (
    supabase.rpc as any
  )("get_user_profile_by_id", { p_user_id: currentUserId });

  if (profileError) throw profileError;

  const profile: any =
    profileData && Array.isArray(profileData) && profileData.length > 0
      ? profileData[0]
      : null;

  if (!profile?.org_id) {
    throw new Error("Not in an organization");
  }

  if (profile.role !== "admin") {
    throw new Error("Only admins can view join requests");
  }

  // Get pending requests with user info
  const { data, error } = await supabase
    .from("org_join_requests")
    .select(
      `
      *,
      user:user_profiles!user_id (
        username,
        email,
        avatar
      )
    `,
    )
    .eq("org_id", profile.org_id)
    .eq("status", "pending")
    .order("requested_at", { ascending: false });

  if (error) throw error;
  return (data || []) as OrgJoinRequestWithUser[];
}

/**
 * Approve a join request (admin only)
 * Uses the database function for proper permissions
 */
export async function approveJoinRequest(requestId: string): Promise<void> {
  const { error } = await (supabase.rpc as any)("approve_join_request", {
    request_id: requestId,
  });

  if (error) throw error;
}

/**
 * Reject a join request (admin only)
 * Uses the database function for proper permissions
 */
export async function rejectJoinRequest(requestId: string): Promise<void> {
  const { error } = await (supabase.rpc as any)("reject_join_request", {
    request_id: requestId,
  });

  if (error) throw error;
}

/**
 * Cancel own join request
 */
export async function cancelJoinRequest(
  requestId: string,
  userId?: string,
): Promise<void> {
  let currentUserId = userId;

  // If userId not provided, try to get from auth
  if (!currentUserId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    currentUserId = user.id;
  }

  const { error } = await supabase
    .from("org_join_requests")
    .delete()
    .eq("id", requestId)
    .eq("user_id", currentUserId)
    .eq("status", "pending");

  if (error) throw error;
}
