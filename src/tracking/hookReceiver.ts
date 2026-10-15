/**
 * The local endpoint Claude Code's hooks post to (curl, claudeHooksConfig.ts).
 * Listens on 127.0.0.1 only and answers at once with an empty 200; the
 * hooks run in the background, so nothing we answer reaches Claude.
 *
 * Every request must carry the secret token written into settings.json, as
 * an Authorization header. Web pages can't send that header to us (it
 * needs a CORS preflight, which we never grant) and don't know the token,
 * so a site can't fake agent activity, even through DNS rebinding.
 *
 * Bodies can be large (PostToolUse carries the tool's output). Up to
 * MAX_BODY_BYTES is parsed as JSON; beyond that only the leading metadata
 * fields are picked out of the first bytes and the rest is discarded
 * unread. The handler gets the parsed object; agentLive.ts takes the
 * metadata from it and nothing else.
 */
import * as http from "http";
import { timingSafeEqual } from "crypto";
import { HOOK_PATH } from "./claudeHooksConfig";

export const MAX_BODY_BYTES = 1024 * 1024;
const PREFIX_BYTES = 64 * 1024;

export interface ReceiverOptions {
  token: string;
  onEvent(body: unknown): void;
  maxBodyBytes?: number;
}

/**
 * Claude Code writes the common fields (session_id, cwd, hook_event_name)
 * before the event's own; take them from the start of an oversized body.
 */
export function leadingFields(prefix: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ["session_id", "cwd", "hook_event_name", "notification_type"]) {
    const m = new RegExp(`"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`).exec(prefix);
    if (!m) continue;
    try {
      out[key] = JSON.parse(m[1]);
    } catch {
      // not a complete string literal
    }
  }
  return out;
}

function tokenMatches(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function createHookReceiver(opts: ReceiverOptions) {
  const maxBody = opts.maxBodyBytes ?? MAX_BODY_BYTES;
  let server: http.Server | null = null;
  let port: number | null = null;

  function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const reply = (status: number) => {
      res.writeHead(status, { "Content-Length": "0" });
      res.end();
    };
    const pathname = (req.url ?? "").split("?")[0];
    if (pathname !== HOOK_PATH) return reply(404);
    if (req.method !== "POST") return reply(405);
    if (!tokenMatches(req.headers.authorization, opts.token)) {
      req.resume();
      return reply(401);
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let overflow = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (overflow) return;
      if (size > maxBody) {
        overflow = true;
        // Keep only the start, for the metadata fields
        const head = Buffer.concat([...chunks, chunk]);
        chunks.length = 0;
        chunks.push(head.subarray(0, PREFIX_BYTES));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      reply(200);
      const text = Buffer.concat(chunks).toString("utf8");
      let body: unknown = null;
      if (overflow) {
        body = leadingFields(text);
      } else {
        try {
          body = JSON.parse(text);
        } catch {
          return;
        }
      }
      try {
        opts.onEvent(body);
      } catch {
        // a bad event must not break the receiver
      }
    });
    req.on("error", () => res.destroy());
  }

  return {
    /** Listen on 127.0.0.1:`wanted` (0 = any free port); resolves to the port. */
    listen(wanted: number): Promise<number> {
      return new Promise((resolve, reject) => {
        const s = http.createServer(handle);
        // curl opens one connection per event
        s.keepAliveTimeout = 5000;
        s.requestTimeout = 30_000;
        s.once("error", reject);
        s.listen(wanted, "127.0.0.1", () => {
          s.off("error", reject);
          server = s;
          port = (s.address() as { port: number }).port;
          resolve(port);
        });
      });
    },
    close(): Promise<void> {
      const s = server;
      server = null;
      port = null;
      return new Promise((resolve) => {
        if (!s) return resolve();
        s.close(() => resolve());
        s.closeAllConnections?.();
      });
    },
    port: () => port,
  };
}

/** Is `port` free on 127.0.0.1 right now? */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}
