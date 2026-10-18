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
  it("keeps browser categories apart in the summary (C5)", async () => {
    const { batcher, writer } = setup();
    const chrome = { appName: "Chrome", language: null, languageExtension: null };
    batcher.add(record({ ...chrome, category: "code-review" }));
    batcher.add(record({ ...chrome, category: "code-review" }));
    batcher.add(record({ ...chrome, category: "docs" }));
    batcher.add(record({ ...chrome, category: null }));
    await batcher.flush();

    const increments = writer.addToSummary.mock.calls.map((c) => c[0]);
    expect(increments).toHaveLength(3);
    expect(increments).toContainEqual(expect.objectContaining({ category: "code-review", seconds: 20 }));
    expect(increments).toContainEqual(expect.objectContaining({ category: "docs", seconds: 10 }));
    expect(increments).toContainEqual(expect.objectContaining({ category: null, seconds: 10 }));
  });

  it("writes only summary increments, never per-tick rows or titles", async () => {
    const { batcher, writer } = setup();
    batcher.add({ ...record(), windowTitle: "secret.ts — client" } as UsageRecord);
    batcher.add(record());

    expect(await batcher.flush()).toBe(2);
    expect(writer.addToSummary).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(writer.addToSummary.mock.calls)).not.toContain("secret");
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

  it("queues the increments offline once a network error happens", async () => {
    const addToSummary = vi.fn(async () => {
      throw new Error("offline");
    });
    const { batcher, deps } = setup({ addToSummary });
    batcher.add(record());
    batcher.add(record());
    batcher.add(record({ appName: "Chrome", language: null }));

    expect(await batcher.flush()).toBe(3);
    // The rest of the flush isn't tried once the network is down
    expect(addToSummary).toHaveBeenCalledTimes(1);
    expect(deps.enqueueOffline).toHaveBeenCalledTimes(2);
    expect(deps.enqueueOffline.mock.calls[0][0]).toMatchObject({
      appName: "VS Code",
      seconds: 20,
      icon: "data:icon",
    });

    // The queued increment carried the icon, so it isn't sent again
    addToSummary.mockResolvedValue(undefined);
    batcher.add(record());
    await batcher.flush();
    expect(addToSummary.mock.calls.at(-1)?.[0].icon).toBeNull();
  });

  it("logs and drops records on non-network errors", async () => {
    const { batcher, deps } = setup({
      addToSummary: vi.fn(async () => {
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
    const addToSummary = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
      .mockResolvedValue(undefined);
    const { batcher } = setup({ addToSummary });

    batcher.add(record());
    const first = batcher.flush();
    batcher.add(record({ appName: "Chrome" }));
    const second = batcher.flush();
    release();

    expect(await first).toBe(1);
    expect(await second).toBe(1);
    expect(addToSummary).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the buffer is empty", async () => {
    const { batcher, writer } = setup();
    expect(await batcher.flush()).toBe(0);
    expect(writer.addToSummary).not.toHaveBeenCalled();
  });
});
