import { describe, it, expect } from "vitest";
import {
  applyLine,
  newAggregate,
  totalTokens,
} from "../../src/tracking/agentTranscripts";

const ext = (p: string) => (p.endsWith(".ts") ? "TypeScript" : p.endsWith(".py") ? "Python" : null);
const at = (min: number) => new Date(Date.UTC(2026, 9, 15, 10, min)).toISOString();
const line = (o: object) => JSON.stringify(o);

function claude(lines: object[]) {
  const agg = newAggregate("claude-code");
  for (const l of lines) applyLine(agg, line(l), ext);
  return agg;
}

describe("Claude Code transcripts", () => {
  const usage = (output: number) => ({
    input_tokens: 10,
    output_tokens: output,
    cache_read_input_tokens: 100,
    cache_creation_input_tokens: 5,
  });

  it("counts prompts, tool calls, edits and tokens without keeping content", () => {
    const agg = claude([
      { type: "user", timestamp: at(0), sessionId: "s1", cwd: "C:\\code\\shop", origin: { kind: "human" }, message: { content: [{ type: "text", text: "secret prompt" }] } },
      {
        type: "assistant", timestamp: at(1), message: {
          id: "m1", model: "claude-opus-5-5", usage: usage(50),
          content: [
            { type: "text", text: "secret answer" },
            { type: "tool_use", name: "Edit", input: { file_path: "C:\\code\\shop\\a.ts", old_string: "x", new_string: "y" } },
            { type: "tool_use", name: "Bash", input: { command: "ls" } },
          ],
        },
      },
      { type: "user", timestamp: at(2), message: { content: [{ type: "tool_result", content: "out" }] } },
      { type: "assistant", timestamp: at(3), message: { id: "m2", model: "claude-opus-5-5", usage: usage(20), content: [{ type: "tool_use", name: "Write", input: { file_path: "C:\\code\\shop\\a.ts" } }, { type: "tool_use", name: "Write", input: { file_path: "C:\\code\\shop\\b.py" } }] } },
    ]);
    expect(agg).toMatchObject({
      sessionId: "s1",
      cwd: "C:\\code\\shop",
      startedAt: at(0),
      endedAt: at(3),
      activeSeconds: 180,
      prompts: 1,
      toolCalls: 4,
      languages: { TypeScript: 2, Python: 1 },
    });
    expect(agg.files).toHaveLength(2);
    expect(agg.models["claude-opus-5-5"]).toEqual({ input: 20, output: 70, cacheRead: 200, cacheWrite: 10 });
    expect(JSON.stringify(agg)).not.toContain("secret");
  });

  it("counts a message's usage once when it spans several lines", () => {
    const agg = claude([
      { type: "assistant", timestamp: at(0), message: { id: "m1", model: "claude-opus-5-5", usage: usage(5), content: [{ type: "thinking" }] } },
      { type: "assistant", timestamp: at(0), message: { id: "m1", model: "claude-opus-5-5", usage: usage(40), content: [{ type: "text" }] } },
      { type: "assistant", timestamp: at(1), message: { id: "m2", model: "claude-haiku-5-5", usage: usage(1), content: [] } },
    ]);
    expect(agg.models["claude-opus-5-5"].output).toBe(40);
    expect(agg.models["claude-opus-5-5"].input).toBe(10);
    expect(totalTokens(agg)).toEqual({ input: 20, output: 41, cacheRead: 200, cacheWrite: 10 });
  });

  it("takes cost and lines from the latest cost-state", () => {
    const agg = claude([
      { type: "cost-state", totalCostUSD: 1.5, totalLinesAdded: 10, totalLinesRemoved: 2 },
      { type: "cost-state", totalCostUSD: 2.25, totalLinesAdded: 30, totalLinesRemoved: 4 },
    ]);
    expect(agg).toMatchObject({ costUsd: 2.25, linesAdded: 30, linesRemoved: 4 });
  });

  it("leaves gaps over five minutes out of active time", () => {
    const agg = claude([
      { type: "user", timestamp: at(0), origin: { kind: "human" }, message: { content: "hi" } },
      { type: "assistant", timestamp: at(4), message: { content: [] } },
      { type: "user", timestamp: at(30), origin: { kind: "human" }, message: { content: "again" } },
      { type: "assistant", timestamp: at(31), message: { content: [] } },
    ]);
    expect(agg.activeSeconds).toBe(5 * 60);
    expect(agg.prompts).toBe(2);
    expect(agg.endedAt).toBe(at(31));
  });

  it("recognizes prompts in transcripts without origin, and skips subagent and tool-result lines", () => {
    const agg = claude([
      { type: "user", message: { content: "plain string prompt" } },
      { type: "user", message: { content: [{ type: "text", text: "p" }] } },
      { type: "user", isSidechain: true, message: { content: [{ type: "text", text: "subagent" }] } },
      { type: "user", message: { content: [{ type: "tool_result" }] } },
      { type: "user", origin: { kind: "task-notification" }, message: { content: "x" } },
    ]);
    expect(agg.prompts).toBe(2);
  });

  it("ignores junk, unknown entries and out-of-order timestamps", () => {
    const agg = newAggregate("claude-code");
    expect(applyLine(agg, "not json", ext)).toBe(false);
    expect(applyLine(agg, "", ext)).toBe(false);
    applyLine(agg, line({ type: "something-new", timestamp: at(10) }), ext);
    applyLine(agg, line({ type: "file-history-snapshot", timestamp: at(5) }), ext);
    applyLine(agg, line({ type: "assistant", timestamp: "garbage", message: { model: "<synthetic>", usage: usage(9) } }), ext);
    expect(agg.startedAt).toBe(at(5));
    expect(agg.endedAt).toBe(at(10));
    expect(agg.activeSeconds).toBe(0);
    expect(agg.models).toEqual({});
  });
});

