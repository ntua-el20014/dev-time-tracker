/**
 * C2: what a session produced, from git. For each repo touched during the
 * session (focused editor/terminal, or an AI agent working in it):
 *
 * - commits authored during the session (by the repo's user.email, if
 *   set), with their numstat; commits seen from several worktrees of the
 *   same repo are counted once;
 * - uncommitted changes at Stop. If a snapshot was taken when the repo was
 *   first seen in the session and HEAD hasn't moved since, only the growth
 *   since then counts; otherwise only files modified during the session.
 *   New untracked files count as added lines.
 *
 * Lock files and binary files are left out of the line counts. Only counts
 * and language names leave this module — never paths.
 *
 * git is run through an injected runner (src/tracking/tracker.ts uses
 * execFile with a timeout), so everything here runs in tests.
 */
import type { LineCounts, RepoCodeStats } from "../../shared/codeStats";
import type { RepoInfo } from "./repoResolver";

export interface CodeStatsDeps {
  /** Run git in `cwd`; stdout, or null if git failed or is missing */
  git(cwd: string, args: string[]): Promise<string | null>;
  /** Modification time (ms) of a file under a repo root, or null */
  mtimeMs(root: string, file: string): Promise<number | null>;
  /** Lines of a new (untracked) text file, or null for binary/too big */
  countLines(root: string, file: string): Promise<number | null>;
  languageOf(file: string): string | null;
  now?: () => number;
}

/** Files not worth counting lines of. */
const LOCK_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "cargo.lock",
  "poetry.lock",
  "pipfile.lock",
  "uv.lock",
  "gemfile.lock",
  "composer.lock",
  "go.sum",
  "packages.lock.json",
]);
/** Untracked files beyond this many aren't counted (e.g. a missing .gitignore). */
const MAX_UNTRACKED = 200;

export const isLockFile = (file: string) =>
  LOCK_FILES.has(file.split(/[\\/]/).pop()?.toLowerCase() ?? "");

export interface NumstatEntry {
  path: string;
  /** null for binary files */
  added: number | null;
  removed: number | null;
}

/** `git … --numstat -z --no-renames` entries: "added\tremoved\tpath\0". */
export function parseNumstatZ(out: string): NumstatEntry[] {
  const entries: NumstatEntry[] = [];
  for (const raw of out.split("\0")) {
    const rec = raw.replace(/^\n+/, "");
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/s.exec(rec);
    if (!m) continue;
    entries.push({
      path: m[3],
      added: m[1] === "-" ? null : Number(m[1]),
      removed: m[2] === "-" ? null : Number(m[2]),
    });
  }
  return entries;
}

export interface CommitEntry {
  hash: string;
  authorDate: number;
  email: string;
  files: NumstatEntry[];
}

/** Format of the log we run: one record per commit, then its numstat. */
export const LOG_FORMAT = "%x1e%H%x1f%aI%x1f%ae";

export function parseLogZ(out: string): CommitEntry[] {
  const commits: CommitEntry[] = [];
  for (const chunk of out.split("\x1e")) {
    const headerEnd = chunk.indexOf("\0");
    const header = headerEnd < 0 ? chunk : chunk.slice(0, headerEnd);
    const [hash, date, email] = header.split("\x1f");
    if (!hash || !/^[0-9a-f]{7,64}$/.test(hash.trim())) continue;
    const authorDate = Date.parse(date ?? "");
    if (Number.isNaN(authorDate)) continue;
    commits.push({
      hash: hash.trim(),
      authorDate,
      email: (email ?? "").trim().toLowerCase(),
      files: headerEnd < 0 ? [] : parseNumstatZ(chunk.slice(headerEnd + 1)),
    });
  }
  return commits;
}

/** Uncommitted state of a working tree: changes against HEAD, and untracked files. */
interface TreeState {
  head: string | null;
  at: number;
  /** path → numstat against HEAD (binary: null counts) */
  changed: Map<string, NumstatEntry>;
  untracked: string[];
}

class Totals {
  added = 0;
  removed = 0;
  files = new Set<string>();
  languages: Record<string, LineCounts> = {};

  add(file: string, added: number, removed: number, languageOf: (f: string) => string | null) {
    // A diff that shrank since the snapshot (work undone) counts as nothing
    added = Math.max(0, added);
    removed = Math.max(0, removed);
    if (added === 0 && removed === 0) return;
    this.files.add(file);
    if (isLockFile(file)) return;
    this.added += added;
    this.removed += removed;
    const lang = languageOf(file);
    if (lang) {
      const t = (this.languages[lang] ??= { added: 0, removed: 0 });
      t.added += added;
      t.removed += removed;
    }
  }
}

