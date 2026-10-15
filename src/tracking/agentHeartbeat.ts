/**
 * "Is an AI coding agent working?" from the modification time of its
 * transcript files. Reads no file contents — only directory listings and
 * mtimes:
 *
 * - Claude Code: <claude>/projects/<project>/<session>.jsonl, and subagents
 *   in <claude>/projects/<project>/<session>/subagents/*.jsonl
 * - Codex CLI:   <codex>/sessions/YYYY/MM/DD/*.jsonl
 *
 * To stay cheap with thousands of old transcripts, each poll only stats new
 * files and "hot" ones (written in the last two hours); everything is
 * re-stat'ed every few minutes. Filesystem access is injected for tests.
 */
import * as nodePath from "path";

export interface HeartbeatFs {
  /** Entries of a folder, or [] if it can't be read */
  readDir(path: string): Promise<{ name: string; isDir: boolean }[]>;
  /** Modification time in ms, or null if it can't be read */
  mtimeMs(path: string): Promise<number | null>;
}

export interface HeartbeatOptions {
  fs: HeartbeatFs;
  /** ~/.claude, or CLAUDE_CONFIG_DIR */
  claudeDir: string;
  /** ~/.codex, or CODEX_HOME */
  codexDir: string;
  platform?: NodeJS.Platform;
  now?: () => number;
}

const HOT_MS = 2 * 3600_000;
const FULL_SCAN_MS = 5 * 60_000;

export function createAgentHeartbeat(opts: HeartbeatOptions) {
  const { fs } = opts;
  const P = opts.platform === "win32" ? nodePath.win32 : nodePath.posix;
  const now = opts.now ?? Date.now;

  /** Every transcript seen, with its last known mtime */
  const known = new Map<string, number>();
  let lastFullScan = -Infinity;
  let latest: number | null = null;
  let polling: Promise<number | null> | null = null;

  const isTranscript = (name: string) => name.endsWith(".jsonl");

  /** Claude Code transcripts; subagents only for hot sessions (or all on a full scan). */
  async function claudeFiles(full: boolean): Promise<string[]> {
    const root = P.join(opts.claudeDir, "projects");
    const files: string[] = [];
    for (const project of await fs.readDir(root)) {
      if (!project.isDir) continue;
      const dir = P.join(root, project.name);
      const entries = await fs.readDir(dir);
      for (const e of entries) {
        if (!e.isDir && isTranscript(e.name)) files.push(P.join(dir, e.name));
      }
      for (const e of entries) {
        if (!e.isDir) continue;
        const session = P.join(dir, `${e.name}.jsonl`);
        if (!full && !isHot(session)) continue;
        const subagents = P.join(dir, e.name, "subagents");
        for (const s of await fs.readDir(subagents)) {
          if (!s.isDir && isTranscript(s.name)) files.push(P.join(subagents, s.name));
        }
      }
    }
    return files;
  }

  /** Codex rollouts of today and yesterday (local dates). */
  async function codexFiles(): Promise<string[]> {
    const files: string[] = [];
    for (const daysAgo of [0, 1]) {
      const d = new Date(now() - daysAgo * 86_400_000);
      const dir = P.join(
        opts.codexDir,
        "sessions",
        String(d.getFullYear()),
        String(d.getMonth() + 1).padStart(2, "0"),
        String(d.getDate()).padStart(2, "0"),
      );
      for (const e of await fs.readDir(dir)) {
        if (!e.isDir && isTranscript(e.name)) files.push(P.join(dir, e.name));
      }
    }
    return files;
  }

  function isHot(file: string): boolean {
    const m = known.get(file);
    return m !== undefined && now() - m < HOT_MS;
  }

  async function scan(): Promise<number | null> {
    const t = now();
    const full = t - lastFullScan >= FULL_SCAN_MS;
    if (full) lastFullScan = t;

    const files = [...(await claudeFiles(full)), ...(await codexFiles())];
    for (const file of files) {
      if (!full && known.has(file) && !isHot(file)) continue;
      const m = await fs.mtimeMs(file);
      if (m === null) known.delete(file);
      else known.set(file, m);
    }
    if (full) {
      // Forget files that are gone
      const present = new Set(files);
      for (const file of known.keys()) if (!present.has(file)) known.delete(file);
    }

    for (const m of known.values()) {
      if (m <= t + 60_000 && (latest === null || m > latest)) latest = m;
    }
    return latest;
  }

  return {
    /** Look for new agent activity; resolves to the latest write (ms). */
    poll(): Promise<number | null> {
      // Never run two scans at once
      polling ??= scan().finally(() => {
        polling = null;
      });
      return polling;
    },
    /** Latest agent write seen so far (ms since epoch), or null. */
    lastActivity(): number | null {
      return latest;
    },
  };
}
