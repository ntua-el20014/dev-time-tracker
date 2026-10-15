import { afterEach, describe, expect, it } from "vitest";
import * as http from "http";
import {
  createHookReceiver,
  isPortFree,
  leadingFields,
} from "../../src/tracking/hookReceiver";
import { HOOK_PATH } from "../../src/tracking/claudeHooksConfig";

const TOKEN = "k".repeat(43);

function post(
  port: number,
  body: string | Buffer,
  headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` },
  opts: { path?: string; method?: string } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: opts.path ?? HOOK_PATH,
        method: opts.method ?? "POST",
        headers: { "Content-Type": "application/json", ...headers },
      },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

let receiver: ReturnType<typeof createHookReceiver> | null = null;
afterEach(async () => {
  await receiver?.close();
  receiver = null;
});

async function start(maxBodyBytes?: number) {
  const events: unknown[] = [];
  receiver = createHookReceiver({ token: TOKEN, onEvent: (b) => events.push(b), maxBodyBytes });
  const port = await receiver.listen(0);
  return { port, events };
}

describe("hookReceiver", () => {
  it("accepts an authorised event with an empty 200", async () => {
    const { port, events } = await start();
    const res = await post(port, JSON.stringify({ session_id: "s", hook_event_name: "Stop" }));
    expect(res).toEqual({ status: 200, body: "" });
    expect(events).toEqual([{ session_id: "s", hook_event_name: "Stop" }]);
  });

  it("rejects requests without the token, on other paths or methods", async () => {
    const { port, events } = await start();
    expect((await post(port, "{}", {})).status).toBe(401);
    expect((await post(port, "{}", { Authorization: "Bearer wrong" })).status).toBe(401);
    expect((await post(port, "{}", { Authorization: `Bearer ${TOKEN}x` })).status).toBe(401);
    expect((await post(port, "{}", undefined, { path: "/other" })).status).toBe(404);
    expect((await post(port, "", undefined, { method: "GET" })).status).toBe(405);
    // A browser's CORS preflight gets no CORS headers
    expect((await post(port, "", { Origin: "https://evil.example" }, { method: "OPTIONS" })).status).toBe(405);
    expect(events).toEqual([]);
  });

  it("ignores bodies that aren't JSON", async () => {
    const { port, events } = await start();
    expect((await post(port, "not json")).status).toBe(200);
    expect(events).toEqual([]);
  });

  it("takes only the leading fields of an oversized body", async () => {
    const { port, events } = await start(1024);
    const big = JSON.stringify({
      session_id: "s1",
      cwd: "C:\\repo",
      hook_event_name: "PostToolUse",
      tool_response: "x".repeat(10_000),
    });
    expect((await post(port, big)).status).toBe(200);
    expect(events).toEqual([{ session_id: "s1", cwd: "C:\\repo", hook_event_name: "PostToolUse" }]);
  });

  it("listens on 127.0.0.1 and frees the port on close", async () => {
    const { port } = await start();
    expect(await isPortFree(port)).toBe(false);
    await receiver?.close();
    receiver = null;
    expect(await isPortFree(port)).toBe(true);
  });

  it("parses leading fields with escapes", () => {
    expect(leadingFields(`{"session_id":"a","cwd":"C:\\\\x \\"y\\"","hook_event_name":"Stop","tool_response":"trunc`)).toEqual({
      session_id: "a",
      cwd: 'C:\\x "y"',
      hook_event_name: "Stop",
    });
    expect(leadingFields(`{"session_id":"unterminated`)).toEqual({});
  });
});
