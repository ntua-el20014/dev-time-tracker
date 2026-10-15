/**
 * Pure: turns AI agent transcript lines into per-session metadata — times,
 * counts, tokens, cost — fed one line at a time so files can be read
 * incrementally. Never keeps prompt or response content. File paths are kept
 * only locally (to count distinct files); they are not uploaded.
 *
 * The transcript formats are internal to each agent and change between
 * versions, so every field is optional and unknown lines are ignored.
 *
 * - Claude Code: <project>/<session>.jsonl. "user" entries (origin.kind
 *   "human" = a prompt), "assistant" entries (message.usage, tool_use
 *   blocks; several lines can share one message.id), "cost-state" (the
 *   agent's own cost and lines added/removed).
 * - Codex CLI: rollout-*.jsonl. session_meta, turn_context (model),
 *   event_msg user_message / token_count (cumulative) / patch_apply_end,
 *   response_item function_call / custom_tool_call.
 */

export type AgentSource = "claude-code" | "codex";

/** Gaps between entries longer than this don't count as active time. */
export const AGENT_GAP_SECONDS = 5 * 60;

export interface ModelTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface AgentAggregate {
  source: AgentSource;
  /** Agent's session id (from the transcript), if seen */
  sessionId: string | null;
  /** Working directory the session started in (local only) */
  cwd: string | null;
  startedAt: string | null;
  endedAt: string | null;
  activeSeconds: number;
  prompts: number;
  toolCalls: number;
  /** Distinct files edited (local only; only the count is uploaded) */
  files: string[];
  /** Edits per language */
  languages: Record<string, number>;
  models: Record<string, ModelTokens>;
  costUsd: number | null;
  linesAdded: number | null;
  linesRemoved: number | null;
  /** Claude: the last message id and the tokens counted for it */
  lastMessage: { id: string; model: string; tokens: ModelTokens } | null;
  /** Codex: cumulative totals seen so far, and the current model */
  codexTotals: ModelTokens | null;
  codexModel: string | null;
}

export type LanguageOf = (filePath: string) => string | null;

export function newAggregate(source: AgentSource): AgentAggregate {
  return {
    source,
    sessionId: null,
    cwd: null,
    startedAt: null,
    endedAt: null,
    activeSeconds: 0,
    prompts: 0,
    toolCalls: 0,
    files: [],
    languages: {},
    models: {},
    costUsd: null,
    linesAdded: null,
    linesRemoved: null,
    lastMessage: null,
    codexTotals: null,
    codexModel: null,
  };
}

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;
const zero = (): ModelTokens => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
});

function addTokens(
  agg: AgentAggregate,
  model: string,
  t: ModelTokens,
  sign = 1,
) {
  const m = (agg.models[model] ??= zero());
  m.input = Math.max(0, m.input + sign * t.input);
  m.output = Math.max(0, m.output + sign * t.output);
  m.cacheRead = Math.max(0, m.cacheRead + sign * t.cacheRead);
  m.cacheWrite = Math.max(0, m.cacheWrite + sign * t.cacheWrite);
}

function touch(agg: AgentAggregate, timestamp: unknown) {
  const ts = str(timestamp);
  if (!ts) return;
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return;
  if (!agg.startedAt || t < Date.parse(agg.startedAt)) agg.startedAt = ts;
  if (agg.endedAt) {
    const gap = (t - Date.parse(agg.endedAt)) / 1000;
    if (gap > 0 && gap <= AGENT_GAP_SECONDS) agg.activeSeconds += gap;
    if (gap > 0) agg.endedAt = ts;
  } else {
    agg.endedAt = ts;
  }
}

function editedFile(
  agg: AgentAggregate,
  path: string | null,
  languageOf: LanguageOf,
) {
  if (!path) return;
  if (!agg.files.includes(path)) agg.files.push(path);
  const language = languageOf(path);
  if (language) agg.languages[language] = (agg.languages[language] ?? 0) + 1;
}

const CLAUDE_EDIT_TOOLS = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
]);

