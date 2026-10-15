import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const handlers: Record<string, Function> = {};
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      handlers[channel] = handler;
    }),
  },
}));

const getCurrentUser = vi.fn();
vi.mock("../../src/supabase/api", () => ({
  getCurrentUser: () => getCurrentUser(),
}));

const db = { getAgentSessions: vi.fn() };
vi.mock("../../src/supabase/agentSessions", () => db);

const agents = {
  deleteAgentData: vi.fn(),
  getAgentIntegrationStatus: vi.fn(),
  runAgentIngest: vi.fn(),
  setAgentIngestEnabled: vi.fn(),
};
vi.mock("../../src/tracking/agents", () => agents);

beforeAll(async () => {
  await import("../../src/ipc/agentHandlers");
});

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "u1" });
  agents.getAgentIntegrationStatus.mockResolvedValue({ enabled: true });
});

describe("agent handlers", () => {
  it("reports the signed-in user's status", async () => {
    expect(await handlers["get-agent-integration"]({})).toEqual({ enabled: true });
    expect(agents.getAgentIntegrationStatus).toHaveBeenCalledWith("u1");
  });

  it("only accepts a boolean to turn recording on or off", async () => {
    expect(await handlers["set-agent-integration"]({}, "yes")).toBeNull();
    expect(agents.setAgentIngestEnabled).not.toHaveBeenCalled();
    await handlers["set-agent-integration"]({}, false);
    expect(agents.setAgentIngestEnabled).toHaveBeenCalledWith("u1", false);
  });

  it("lists sessions only for valid local dates", async () => {
    db.getAgentSessions.mockResolvedValue([{ id: "a" }]);
    expect(await handlers["get-agent-sessions"]({}, { startDate: "2026-10-01", endDate: "2026-10-15" })).toEqual([{ id: "a" }]);
    expect(db.getAgentSessions).toHaveBeenCalledWith("u1", "2026-10-01", "2026-10-15");
    expect(await handlers["get-agent-sessions"]({}, { startDate: "x", endDate: "2026-10-15" })).toEqual([]);
    expect(await handlers["get-agent-sessions"]({}, null)).toEqual([]);
  });

  it("deletes the signed-in user's data, and fails safely when signed out", async () => {
    expect(await handlers["delete-agent-data"]({})).toBe(true);
    expect(agents.deleteAgentData).toHaveBeenCalledWith("u1");
    getCurrentUser.mockResolvedValue(null);
    expect(await handlers["delete-agent-data"]({})).toBe(false);
    expect(await handlers["get-agent-integration"]({})).toBeNull();
  });
});