describe("Codex transcripts", () => {
  const tokens = (input: number, cached: number, output: number) => ({
    type: "event_msg",
    payload: { type: "token_count", info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } } },
  });

  it("reads session, prompts, tool calls, patches and cumulative tokens", () => {
    const agg = newAggregate("codex");
    for (const o of [
      { type: "session_meta", timestamp: at(0), payload: { id: "cx-1", cwd: "/home/me/api" } },
      { type: "turn_context", timestamp: at(0), payload: { model: "gpt-5.5", cwd: "/home/me/api" } },
      { type: "event_msg", timestamp: at(1), payload: { type: "user_message", message: "secret" } },
      { type: "response_item", timestamp: at(2), payload: { type: "function_call", name: "shell" } },
      { type: "response_item", timestamp: at(2), payload: { type: "custom_tool_call", name: "apply_patch" } },
      { type: "event_msg", timestamp: at(2), payload: { type: "patch_apply_end", changes: { "/home/me/api/x.py": {}, "/home/me/api/y.ts": {} } } },
      { ...tokens(1000, 800, 50), timestamp: at(3) },
      { ...tokens(3000, 2000, 120), timestamp: at(4) },
    ]) applyLine(agg, line(o), ext);

    expect(agg).toMatchObject({
      sessionId: "cx-1",
      cwd: "/home/me/api",
      prompts: 1,
      toolCalls: 2,
      languages: { Python: 1, TypeScript: 1 },
      activeSeconds: 240,
    });
    expect(agg.models["gpt-5.5"]).toEqual({ input: 1000, output: 120, cacheRead: 2000, cacheWrite: 0 });
    expect(JSON.stringify(agg)).not.toContain("secret");
  });

  it("splits tokens between models when the model changes", () => {
    const agg = newAggregate("codex");
    for (const o of [
      { type: "turn_context", payload: { model: "a" } },
      tokens(100, 0, 10),
      { type: "turn_context", payload: { model: "b" } },
      tokens(250, 0, 30),
    ]) applyLine(agg, line(o), ext);
    expect(agg.models.a).toMatchObject({ input: 100, output: 10 });
    expect(agg.models.b).toMatchObject({ input: 150, output: 20 });
  });
});
