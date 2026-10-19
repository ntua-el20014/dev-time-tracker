import { describe, it, expect, vi, beforeEach } from "vitest";

const getSchemaVersion = vi.fn();
vi.mock("../../src/supabase/schemaVersion", () => ({
  REQUIRED_SCHEMA_VERSION: 2,
  getSchemaVersion: () => getSchemaVersion(),
}));
const reportError = vi.fn();
vi.mock("../../src/sentryMain", () => ({ reportError: (...a: unknown[]) => reportError(...a) }));
const logError = vi.fn();
vi.mock("../../src/utils/errorHandler", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/utils/errorHandler")>()),
  logError: (...a: unknown[]) => logError(...a),
}));

import { checkDatabaseVersion } from "../../src/utils/schemaCheck";

describe("checkDatabaseVersion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says nothing when the database is up to date (or ahead)", async () => {
    const notify = vi.fn();
    for (const version of [2, 3]) {
      getSchemaVersion.mockResolvedValueOnce(version);
      expect(await checkDatabaseVersion(notify)).toBeNull();
    }
    expect(notify).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("warns, logs and reports when the database is behind", async () => {
    const notify = vi.fn();
    getSchemaVersion.mockResolvedValueOnce(0);
    expect(await checkDatabaseVersion(notify)).toEqual({ version: 0, required: 2 });
    expect(notify).toHaveBeenCalledWith({ version: 0, required: 2 });
    expect(logError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("stays quiet offline (the next sign-in checks again)", async () => {
    const notify = vi.fn();
    getSchemaVersion.mockRejectedValueOnce(new Error("fetch failed"));
    expect(await checkDatabaseVersion(notify)).toBeNull();
    expect(notify).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it("logs other errors without warning about the database", async () => {
    const notify = vi.fn();
    getSchemaVersion.mockRejectedValueOnce(new Error("permission denied"));
    expect(await checkDatabaseVersion(notify)).toBeNull();
    expect(notify).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledTimes(1);
  });
});
