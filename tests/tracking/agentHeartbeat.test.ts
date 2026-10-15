import { describe, it, expect, vi } from "vitest";
import * as nodePath from "path";
import {
  createAgentHeartbeat,
  type HeartbeatFs,
} from "../../src/tracking/agentHeartbeat";

const P = nodePath.posix;
const CLAUDE = "/home/me/.claude";
const CODEX = "/home/me/.codex";
const NOW = new Date(2026, 9, 15, 12, 0, 0).getTime();
const MIN = 60_000;

/** files: path → mtime (ms). Folders are implied by the paths. */
function fakeFs(files: Map<string, number>) {
  const fs: HeartbeatFs & { mtimeMs: ReturnType<typeof vi.fn> } = {
    readDir: async (dir) => {
      const out = new Map<string, boolean>();
      for (const f of files.keys()) {
        if (!f.startsWith(dir + "/")) continue;
        const [first, ...rest] = f.slice(dir.length + 1).split("/");
        out.set(first, rest.length > 0 || out.get(first) === true);
      }
      return [...out].map(([name, isDir]) => ({ name, isDir }));
    },
    mtimeMs: vi.fn(async (p: string) => files.get(p) ?? null),
  };
  return fs;
}

function setup(files: Map<string, number>, now = () => NOW) {
  const fs = fakeFs(files);
  const hb = createAgentHeartbeat({ fs, claudeDir: CLAUDE, codexDir: CODEX, platform: "linux", now });
  return { fs, hb };
}

const claude = (project: string, file: string) => P.join(CLAUDE, "projects", project, file);

describe("agentHeartbeat", () => {
  it("returns null without any transcripts", async () => {
    const { hb } = setup(new Map());
    expect(await hb.poll()).toBeNull();
    expect(hb.lastActivity()).toBeNull();
  });

  it("finds the latest write across Claude Code projects", async () => {
    const { hb } = setup(
      new Map([
        [claude("c--repo-a", "s1.jsonl"), NOW - 30 * MIN],
        [claude("c--repo-b", "s2.jsonl"), NOW - 2 * MIN],
        [claude("c--repo-b", "notes.txt"), NOW],
      ]),
    );
    expect(await hb.poll()).toBe(NOW - 2 * MIN);
  });

  it("sees subagent transcripts of active sessions", async () => {
    const { hb } = setup(
      new Map([
        [claude("p", "s1.jsonl"), NOW - 20 * MIN],
        [claude("p", "s1/subagents/agent-1.jsonl"), NOW - 1 * MIN],
        [claude("p", "s1/tool-results/x.txt"), NOW],
      ]),
    );
    expect(await hb.poll()).toBe(NOW - 1 * MIN);
  });

  it("reads today's and yesterday's Codex sessions", async () => {
    const day = (d: Date) =>
      `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
    const today = new Date(NOW);
    const { hb } = setup(
      new Map([[P.join(CODEX, "sessions", day(today), "rollout-1.jsonl"), NOW - 3 * MIN]]),
    );
    expect(await hb.poll()).toBe(NOW - 3 * MIN);
  });

  it("between full scans only re-stats hot and new files", async () => {
    let t = NOW;
    const files = new Map([
      [claude("p", "old.jsonl"), NOW - 5 * 86_400_000],
      [claude("p", "hot.jsonl"), NOW - 5 * MIN],
    ]);
    const { fs, hb } = setup(files, () => t);
    await hb.poll(); // full scan
    fs.mtimeMs.mockClear();

    t += 15_000;
    files.set(claude("p", "hot.jsonl"), t);
    files.set(claude("p", "new.jsonl"), t - 1000);
    expect(await hb.poll()).toBe(t);
    const statted = fs.mtimeMs.mock.calls.map((c) => P.basename(c[0] as string));
    expect(statted.sort()).toEqual(["hot.jsonl", "new.jsonl"]);
  });

  it("an old session that is resumed is noticed by the next full scan", async () => {
    let t = NOW;
    const files = new Map([[claude("p", "old.jsonl"), NOW - 3 * 86_400_000]]);
    const { hb } = setup(files, () => t);
    await hb.poll();
    files.set(claude("p", "old.jsonl"), NOW + 1000);
    t += 15_000;
    expect(await hb.poll()).toBe(NOW - 3 * 86_400_000);
    t += 5 * MIN;
    expect(await hb.poll()).toBe(NOW + 1000);
  });

  it("ignores mtimes far in the future and never runs two scans at once", async () => {
    const { fs, hb } = setup(new Map([[claude("p", "s.jsonl"), NOW + 3600_000]]));
    const [a, b] = await Promise.all([hb.poll(), hb.poll()]);
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(fs.mtimeMs).toHaveBeenCalledTimes(1);
  });
});
