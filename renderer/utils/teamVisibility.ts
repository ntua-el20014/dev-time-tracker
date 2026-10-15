/**
 * Whether the sidebar shows the Team item.
 *
 * Every user gets a personal organization at signup, so "has an org" says
 * nothing. Team appears once there is actually a team: other members, people
 * waiting to join, an invite code that can still be used, or the user's own
 * request to join someone else's org. Solo users reach team setup from
 * Settings → Account & team instead.
 */

import { safeIpcInvoke } from "./ipcHelpers";
import { getCurrentUserRole } from "./userUtils";
import type {
  Organization,
  OrgInviteCode,
  OrgJoinRequest,
  UserProfile,
} from "../../src/types/organization.types";

export interface TeamSignals {
  hasOrg: boolean;
  memberCount: number;
  /** Requests to join the user's org (only loaded for admins/managers) */
  pendingJoinRequests: number;
  /** Usable invite codes of the user's org (only loaded for admins/managers) */
  usableInviteCodes: number;
  /** The user's own pending requests to join an org */
  myPendingRequests: number;
}

export function shouldShowTeam(s: TeamSignals): boolean {
  if (s.myPendingRequests > 0) return true;
  if (!s.hasOrg) return false;
  return (
    s.memberCount > 1 || s.pendingJoinRequests > 0 || s.usableInviteCodes > 0
  );
}

export function isInviteCodeUsable(code: OrgInviteCode, now: Date): boolean {
  if (!code.is_active) return false;
  if (code.expires_at && new Date(code.expires_at) <= now) return false;
  if (code.max_uses !== null && code.use_count >= code.max_uses) return false;
  return true;
}

const quiet = { showNotification: false } as const;

/** Load the signals for the signed-in user (failures count as "no team"). */
export async function loadTeamSignals(): Promise<TeamSignals> {
  const [org, myRequests] = await Promise.all([
    safeIpcInvoke<Organization | null>("org:get-current", [], {
      ...quiet,
      fallback: null,
    }),
    safeIpcInvoke<OrgJoinRequest[]>("org:get-my-requests", [], {
      ...quiet,
      fallback: [],
    }),
  ]);
  const signals: TeamSignals = {
    hasOrg: !!org,
    memberCount: 0,
    pendingJoinRequests: 0,
    usableInviteCodes: 0,
    myPendingRequests: (myRequests ?? []).filter((r) => r.status === "pending")
      .length,
  };
  if (!org) return signals;

  const members = await safeIpcInvoke<UserProfile[]>(
    "org:get-members",
    [org.id],
    { ...quiet, fallback: [] },
  );
  signals.memberCount = members?.length ?? 0;
  if (signals.memberCount > 1) return signals;

  const role = await getCurrentUserRole();
  if (role === "admin" || role === "manager") {
    const [requests, codes] = await Promise.all([
      safeIpcInvoke<OrgJoinRequest[]>("org:get-pending-requests", [], {
        ...quiet,
        fallback: [],
      }),
      safeIpcInvoke<OrgInviteCode[]>("org:list-invite-codes", [org.id], {
        ...quiet,
        fallback: [],
      }),
    ]);
    const now = new Date();
    signals.pendingJoinRequests = (requests ?? []).filter(
      (r) => r.status === "pending",
    ).length;
    signals.usableInviteCodes = (codes ?? []).filter((c) =>
      isInviteCodeUsable(c, now),
    ).length;
  }
  return signals;
}
