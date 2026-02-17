/**
 * Organization Invite Codes API (Supabase)
 * Handles invite code generation, listing, revocation, and joining
 */

import { supabase } from "./config";
import type {
  OrgInviteCode,
  CreateInviteCodeData,
  JoinWithCodeResult,
} from "../types/organization.types";

/**
 * Generate a new invite code for the current user's organization
 * Uses the create_invite_code database function
 */
export async function generateInviteCode(
  data: CreateInviteCodeData = {},
): Promise<OrgInviteCode> {
  const { data: result, error } = await (supabase.rpc as any)(
    "create_invite_code",
    {
      p_max_uses: data.max_uses ?? null,
      p_expires_in_days: data.expires_in_days ?? null,
    },
  );

  if (error) throw error;

  // RPC returns an array from RETURNS TABLE
  const row = Array.isArray(result) ? result[0] : result;
  if (!row) throw new Error("Failed to create invite code");

  return row as OrgInviteCode;
}

/**
 * List all invite codes for the current user's organization
 */
export async function listInviteCodes(orgId: string): Promise<OrgInviteCode[]> {
  const { data, error } = await (supabase as any)
    .from("org_invite_codes")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []) as OrgInviteCode[];
}

/**
 * Revoke an invite code
 * Uses the revoke_invite_code database function
 */
export async function revokeInviteCode(codeId: string): Promise<void> {
  const { error } = await (supabase.rpc as any)("revoke_invite_code", {
    p_code_id: codeId,
  });

  if (error) throw error;
}

/**
 * Join an organization using an invite code
 * Uses the join_organization_with_code database function
 */
export async function joinWithInviteCode(
  code: string,
): Promise<JoinWithCodeResult> {
  const { data, error } = await (supabase.rpc as any)(
    "join_organization_with_code",
    {
      p_code: code,
    },
  );

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Failed to join organization");

  return row as JoinWithCodeResult;
}
