/**
 * Reads AI agent transcripts incrementally and uploads one metadata row per
 * agent session (agent_sessions). Each file is read from where the last
 * cycle stopped, complete lines only; the per-file state (offset and
 * aggregate) lives in a local JSON file, so restarts don't re-read history.
 * Rows that failed to upload stay "dirty" and are retried next cycle.
 *
 * Everything outside is injected so this runs in tests.
 */
import * as nodePath from "path";
import {
  applyLine,
  newAggregate,
  totalTokens,
  type AgentAggregate,
  type AgentSource,
  type LanguageOf,
} from "./agentTranscripts";

/** Transcripts older than this are not read. */
export const INGEST_MAX_AGE_MS = 30 * 86_400_000;
/** At most this much is read per cycle, so a large history doesn't stall. */
const MAX_BYTES_PER_CYCLE = 32 * 1024 * 1024;
const CHUNK_BYTES = 4 * 1024 * 1024;
const UPLOAD_BATCH = 100;
const STATE_VERSION = 1;

export interface AgentSessionRow {
  source: AgentSource;
  external_id: string;
  repo_key: string | null;
  repo_name: string | null;
  project_id: string | null;
  started_at: string;
  ended_at: string;
  active_seconds: number;
  prompts: number;
  tool_calls: number;
  files_changed: number;
  lines_added: number | null;
  lines_removed: number | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  models: AgentAggregate["models"];
  languages: Record<string, number>;
  cost_usd: number | null;
}

interface FileState {
  source: AgentSource;
  offset: number;
  size: number;
  mtimeMs: number;
  agg: AgentAggregate;
}

export interface IngestState {
  version: number;
  files: Record<string, FileState>;
  /** Files whose row hasn't been uploaded since it last changed */
  dirty: string[];
}

export interface TranscriptFile {
  path: string;
  source: AgentSource;
  mtimeMs: number;
}

export interface IngestDeps {
  listTranscripts(): Promise<TranscriptFile[]>;
  /** File size, or null if it's gone */
  size(path: string): Promise<number | null>;
  /** Up to `length` bytes from `offset` */
  read(path: string, offset: number, length: number): Promise<Buffer | null>;
  loadState(): Promise<IngestState | null>;
  saveState(state: IngestState): Promise<void>;
  repoForDir(dir: string): { key: string; name: string } | null;
  projectFor(repoKey: string): string | null;
  /** Upserts rows; throws on failure */
  upload(rows: AgentSessionRow[]): Promise<void>;
  languageOf: LanguageOf;
  now?: () => number;
  /** Read budget per cycle (default 32 MB) */
  maxBytesPerCycle?: number;
}

export function emptyState(): IngestState {
  return { version: STATE_VERSION, files: {}, dirty: [] };
}

/** The upload row for a file, or null until it has a start time. */
export function toRow(
  path: string,
  agg: AgentAggregate,
  deps: Pick<IngestDeps, "repoForDir" | "projectFor">,
): AgentSessionRow | null {
  if (!agg.startedAt || !agg.endedAt) return null;
  const repo = agg.cwd ? deps.repoForDir(agg.cwd) : null;
  const tokens = totalTokens(agg);
  // The file name is the session's identity: a resumed Claude session gets a
  // new file but copies lines that carry the old sessionId
  const external =
    agg.source === "codex" && agg.sessionId
      ? agg.sessionId
      : nodePath.basename(path).replace(/\.jsonl$/, "");
  return {
    source: agg.source,
    external_id: external.slice(0, 200),
    repo_key: repo?.key ?? null,
    repo_name: repo?.name ?? null,
    project_id: repo ? deps.projectFor(repo.key) : null,
    started_at: agg.startedAt,
    ended_at: agg.endedAt,
    active_seconds: Math.round(agg.activeSeconds),
    prompts: agg.prompts,
    tool_calls: agg.toolCalls,
    files_changed: agg.files.length,
    lines_added: agg.linesAdded,
    lines_removed: agg.linesRemoved,
    input_tokens: tokens.input,
    output_tokens: tokens.output,
    cache_read_tokens: tokens.cacheRead,
    cache_write_tokens: tokens.cacheWrite,
    models: agg.models,
    languages: agg.languages,
    cost_usd:
      agg.costUsd === null ? null : Math.round(agg.costUsd * 10_000) / 10_000,
  };
}

