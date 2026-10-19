/**
 * codeStats against a real git repo in a temp folder (skipped without git).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createCodeStats } from "../../src/tracking/codeStats";

const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

let root = "";
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" }).toString();
/** Commit with author and committer date `at` (ms). */
const commitAt = (at: number, message: string) => {
  const date = new Date(at).toISOString();
  execFileSync("git", ["commit", "-q", "-m", message], {
    cwd: root,
    stdio: "pipe",
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
};
const HOUR = 3600_000;
const write = (file: string, lines: number, prefix = "line") =>
  fs.writeFileSync(path.join(root, file), Array.from({ length: lines }, (_, i) => `${prefix} ${i}`).join("\n") + "\n");

/** git/fs work in flight, so a test can wait for the snapshot to finish */
let inFlight = 0;
function tracked<T>(work: Promise<T>): Promise<T> {
  inFlight++;
  return work.finally(() => inFlight--);
}
/** Wait until the snapshot noteRepo() started is done (a fixed delay is flaky under load). */
async function snapshotTaken() {
  for (let idle = 0; idle < 2; ) {
    await new Promise((r) => setTimeout(r, 25));
    idle = inFlight === 0 ? idle + 1 : 0;
  }
}

const stats = createCodeStats({
  git: (cwd, args) =>
    tracked(
      new Promise((resolve) =>
        execFile("git", args, { cwd }, (err, stdout) => resolve(err ? null : stdout)),
      ),
    ),
  mtimeMs: (r, f) =>
    tracked(
      (async () => {
        try {
          return fs.statSync(path.join(r, f)).mtimeMs;
        } catch {
          return null;
        }
      })(),
    ),
  countLines: (r, f) =>
    tracked(
      (async () => {
        const text = fs.readFileSync(path.join(r, f), "utf8");
        return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
      })(),
    ),
  languageOf: (f) => (f.endsWith(".ts") ? "TypeScript" : f.endsWith(".md") ? "Markdown" : null),
});

describe.skipIf(!hasGit)("codeStats with real git", () => {
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "dtt-codestats-"));
    git("init", "-q");
    git("config", "user.email", "me@example.com");
    git("config", "user.name", "Me");
    git("config", "commit.gpgsign", "false");
    write("old.ts", 10);
    write("README.md", 3);
    git("add", ".");
    commitAt(Date.now() - 2 * HOUR, "before the session");
    // uncommitted work from before the session
    fs.appendFileSync(path.join(root, "README.md"), "pre-session edit\n");
    const old = new Date(Date.now() - HOUR);
    fs.utimesSync(path.join(root, "README.md"), old, old);
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("counts the session's commits and its own uncommitted changes only", async () => {
    const start = Date.now() - 20 * 60_000;
    const repo = { key: "path:test", name: "test", root };
    stats.startSession();
    stats.noteRepo(repo);
    await snapshotTaken();

    // a commit during the session: 5 new lines, 2 changed
    const lines = fs.readFileSync(path.join(root, "old.ts"), "utf8").split("\n");
    lines[0] = "changed 0";
    lines[1] = "changed 1";
    fs.writeFileSync(path.join(root, "old.ts"), lines.join("\n"));
    fs.appendFileSync(path.join(root, "old.ts"), "a\nb\nc\nd\ne\n");
    git("add", "old.ts");
    commitAt(Date.now() - 10 * 60_000, "during the session");
    // and new work left uncommitted: a new file
    write("new.ts", 4);
    git("add", "-N", "new.ts");

    const result = await stats.finish(start, Date.now() + 1000);
    expect(result).toHaveLength(1);
    const s = result[0];
    expect(s.commits).toBe(1);
    // HEAD moved, so uncommitted files count only if modified during the
    // session: new.ts yes; README.md's pre-session edit no
    expect(s.files_changed).toBe(2);
    expect(s.lines_added).toBe(7 + 4);
    expect(s.lines_removed).toBe(2);
    expect(s.languages).toEqual({ TypeScript: { added: 11, removed: 2 } });
  });

  it("with HEAD unchanged, only the growth since the snapshot counts", async () => {
    const start = Date.now() - 1000;
    const repo = { key: "path:test", name: "test", root };
    stats.startSession();
    stats.noteRepo(repo);
    await snapshotTaken();
    write("new.ts", 6); // was 4 lines
    write("untracked.md", 2);
    const [s] = await stats.finish(start, Date.now() + 1000);
    expect(s).toMatchObject({ commits: 0, files_changed: 2, lines_added: 2 + 2 });
  });
});
