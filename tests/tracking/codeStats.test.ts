import { describe, expect, it } from "vitest";
import {
  createCodeStats,
  isLockFile,
  parseLogZ,
  parseNumstatZ,
  type CodeStatsDeps,
} from "../../src/tracking/codeStats";

const T0 = Date.parse("2026-10-15T10:00:00Z");
const MIN = 60_000;
const START = T0;
const END = T0 + 60 * MIN;

const REPO = { key: "github.com/me/app", name: "app", root: "/src/app" };
const WORKTREE = { key: "github.com/me/app", name: "app", root: "/src/app/.claude/worktrees/x" };

const languageOf = (f: string) =>
  f.endsWith(".ts") ? "TypeScript" : f.endsWith(".py") ? "Python" : f.endsWith(".md") ? "Markdown" : null;

const numstat = (entries: [string | number, string | number, string][]) =>
  entries.map(([a, r, p]) => `${a}\t${r}\t${p}\0`).join("");

const commit = (hash: string, at: number, email: string, files: [number | string, number | string, string][]) =>
  `\x1e${hash}\x1f${new Date(at).toISOString()}\x1f${email}\0\n${numstat(files)}`;

/** A fake working tree per root; `diff`/`untracked` can change between calls. */
interface FakeTree {
  head: string | null;
  email?: string;
  diff: [number | string, number | string, string][];
  untracked: string[];
  log: string;
  mtimes: Record<string, number>;
  lines: Record<string, number | null>;
}

function deps(trees: Record<string, FakeTree>): CodeStatsDeps {
  return {
    async git(cwd, args) {
      const t = trees[cwd];
      if (!t) return null;
      const cmd = args.find((a) => !a.startsWith("-") && !a.includes("=")) ?? "";
      if (args[0] === "rev-parse") return t.head ? `${t.head}\n` : null;
      if (args[0] === "config") return t.email ? `${t.email}\n` : null;
      if (args[0] === "ls-files") return t.untracked.map((f) => `${f}\0`).join("");
      if (args.includes("diff")) return numstat(t.diff);
      if (args.includes("log")) return t.log;
      throw new Error(`unexpected git ${cmd}`);
    },
    async mtimeMs(root, file) {
      return trees[root]?.mtimes[file] ?? null;
    },
    async countLines(root, file) {
      const n = trees[root]?.lines[file];
      return n === undefined ? 0 : n;
    },
    languageOf,
  };
}

const tree = (over: Partial<FakeTree> = {}): FakeTree => ({
  head: "aaaaaaa",
  email: "me@example.com",
  diff: [],
  untracked: [],
  log: "",
  mtimes: {},
  lines: {},
  ...over,
});

describe("git output parsing", () => {
  it("parses numstat with binary files and odd paths", () => {
    expect(parseNumstatZ(numstat([[3, 1, "src/a b.ts"], ["-", "-", "img.png"], [0, 4, "dir/ü.md"]]))).toEqual([
      { path: "src/a b.ts", added: 3, removed: 1 },
      { path: "img.png", added: null, removed: null },
      { path: "dir/ü.md", added: 0, removed: 4 },
    ]);
    expect(parseNumstatZ("")).toEqual([]);
  });

  it("parses the log format, one record per commit", () => {
    const out =
      commit("1111111", T0, "Me@Example.com", [[2, 0, "a.ts"]]) + commit("2222222", T0 + MIN, "x@y", []);
    expect(parseLogZ(out)).toEqual([
      { hash: "1111111", authorDate: T0, email: "me@example.com", files: [{ path: "a.ts", added: 2, removed: 0 }] },
      { hash: "2222222", authorDate: T0 + MIN, email: "x@y", files: [] },
    ]);
  });

  it("knows lock files", () => {
    expect(isLockFile("web/package-lock.json")).toBe(true);
    expect(isLockFile("Cargo.lock")).toBe(true);
    expect(isLockFile("src/lock.ts")).toBe(false);
  });
});

