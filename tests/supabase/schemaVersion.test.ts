import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync } from "fs";
import path from "path";
import { mockRpcResult, resetMockState, getCallsFor } from "../helpers/supabaseMock";

vi.mock("../../src/supabase/config", async () => {
  const { mockSupabase } = await import("../helpers/supabaseMock");
  return { supabase: mockSupabase };
});

import { getSchemaVersion, REQUIRED_SCHEMA_VERSION } from "../../src/supabase/schemaVersion";

describe("schema version", () => {
  beforeEach(() => resetMockState());

  it("this build needs every migration in database/migrations", () => {
    const highest = Math.max(
      ...readdirSync(path.join(__dirname, "../../database/migrations"))
        .map((file) => /^(\d{4})_/.exec(file))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => Number(m[1])),
    );
    expect(REQUIRED_SCHEMA_VERSION).toBe(highest);
  });

  it("asks the database", async () => {
    mockRpcResult("get_schema_version", { data: 2, error: null });
    expect(await getSchemaVersion()).toBe(2);
    expect(getCallsFor("rpc")[0].args[0]).toBe("get_schema_version");
  });

  it("counts a database without the function as before migration 2", async () => {
    mockRpcResult("get_schema_version", { data: null, error: { code: "PGRST202", message: "not found" } });
    expect(await getSchemaVersion()).toBe(0);
    mockRpcResult("get_schema_version", { data: null, error: { code: "42883", message: "does not exist" } });
    expect(await getSchemaVersion()).toBe(0);
  });

  it("throws other errors", async () => {
    mockRpcResult("get_schema_version", { data: null, error: { message: "fetch failed" } });
    await expect(getSchemaVersion()).rejects.toMatchObject({ message: "fetch failed" });
  });
});