function applyClaude(agg: AgentAggregate, o: any, languageOf: LanguageOf) {
  agg.sessionId ??= str(o.sessionId);
  if (o.type === "user" || o.type === "assistant") agg.cwd ??= str(o.cwd);

  if (o.type === "user") {
    const content = o.message?.content;
    const blocks = Array.isArray(content) ? content : [];
    const isPrompt = o.origin
      ? o.origin.kind === "human"
      : !o.isSidechain &&
        (typeof content === "string" ||
          (blocks.some((b: any) => b?.type === "text") &&
            !blocks.some((b: any) => b?.type === "tool_result")));
    if (isPrompt) agg.prompts++;
  }

  if (o.type === "assistant" && o.message) {
    const m = o.message;
    const model = str(m.model);
    const usage = m.usage;
    if (model && model !== "<synthetic>" && usage) {
      const tokens: ModelTokens = {
        input: num(usage.input_tokens),
        output: num(usage.output_tokens),
        cacheRead: num(usage.cache_read_input_tokens),
        cacheWrite: num(usage.cache_creation_input_tokens),
      };
      const id = str(m.id);
      // Lines of the same message repeat its usage: replace, don't add
      if (id && agg.lastMessage?.id === id) {
        addTokens(agg, agg.lastMessage.model, agg.lastMessage.tokens, -1);
      }
      addTokens(agg, model, tokens);
      agg.lastMessage = id ? { id, model, tokens } : null;
    }
    for (const block of Array.isArray(m.content) ? m.content : []) {
      if (block?.type !== "tool_use") continue;
      agg.toolCalls++;
      if (CLAUDE_EDIT_TOOLS.has(block.name)) {
        editedFile(
          agg,
          str(block.input?.file_path) ?? str(block.input?.notebook_path),
          languageOf,
        );
      }
    }
  }

  if (o.type === "cost-state") {
    if (typeof o.totalCostUSD === "number")
      agg.costUsd = Math.max(0, o.totalCostUSD);
    if (typeof o.totalLinesAdded === "number")
      agg.linesAdded = o.totalLinesAdded;
    if (typeof o.totalLinesRemoved === "number")
      agg.linesRemoved = o.totalLinesRemoved;
  }
}

function applyCodex(agg: AgentAggregate, o: any, languageOf: LanguageOf) {
  const p = o.payload ?? {};
  if (o.type === "session_meta") {
    agg.sessionId ??= str(p.id);
    agg.cwd ??= str(p.cwd);
  } else if (o.type === "turn_context") {
    agg.codexModel = str(p.model) ?? agg.codexModel;
    agg.cwd ??= str(p.cwd);
  } else if (o.type === "event_msg") {
    if (p.type === "user_message") agg.prompts++;
    if (p.type === "token_count" && p.info?.total_token_usage) {
      const u = p.info.total_token_usage;
      const cached = num(u.cached_input_tokens);
      const total: ModelTokens = {
        input: Math.max(0, num(u.input_tokens) - cached),
        output: num(u.output_tokens),
        cacheRead: cached,
        cacheWrite: 0,
      };
      // Cumulative: add what's new since the last count to the current model
      const prev = agg.codexTotals ?? zero();
      addTokens(agg, agg.codexModel ?? "unknown", {
        input: Math.max(0, total.input - prev.input),
        output: Math.max(0, total.output - prev.output),
        cacheRead: Math.max(0, total.cacheRead - prev.cacheRead),
        cacheWrite: 0,
      });
      agg.codexTotals = total;
    }
    if (
      p.type === "patch_apply_end" &&
      p.changes &&
      typeof p.changes === "object"
    ) {
      for (const path of Object.keys(p.changes))
        editedFile(agg, path, languageOf);
    }
  } else if (o.type === "response_item") {
    if (p.type === "function_call" || p.type === "custom_tool_call")
      agg.toolCalls++;
  }
}

/** Apply one transcript line. Returns false if it wasn't usable JSON. */
export function applyLine(
  agg: AgentAggregate,
  line: string,
  languageOf: LanguageOf,
): boolean {
  if (!line.trim()) return false;
  let o: any;
  try {
    o = JSON.parse(line);
  } catch {
    return false;
  }
  if (!o || typeof o !== "object") return false;
  touch(agg, o.timestamp);
  if (agg.source === "claude-code") applyClaude(agg, o, languageOf);
  else applyCodex(agg, o, languageOf);
  return true;
}

export interface AgentTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export function totalTokens(agg: AgentAggregate): AgentTotals {
  const t = zero();
  for (const m of Object.values(agg.models)) {
    t.input += m.input;
    t.output += m.output;
    t.cacheRead += m.cacheRead;
    t.cacheWrite += m.cacheWrite;
  }
  return t;
}