describe("codeStats", () => {
  it("counts the session's own commits, by the repo's user, within the session", async () => {
    const t = tree({
      log:
        commit("1111111", T0 + 5 * MIN, "me@example.com", [[10, 2, "src/a.ts"], [5, 0, "package-lock.json"]]) +
        commit("2222222", T0 + 6 * MIN, "teammate@example.com", [[100, 0, "src/b.ts"]]) +
        // authored before the session (e.g. rebased now): not this session's work
        commit("3333333", T0 - 30 * MIN, "me@example.com", [[50, 0, "src/c.ts"]]),
    });
    const stats = createCodeStats(deps({ [REPO.root]: t }));
    stats.startSession();
    stats.noteRepo(REPO);
    expect(await stats.finish(START, END)).toEqual([
      {
        repo_key: REPO.key,
        repo_name: "app",
        commits: 1,
        files_changed: 2, // the lock file is a changed file, but its lines don't count
        lines_added: 10,
        lines_removed: 2,
        languages: { TypeScript: { added: 10, removed: 2 } },
      },
    ]);
  });

  it("counts only the growth of uncommitted changes since the repo was first seen", async () => {
    const t = tree({ diff: [[40, 5, "src/old.ts"]], untracked: ["notes.md"] });
    const stats = createCodeStats(deps({ [REPO.root]: t }));
    stats.startSession();
    stats.noteRepo(REPO);
    await Promise.resolve();
    // during the session: old.ts grows, a new file appears, notes.md was already there
    await new Promise((r) => setTimeout(r, 0));
    t.diff = [[45, 5, "src/old.ts"], [7, 0, "src/new.py"]];
    t.untracked = ["notes.md", "src/fresh.ts"];
    t.lines["src/fresh.ts"] = 12;
    const [s] = await stats.finish(START, END);
    expect(s).toMatchObject({ commits: 0, files_changed: 3, lines_added: 5 + 7 + 12, lines_removed: 0 });
    expect(s.languages).toEqual({
      TypeScript: { added: 17, removed: 0 },
      Python: { added: 7, removed: 0 },
    });
  });

  it("without a usable snapshot, counts files modified during the session", async () => {
    const t = tree({
      diff: [[30, 3, "src/touched.ts"], [99, 99, "src/stale.ts"], ["-", "-", "logo.png"]],
      untracked: ["src/new.ts", "old-untracked.ts"],
      mtimes: { "src/touched.ts": T0 + MIN, "src/stale.ts": T0 - MIN, "logo.png": T0 + 2 * MIN, "src/new.ts": T0 + 3 * MIN, "old-untracked.ts": T0 - 9 * MIN },
      lines: { "src/new.ts": 8 },
    });
    const stats = createCodeStats(deps({ [REPO.root]: t }));
    stats.startSession();
    // not noted: only known at the end (e.g. an agent worked there)
    const [s] = await stats.finish(START, END, [REPO]);
    expect(s).toMatchObject({ files_changed: 3, lines_added: 38, lines_removed: 3 });
  });

  it("when HEAD moved, falls back to modification times for uncommitted work", async () => {
    const t = tree({ diff: [[10, 0, "a.ts"]], mtimes: { "a.ts": T0 - MIN } });
    const stats = createCodeStats(deps({ [REPO.root]: t }));
    stats.startSession();
    stats.noteRepo(REPO);
    await new Promise((r) => setTimeout(r, 0));
    t.head = "bbbbbbb";
    t.diff = [[10, 0, "a.ts"], [4, 1, "b.ts"]];
    t.mtimes["b.ts"] = T0 + 10 * MIN;
    t.log = commit("bbbbbbb", T0 + 9 * MIN, "me@example.com", [[20, 0, "c.ts"]]);
    const [s] = await stats.finish(START, END);
    expect(s).toMatchObject({ commits: 1, files_changed: 2, lines_added: 24, lines_removed: 1 });
  });

  it("counts a commit seen from two worktrees of the same repo once", async () => {
    const log = commit("1111111", T0 + MIN, "me@example.com", [[3, 0, "x.ts"]]);
    const stats = createCodeStats(deps({ [REPO.root]: tree({ log }), [WORKTREE.root]: tree({ log }) }));
    stats.startSession();
    stats.noteRepo(REPO);
    const result = await stats.finish(START, END, [WORKTREE]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ commits: 1, lines_added: 3 });
  });

  it("leaves out repos with nothing to show, and repos git can't read", async () => {
    const stats = createCodeStats(deps({ [REPO.root]: tree() }));
    stats.startSession();
    stats.noteRepo(REPO);
    stats.noteRepo({ key: "path:/gone", name: "gone", root: "/gone" });
    expect(await stats.finish(START, END)).toEqual([]);
  });

  it("counts every author's commits when the repo has no user.email", async () => {
    const t = tree({ email: undefined, log: commit("1111111", T0 + MIN, "someone@x", [[1, 1, "a.ts"]]) });
    const stats = createCodeStats(deps({ [REPO.root]: t }));
    stats.startSession();
    expect((await stats.finish(START, END, [REPO]))[0]).toMatchObject({ commits: 1 });
  });

  it("starts each session fresh", async () => {
    const t = tree({ diff: [[5, 0, "a.ts"]], mtimes: { "a.ts": T0 + MIN } });
    const stats = createCodeStats(deps({ [REPO.root]: t }));
    stats.startSession();
    stats.noteRepo(REPO);
    await stats.finish(START, END);
    stats.startSession();
    // the repo wasn't noted again, so it's not included
    expect(await stats.finish(END, END + MIN)).toEqual([]);
  });
});
