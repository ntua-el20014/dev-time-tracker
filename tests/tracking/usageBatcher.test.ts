import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import {
  UsageBatcher,
  type UsageRecord,
  type BatcherDeps,
} from "../../src/tracking/usageBatcher";

// Pin a timezone so local-day grouping is deterministic (UTC+3 in October)
const originalTZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Europe/Athens";
});
afterAll(() => {
  process.env.TZ = originalTZ;
});

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    userId: "u1",
    appName: "VS Code",
    windowTitle: "main.ts",
    language: "TypeScript",
    languageExtension: ".ts",
    icon: "data:icon",
    intervalSeconds: 10,
    timestamp: "2026-10-14T09:00:00.000Z",
    ...overrides,
  };
}

function setup(overrides: Partial<BatcherDeps["writer"]> = {}) {
  const writer = {
    insertLogs: vi.fn(async () => {}),
    addToSummary: vi.fn(async () => {}),
    ...overrides,
  };
  const deps = {
    writer,
    isNetworkError: (err: unknown) => (err as Error).message === "offline",
    enqueueOffline: vi.fn(),
    logError: vi.fn(),
  };
  return { batcher: new UsageBatcher(deps), deps, writer };
}

describe("UsageBatcher", () => {
  it("writes all buffered logs in one insert", async () => {
    const { batcher, writer } = setup();
    batcher.add(record());
    batcher.add(record({ windowTitle: "other.ts" }));

    expect(await batcher.flush()).toBe(2);
    expect(writer.insertLogs).toHaveBeenCalledTimes(1);
    expect(writer.insertLogs.mock.calls[0][0]).toHaveLength(2);
    expect(batcher.pendingCount).toBe(0);
  });

  it("aggregates one summary upsert per local day/app/language", async () => {
    const { batcher, writer } = setup();
    batcher.add(record());
    batcher.add(record());
    batcher.add(record({ appName: "Chrome", language: null, languageExtension: null }));
    // 22:30 UTC on Oct 14 is already Oct 15 in Athens
    batcher.add(record({ timestamp: "2026-10-14T22:30:00.000Z" }));
    await batcher.flush();

    const increments = writer.addToSummary.mock.calls.map((c) => c[0]);
    expect(increments).toHaveLength(3);
    expect(increments).toContainEqual(
      expect.objectContaining({ appName: "VS Code", date: "2026-10-14", seconds: 20 }),
    );
    expect(increments).toContainEqual(
      expect.objectContaining({ appName: "Chrome", language: null, seconds: 10 }),
    );
    expect(increments).toContainEqual(
      expect.objectContaining({ appName: "VS Code", date: "2026-10-15", seconds: 10 }),
    );
  });

  it("sends each summary row's icon only once", async () => {
    const { batcher, writer } = setup();
    batcher.add(record());
    await batcher.flush();
    batcher.add(record());
    await batcher.flush();

    expect(writer.addToSummary.mock.calls[0][0].icon).toBe("data:icon");
    expect(writer.addToSummary.mock.calls[1][0].icon).toBeNull();
  });

  it("queues every record offline when the insert hits a network error", async () => {
    const { batcher, deps, writer } = setup({
      insertLogs: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    batcher.add(record());
    batcher.add(record());

    expect(await batcher.flush()).toBe(2);
    expect(deps.enqueueOffline).toHaveBeenCalledTimes(2);
    // icon goes with the first queued record of the row only
    expect(deps.enqueueOffline.mock.calls[0][1]).toBe("data:icon");
    expect(deps.enqueueOffline.mock.calls[1][1]).toBeNull();
    expect(writer.addToSummary).not.toHaveBeenCalled();
  });

  it("logs and drops records on non-network insert errors", async () => {
    const { batcher, deps } = setup({
      insertLogs: vi.fn(async () => {
        throw new Error("constraint violation");
      }),
    });
    batcher.add(record());

    expect(await batcher.flush()).toBe(0);
    expect(deps.enqueueOffline).not.toHaveBeenCalled();
    expect(deps.logError).toHaveBeenCalled();
  });

  it("keeps going when one summary upsert fails", async () => {
    const addToSummary = vi
      .fn()
      .mockRejectedValueOnce(new Error("rpc failed"))
      .mockResolvedValue(undefined);
    const { batcher, deps } = setup({ addToSummary });
    batcher.add(record());
    batcher.add(record({ appName: "Chrome", language: null }));
    await batcher.flush();

    expect(addToSummary).toHaveBeenCalledTimes(2);
    expect(deps.logError).toHaveBeenCalledTimes(1);
  });

  it("serialises concurrent flushes without losing records", async () => {
    let release: () => void = () => {};
    const insertLogs = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
      .mockResolvedValue(undefined);
    const { batcher } = setup({ insertLogs });

    batcher.add(record());
    const first = batcher.flush();
    batcher.add(record({ windowTitle: "later.ts" }));
    const second = batcher.flush();
    release();

    expect(await first).toBe(1);
    expect(await second).toBe(1);
    expect(insertLogs).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the buffer is empty", async () => {
    const { batcher, writer } = setup();
    expect(await batcher.flush()).toBe(0);
    expect(writer.insertLogs).not.toHaveBeenCalled();
  });
});
