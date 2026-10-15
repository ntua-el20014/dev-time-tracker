import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
let role = "employee";

vi.mock("../../renderer/utils/ipcHelpers", () => ({
  safeIpcInvoke: (channel: string, args: unknown[]) => invoke(channel, args),
}));
vi.mock("../../renderer/utils/userUtils", () => ({
  getCurrentUserRole: async () => role,
}));

import {
  isInviteCodeUsable,
  loadTeamSignals,
  shouldShowTeam,
  type TeamSignals,
} from "../../renderer/utils/teamVisibility";
import type { OrgInviteCode } from "../../src/types/organization.types";

const solo: TeamSignals = {
  hasOrg: true,
  memberCount: 1,
  pendingJoinRequests: 0,
  usableInviteCodes: 0,
  myPendingRequests: 0,
};

function code(overrides: Partial<OrgInviteCode> = {}): OrgInviteCode {
  return {
    id: "c1",
    org_id: "o1",
    code: "AAAA-BBBB-CCCC",
    created_by: "u1",
    max_uses: null,
    use_count: 0,
    expires_at: null,
    is_active: true,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

describe("shouldShowTeam", () => {
  it("hides Team for a solo user in their personal org", () => {
    expect(shouldShowTeam(solo)).toBe(false);
  });

  it("hides Team for a user with no org", () => {
    expect(shouldShowTeam({ ...solo, hasOrg: false, memberCount: 0 })).toBe(
      false,
    );
  });

  it("shows Team once the org has another member", () => {
    expect(shouldShowTeam({ ...solo, memberCount: 2 })).toBe(true);
  });

  it("shows Team while someone is waiting to join or an invite is usable", () => {
    expect(shouldShowTeam({ ...solo, pendingJoinRequests: 1 })).toBe(true);
    expect(shouldShowTeam({ ...solo, usableInviteCodes: 1 })).toBe(true);
  });

  it("shows Team while the user's own join request is pending, even without an org", () => {
    expect(
      shouldShowTeam({
        ...solo,
        hasOrg: false,
        memberCount: 0,
        myPendingRequests: 1,
      }),
    ).toBe(true);
  });
});

describe("isInviteCodeUsable", () => {
  const now = new Date("2026-10-15T12:00:00Z");

  it("accepts an active code with no limits", () => {
    expect(isInviteCodeUsable(code(), now)).toBe(true);
  });

  it("rejects revoked, expired and used-up codes", () => {
    expect(isInviteCodeUsable(code({ is_active: false }), now)).toBe(false);
    expect(
      isInviteCodeUsable(code({ expires_at: "2026-10-15T11:59:59Z" }), now),
    ).toBe(false);
    expect(isInviteCodeUsable(code({ max_uses: 3, use_count: 3 }), now)).toBe(
      false,
    );
  });

  it("accepts a code that expires later and has uses left", () => {
    expect(
      isInviteCodeUsable(
        code({ expires_at: "2026-10-16T00:00:00Z", max_uses: 3, use_count: 2 }),
        now,
      ),
    ).toBe(true);
  });
});

describe("loadTeamSignals", () => {
  beforeEach(() => {
    invoke.mockReset();
    role = "employee";
  });

  function respond(responses: Record<string, unknown>) {
    invoke.mockImplementation(async (channel: string) => responses[channel]);
  }

  it("counts members and the user's own pending requests", async () => {
    respond({
      "org:get-current": { id: "o1", name: "Acme" },
      "org:get-my-requests": [{ status: "pending" }, { status: "rejected" }],
      "org:get-members": [{ id: "u1" }, { id: "u2" }],
    });
    const s = await loadTeamSignals();
    expect(s).toMatchObject({
      hasOrg: true,
      memberCount: 2,
      myPendingRequests: 1,
    });
    expect(invoke).not.toHaveBeenCalledWith(
      "org:list-invite-codes",
      expect.anything(),
    );
  });

  it("does not load requests or invite codes for employees", async () => {
    respond({
      "org:get-current": { id: "o1", name: "Me" },
      "org:get-my-requests": [],
      "org:get-members": [{ id: "u1" }],
    });
    const s = await loadTeamSignals();
    expect(shouldShowTeam(s)).toBe(false);
    expect(invoke).not.toHaveBeenCalledWith(
      "org:get-pending-requests",
      expect.anything(),
    );
  });

  it("lets a solo admin with a usable invite code see Team", async () => {
    role = "admin";
    respond({
      "org:get-current": { id: "o1", name: "Me" },
      "org:get-my-requests": [],
      "org:get-members": [{ id: "u1" }],
      "org:get-pending-requests": [],
      "org:list-invite-codes": [code(), code({ is_active: false })],
    });
    const s = await loadTeamSignals();
    expect(s.usableInviteCodes).toBe(1);
    expect(shouldShowTeam(s)).toBe(true);
  });

  it("treats a missing org as no team", async () => {
    respond({ "org:get-current": null, "org:get-my-requests": null });
    const s = await loadTeamSignals();
    expect(s).toMatchObject({ hasOrg: false, myPendingRequests: 0 });
    expect(shouldShowTeam(s)).toBe(false);
  });
});
