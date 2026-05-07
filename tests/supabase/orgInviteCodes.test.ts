import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockResult,
  resetMockState,
  getCallsFor,
} from "../helpers/supabaseMock";

vi.mock("../../src/supabase/config", async () => {
  const { mockSupabase } = await import("../helpers/supabaseMock");
  return { supabase: mockSupabase };
});

import {
  generateInviteCode,
  listInviteCodes,
  revokeInviteCode,
  joinWithInviteCode,
} from "../../src/supabase/orgInviteCodes";

describe("org invite codes", () => {
  beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
  });

  it("generates an invite code from the first RPC row", async () => {
    mockResult({
      data: [{ id: "code-1", code: "ABCD1234" }],
      error: null,
    });

    await expect(generateInviteCode({ max_uses: 3 })).resolves.toEqual({
      id: "code-1",
      code: "ABCD1234",
    });

    const rpcCalls = getCallsFor("rpc");
    expect(rpcCalls[0].args[0]).toBe("create_invite_code");
  });

  it("lists invite codes for an organization", async () => {
    mockResult({
      data: [{ id: "code-1" }, { id: "code-2" }],
      error: null,
    });

    await expect(listInviteCodes("org-1")).resolves.toEqual([
      { id: "code-1" },
      { id: "code-2" },
    ]);

    const eqCalls = getCallsFor("eq");
    expect(eqCalls[0].args).toEqual(["org_id", "org-1"]);
  });

  it("revokes an invite code via RPC", async () => {
    mockResult({ data: null, error: null });

    await expect(revokeInviteCode("code-1")).resolves.toBeUndefined();

    const rpcCalls = getCallsFor("rpc");
    expect(rpcCalls[0].args).toEqual([
      "revoke_invite_code",
      { p_code_id: "code-1" },
    ]);
  });

  it("joins an organization with an invite code", async () => {
    mockResult({
      data: [{ org_id: "org-1", role: "member" }],
      error: null,
    });

    await expect(joinWithInviteCode("CODE123")).resolves.toEqual({
      org_id: "org-1",
      role: "member",
    });
  });
});