export function createCodeStats(deps: CodeStatsDeps) {
  const now = deps.now ?? Date.now;
  /** Snapshots taken this session, by repo root */
  let snapshots = new Map<string, Promise<TreeState | null>>();
  /** Repos noted this session, by root */
  let noted = new Map<string, RepoInfo>();

  async function treeState(root: string): Promise<TreeState | null> {
    const head = (await deps.git(root, ["rev-parse", "--verify", "-q", "HEAD"]))?.trim() || null;
    const diff = await deps.git(
      root,
      head
        ? ["-c", "core.quotepath=off", "diff", "HEAD", "--numstat", "-z", "--no-renames"]
        : ["-c", "core.quotepath=off", "diff", "--cached", "--numstat", "-z", "--no-renames"],
    );
    if (diff === null) return null; // not a repo (any more), or no git
    const untrackedOut = await deps.git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
    return {
      head,
      at: now(),
      changed: new Map(parseNumstatZ(diff).map((e) => [e.path, e])),
      untracked: (untrackedOut ?? "").split("\0").filter(Boolean),
    };
  }

  /** Commits in [start, end] by the repo's user (everyone's if user.email is unset). */
  async function commitsIn(root: string, start: number, end: number): Promise<CommitEntry[]> {
    const email = (await deps.git(root, ["config", "user.email"]))?.trim().toLowerCase() || null;
    const out = await deps.git(root, [
      "-c",
      "core.quotepath=off",
      "log",
      "--no-merges",
      "--no-renames",
      "-z",
      "--numstat",
      `--since=${new Date(start).toISOString()}`,
      `--format=${LOG_FORMAT}`,
    ]);
    return parseLogZ(out ?? "").filter(
      (c) => c.authorDate >= start - 1000 && c.authorDate <= end + 1000 && (!email || c.email === email),
    );
  }

  /** Uncommitted work done during the session in one working tree. */
  async function uncommitted(root: string, start: number, totals: Totals) {
    const [before, after] = [await snapshots.get(root), await treeState(root)];
    if (!after) return;
    const sameHead = before && before.head === after.head;
    for (const [file, e] of after.changed) {
      if (e.added === null || e.removed === null) {
        // binary: counts as a changed file if it changed during the session
        const was = before?.changed.get(file);
        if (sameHead ? !was : ((await deps.mtimeMs(root, file)) ?? 0) >= start) totals.files.add(file);
        continue;
      }
      if (sameHead) {
        const was = before.changed.get(file);
        totals.add(file, e.added - (was?.added ?? 0), e.removed - (was?.removed ?? 0), deps.languageOf);
      } else if (((await deps.mtimeMs(root, file)) ?? 0) >= start) {
        totals.add(file, e.added, e.removed, deps.languageOf);
      }
    }
    const known = new Set(sameHead ? before.untracked : []);
    for (const file of after.untracked.slice(0, MAX_UNTRACKED)) {
      if (known.has(file)) continue;
      if (!sameHead && ((await deps.mtimeMs(root, file)) ?? 0) < start) continue;
      const lines = await deps.countLines(root, file);
      if (lines === null) totals.files.add(file);
      else totals.add(file, lines, 0, deps.languageOf);
    }
  }

  return {
    /** A new session: forget the previous one's snapshots. */
    startSession() {
      snapshots = new Map();
      noted = new Map();
    },

    /** A repo is being worked in: snapshot it the first time this session. */
    noteRepo(repo: RepoInfo) {
      if (noted.has(repo.root)) return;
      noted.set(repo.root, repo);
      snapshots.set(repo.root, treeState(repo.root).catch(() => null));
    },

    /**
     * Stats for the session that ran from `start` to `end`, for the repos
     * noted and `extra` ones (e.g. where an agent worked). Ends the session.
     */
    async finish(start: number, end: number, extra: RepoInfo[] = []): Promise<RepoCodeStats[]> {
      const repos = new Map(noted);
      for (const r of extra) if (!repos.has(r.root)) repos.set(r.root, r);
      const byKey = new Map<string, { name: string; roots: string[] }>();
      for (const r of repos.values()) {
        const entry = byKey.get(r.key) ?? { name: r.name, roots: [] };
        entry.roots.push(r.root);
        byKey.set(r.key, entry);
      }

      const results: RepoCodeStats[] = [];
      for (const [key, { name, roots }] of byKey) {
        const totals = new Totals();
        const seen = new Set<string>();
        let commits = 0;
        for (const root of roots) {
          try {
            for (const c of await commitsIn(root, start, end)) {
              if (seen.has(c.hash)) continue;
              seen.add(c.hash);
              commits++;
              for (const f of c.files) {
                if (f.added === null || f.removed === null) totals.files.add(f.path);
                else totals.add(f.path, f.added, f.removed, deps.languageOf);
              }
            }
            await uncommitted(root, start, totals);
          } catch {
            // one broken repo shouldn't lose the others
          }
        }
        if (commits === 0 && totals.files.size === 0) continue;
        results.push({
          repo_key: key,
          repo_name: name,
          commits,
          files_changed: totals.files.size,
          lines_added: totals.added,
          lines_removed: totals.removed,
          languages: totals.languages,
        });
      }
      snapshots = new Map();
      noted = new Map();
      return results;
    },
  };
}
