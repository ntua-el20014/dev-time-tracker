import { describe, it, expect, vi } from "vitest";
import {
  createAgentIngest,
  type IngestDeps,
  type IngestState,
  type TranscriptFile,
} from "../../src/tracking/agentIngest";

const NOW = Date.UTC(2026, 9, 15, 12);
const at = (min: number) => new Date(Date.UTC(2026, 9, 15, 10, min)).toISOString();
const prompt = (min: number, cwd = "/code/shop") =>
  JSON.stringify({ type: "user", timestamp: at(min), cwd, origin: { kind: "human" }, message: { content: "x" } }) + "\n";
const PATH = "/home/me/.claude/projects/p/5e55-1d.jsonl";

function setup(files: Record<string, string>, overrides: Partial<IngestDeps> = {}) {
  const contents = new Map(Object.entries(files).map(([k, v]) => [k, Buffer.from(v)]));
  const mtimes = new Map<string, number>(Object.keys(files).map((k) => [k, NOW - 1000]));
  let saved: IngestState | null = null;
  const upload = vi.fn(async () => {});
  const deps: IngestDeps = {
    listTranscripts: async () =>
      [...contents.keys()].map(
        (path): TranscriptFile => ({ path, source: path.includes(".codex") ? "codex" : "claude-code", mtimeMs: mtimes.get(path)! }),
      ),
    size: async (p) => contents.get(p)?.length ?? null,
    read: async (p, offset, length) => contents.get(p)?.subarray(offset, offset + length) ?? null,
    loadState: async () => saved,
    saveState: async (s) => {
      saved = JSON.parse(JSON.stringify(s));
    },
    repoForDir: (dir) => (dir === "/code/shop" ? { key: "github.com/acme/shop", name: "shop" } : null),
    projectFor: (key) => (key === "github.com/acme/shop" ? "p-shop" : null),
    upload,
    languageOf: () => null,
    now: () => NOW,
    ...overrides,
  };
  const append = (path: string, text: string) => {
    contents.set(path, Buffer.concat([contents.get(path) ?? Buffer.alloc(0), Buffer.from(text)]));
    mtimes.set(path, (mtimes.get(path) ?? NOW) + 1000);
  };
  const replace = (path: string, text: string) => {
    contents.set(path, Buffer.from(text));
    mtimes.set(path, (mtimes.get(path) ?? NOW) + 1000);
  };
  return { deps, upload, append, replace, saved: () => saved };
}

describe("agentIngest", () => {
  it("uploads one row per session with repo and project, keyed by file name", async () => {
    const { deps, upload } = setup({ [PATH]: prompt(0) + prompt(2) });
    const result = await createAgentIngest(deps).run();
    expect(result).toMatchObject({ uploaded: 1, pending: 0, error: null });
    expect(upload).toHaveBeenCalledWith([
      expect.objectContaining({
        source: "claude-code",
        external_id: "5e55-1d",
        repo_key: "github.com/acme/shop",
        repo_name: "shop",
        project_id: "p-shop",
        started_at: at(0),
        ended_at: at(2),
        active_seconds: 120,
        prompts: 2,
      }),
    ]);
    const row = (upload.mock.calls[0] as any)[0][0];
    expect(JSON.stringify(row)).not.toContain("/code/shop");
  });

  it("reads only new complete lines, and skips unchanged files", async () => {
    const { deps, upload, append } = setup({ [PATH]: prompt(0) });
    const ingest = createAgentIngest(deps);
    await ingest.run();
    // A half-written line isn't consumed yet
    append(PATH, prompt(1).slice(0, 20));
    expect((await ingest.run()).uploaded).toBe(0);
    append(PATH, prompt(1).slice(20));
    await ingest.run();
    expect((upload.mock.calls.at(-1) as any)[0][0].prompts).toBe(2);
    upload.mockClear();
    expect((await ingest.run()).read).toBe(0);
    expect(upload).not.toHaveBeenCalled();
  });

  it("continues from the saved state after a restart", async () => {
    const env = setup({ [PATH]: prompt(0) });
    await createAgentIngest(env.deps).run();
    env.append(PATH, prompt(3));
    const restarted = createAgentIngest(env.deps);
    const result = await restarted.run();
    expect(result.read).toBe(prompt(3).length);
    expect((env.upload.mock.calls.at(-1) as any)[0][0].prompts).toBe(2);
  });

  it("starts over when a file is rewritten shorter", async () => {
    const env = setup({ [PATH]: prompt(0) + prompt(1) + prompt(2) });
    const ingest = createAgentIngest(env.deps);
    await ingest.run();
    env.replace(PATH, prompt(5));
    await ingest.run();
    expect((env.upload.mock.calls.at(-1) as any)[0][0]).toMatchObject({ prompts: 1, started_at: at(5) });
  });

  it("keeps rows that failed to upload and retries them", async () => {
    const env = setup({ [PATH]: prompt(0) });
    env.upload.mockRejectedValueOnce(new Error("offline"));
    const ingest = createAgentIngest(env.deps);
    const first = await ingest.run();
    expect(first).toMatchObject({ uploaded: 0, pending: 1 });
    expect(first.error).toBeTruthy();
    const second = await ingest.run();
    expect(second).toMatchObject({ uploaded: 1, pending: 0, read: 0 });
  });

  it("re-uploads everything after markAllDirty (e.g. new repo links)", async () => {
    const env = setup({ [PATH]: prompt(0), "/home/me/.codex/sessions/2026/10/15/rollout-1.jsonl": JSON.stringify({ type: "session_meta", timestamp: at(0), payload: { id: "cx-9", cwd: "/elsewhere" } }) + "\n" });
    const ingest = createAgentIngest(env.deps);
    await ingest.run();
    env.upload.mockClear();
    await ingest.markAllDirty();
    await ingest.run();
    const rows = (env.upload.mock.calls[0] as any)[0];
    expect(rows.map((r: any) => r.external_id).sort()).toEqual(["5e55-1d", "cx-9"]);
    expect(rows.find((r: any) => r.external_id === "cx-9")).toMatchObject({ source: "codex", repo_key: null, project_id: null });
  });

  it("ignores transcripts older than 30 days and sessions without timestamps", async () => {
    const env = setup({ [PATH]: JSON.stringify({ type: "user", message: { content: "x" } }) + "\n" });
    const old = { path: "/old.jsonl", source: "claude-code" as const, mtimeMs: NOW - 40 * 86_400_000 };
    const list = env.deps.listTranscripts;
    env.deps.listTranscripts = async () => [...(await list()), old];
    const result = await createAgentIngest(env.deps).run();
    expect(result).toMatchObject({ uploaded: 0, pending: 0 });
    expect(env.saved()?.files["/old.jsonl"]).toBeUndefined();
  });

  it("spreads a large history over several cycles", async () => {
    const big = Array.from({ length: 2000 }, (_, i) => prompt(i % 60)).join("");
    const env = setup({ [PATH]: big }, { maxBytesPerCycle: 64 * 1024 });
    const ingest = createAgentIngest(env.deps);
    const first = await ingest.run();
    expect(first.read).toBeLessThan(big.length);
    let total = first.read;
    for (let i = 0; i < 5 && total < big.length; i++) total += (await ingest.run()).read;
    expect(total).toBe(big.length);
    expect((env.upload.mock.calls.at(-1) as any)[0][0].prompts).toBe(2000);
  });
});