export function createAgentIngest(deps: IngestDeps) {
  const now = deps.now ?? Date.now;
  let state: IngestState | null = null;
  let running: Promise<IngestResult> | null = null;

  async function load(): Promise<IngestState> {
    if (state) return state;
    const loaded = await deps.loadState().catch(() => null);
    state =
      loaded && loaded.version === STATE_VERSION && loaded.files
        ? loaded
        : emptyState();
    state.dirty ??= [];
    return state;
  }

  /** Read new complete lines of one file; returns bytes consumed. */
  async function readFile(
    file: TranscriptFile,
    budget: number,
  ): Promise<number> {
    const s = await load();
    const size = await deps.size(file.path);
    if (size === null) return 0;
    let fs = s.files[file.path];
    // New file, or rewritten/truncated: start over
    if (!fs || size < fs.offset || fs.source !== file.source) {
      fs = s.files[file.path] = {
        source: file.source,
        offset: 0,
        size: 0,
        mtimeMs: 0,
        agg: newAggregate(file.source),
      };
    }
    let consumed = 0;
    while (fs.offset < size && consumed < budget) {
      const length = Math.min(CHUNK_BYTES, size - fs.offset, budget - consumed);
      const buf = await deps.read(file.path, fs.offset, length);
      if (!buf || buf.length === 0) break;
      const lastNewline = buf.lastIndexOf(0x0a);
      if (lastNewline < 0) {
        // A line longer than a chunk: skip it rather than stall forever
        // (a short read just means the budget ran out mid-line)
        if (buf.length >= CHUNK_BYTES) fs.offset += buf.length;
        break;
      }
      const text = buf.subarray(0, lastNewline).toString("utf8");
      for (const line of text.split("\n"))
        applyLine(fs.agg, line, deps.languageOf);
      fs.offset += lastNewline + 1;
      consumed += lastNewline + 1;
    }
    fs.size = size;
    // Only when read to the end; otherwise the next cycle continues it
    fs.mtimeMs = fs.offset >= size ? file.mtimeMs : 0;
    if (consumed > 0 && !s.dirty.includes(file.path)) s.dirty.push(file.path);
    return consumed;
  }

  async function cycle(): Promise<IngestResult> {
    const s = await load();
    const cutoff = now() - INGEST_MAX_AGE_MS;
    const files = (await deps.listTranscripts()).filter(
      (f) => f.mtimeMs >= cutoff,
    );

    let budget = deps.maxBytesPerCycle ?? MAX_BYTES_PER_CYCLE;
    let read = 0;
    for (const file of files) {
      const known = s.files[file.path];
      if (known && known.mtimeMs === file.mtimeMs) continue;
      if (budget <= 0) break;
      const consumed = await readFile(file, budget);
      budget -= consumed;
      read += consumed;
    }

    // Forget files that are gone or too old
    const present = new Set(files.map((f) => f.path));
    for (const path of Object.keys(s.files)) {
      if (!present.has(path)) delete s.files[path];
    }
    s.dirty = s.dirty.filter((p) => s.files[p]);

    let uploaded = 0;
    let error: unknown = null;
    // Sessions without a start time yet have nothing to upload; they become
    // dirty again when more of their file is read
    const pending = s.dirty
      .map((path) => ({ path, row: toRow(path, s.files[path].agg, deps) }))
      .filter(
        (x): x is { path: string; row: AgentSessionRow } => x.row !== null,
      );
    s.dirty = pending.map((x) => x.path);
    for (let i = 0; i < pending.length; i += UPLOAD_BATCH) {
      const batch = pending.slice(i, i + UPLOAD_BATCH);
      try {
        await deps.upload(batch.map((b) => b.row));
        const done = new Set(batch.map((b) => b.path));
        s.dirty = s.dirty.filter((p) => !done.has(p));
        uploaded += batch.length;
      } catch (err) {
        error = err;
        break;
      }
    }

    await deps.saveState(s).catch(() => {});
    return { read, uploaded, pending: s.dirty.length, error };
  }

  return {
    /** One ingest pass; concurrent calls share the running pass. */
    run(): Promise<IngestResult> {
      running ??= cycle().finally(() => {
        running = null;
      });
      return running;
    },
    /** Mark every known session for re-upload (e.g. after links changed). */
    async markAllDirty() {
      const s = await load();
      s.dirty = Object.keys(s.files);
    },
    /** Working directories of agent sessions active between `start` and `end` (ms). */
    async dirsActiveBetween(start: number, end: number): Promise<string[]> {
      const s = await load();
      const dirs = new Set<string>();
      for (const f of Object.values(s.files)) {
        const { cwd, startedAt, endedAt } = f.agg;
        if (!cwd || !startedAt || !endedAt) continue;
        if (Date.parse(endedAt) >= start && Date.parse(startedAt) <= end) dirs.add(cwd);
      }
      return [...dirs];
    },
    /** Forget all local state (e.g. after the user deleted uploaded data). */
    async reset() {
      state = emptyState();
      await deps.saveState(state).catch(() => {});
    },
  };
}

export interface IngestResult {
  /** Bytes read this pass */
  read: number;
  /** Rows uploaded this pass */
  uploaded: number;
  /** Rows still waiting to upload */
  pending: number;
  error: unknown;
}
