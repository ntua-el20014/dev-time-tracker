/**
 * "Connect Claude Code" (C3, opt-in): adds hooks to Claude Code's user
 * settings (curl in the background, see claudeHooksConfig.ts) so it tells
 * the app, as it happens, when a session gets a prompt, runs a tool, waits
 * for the user, finishes a turn or ends. That
 * feeds the live agent state (agentLive.ts via the tracker): Supervising
 * starts at once instead of after the next transcript poll, a long tool
 * run counts as working, and a terminal running `claude` gets its repo.
 * The transcripts (agents.ts) stay the source of the uploaded sessions;
 * a session ending just makes the next upload come sooner.
 *
 * The settings file is only changed after the user saw the exact change
 * (preview → apply with the hash of the file they saw), a backup is
 * written next to it first, other hooks are kept, and Disconnect removes
 * exactly ours (claudeHooksConfig.ts).
 *
 * Local file: userData/claude-hooks.json ({ port, token }) — present while
 * connected. The token is the shared secret the receiver checks.
 */
import { app } from "electron";
import { execFile } from "child_process";
import { createHash, randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
  hookStatus,
  lineDiff,
  planInstall,
  planUninstall,
  type DiffLine,
  type HookEndpoint,
  type HookInstallState,
} from "./claudeHooksConfig";
import { createHookReceiver, isPortFree } from "./hookReceiver";
import { parseHookEvent } from "./agentLive";
import {
  CLAUDE_DIR,
  applyAgentHookEvent,
  clearLiveAgents,
  getLiveAgentStats,
} from "./tracker";
import { runAgentIngest } from "./agents";
import { logError } from "../utils/errorHandler";

/** Tried first, so the URL in settings.json stays the same across installs. */
export const DEFAULT_HOOK_PORT = 47_651;
/** After a session ends, upload it this soon (lets Claude finish writing). */
const INGEST_AFTER_END_MS = 10_000;

export type HookAction = "connect" | "disconnect";

export interface ClaudeHooksStatus {
  /** Claude Code's settings file */
  settingsPath: string;
  /** Claude Code's folder exists on this computer */
  claudeFound: boolean;
  state: HookInstallState;
  /** This app has a connection saved (and listens for it) */
  saved: boolean;
  receiver: "listening" | "off" | "error";
  receiverError: string | null;
  port: number | null;
  error: string | null;
  warnings: string[];
  lastEventAt: string | null;
  eventsReceived: number;
}

export interface ClaudeHooksPreview {
  ok: boolean;
  action: HookAction;
  error?: string;
  settingsPath: string;
  diff: DiffLine[];
  changed: boolean;
  creates: boolean;
  warnings: string[];
  /** Hash of the file this preview was made from; apply checks it */
  baseHash: string;
}

export interface ClaudeHooksApplyResult {
  ok: boolean;
  error?: string;
  /** The settings file changed since the preview: show the new one */
  stale?: boolean;
  backupPath: string | null;
  status: ClaudeHooksStatus;
}

const settingsPath = () => path.join(CLAUDE_DIR, "settings.json");
const configPath = () => path.join(app.getPath("userData"), "claude-hooks.json");

let endpoint: HookEndpoint | null = null;
/** Proposed by the last Connect preview, until applied */
let pending: HookEndpoint | null = null;
let receiver: ReturnType<typeof createHookReceiver> | null = null;
let receiverError: string | null = null;
let ingestTimer: ReturnType<typeof setTimeout> | null = null;

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

const hashOf = (text: string | null) =>
  createHash("sha256").update(text === null ? "\0missing" : `\u0001${text}`).digest("hex");

/** Show tokens in the preview by their first characters only. */
const maskTokens = (text: string) =>
  text.replace(/(Bearer )([\w-]{4})[\w-]*/g, "$1$2…");

/** The hook runs curl (Windows 10+, macOS and Linux ship it). */
function curlAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("curl", ["--version"], { timeout: 5000, windowsHide: true }, (err) =>
      resolve(!err),
    );
  });
}

function isValidEndpoint(v: unknown): v is HookEndpoint {
  const e = v as HookEndpoint;
  return (
    typeof e?.port === "number" &&
    Number.isInteger(e.port) &&
    e.port > 0 &&
    e.port < 65536 &&
    typeof e.token === "string" &&
    /^[\w-]{32,128}$/.test(e.token)
  );
}

async function loadConfig(): Promise<HookEndpoint | null> {
  try {
    const parsed = JSON.parse((await readText(configPath())) ?? "null");
    return isValidEndpoint(parsed) ? { port: parsed.port, token: parsed.token } : null;
  } catch {
    return null;
  }
}

async function writeAtomic(file: string, text: string) {
  const tmp = `${file}.dtt-tmp`;
  await fs.promises.writeFile(tmp, text, "utf-8");
  await fs.promises.rename(tmp, file);
}

function onHookBody(body: unknown) {
  const event = parseHookEvent(body, Date.now());
  if (!event) return;
  applyAgentHookEvent(event);
  if (event.event === "SessionEnd" || event.event === "Stop") {
    if (ingestTimer) clearTimeout(ingestTimer);
    ingestTimer = setTimeout(() => {
      ingestTimer = null;
      void runAgentIngest();
    }, INGEST_AFTER_END_MS);
  }
}

async function startReceiver(ep: HookEndpoint) {
  await stopReceiver();
  const r = createHookReceiver({ token: ep.token, onEvent: onHookBody });
  try {
    await r.listen(ep.port);
    receiver = r;
    receiverError = null;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    receiverError =
      code === "EADDRINUSE"
        ? `Port ${ep.port} is taken by another program. Reconnect to pick another port.`
        : String((err as Error)?.message ?? err).slice(0, 200);
    logError("claudeHooks.listen", err);
  }
}

async function stopReceiver() {
  const r = receiver;
  receiver = null;
  await r?.close();
}

/** A free port: the usual one if possible (or the one we already listen on). */
async function choosePort(): Promise<number> {
  const listening = receiver?.port();
  if (listening) return listening;
  if (await isPortFree(DEFAULT_HOOK_PORT)) return DEFAULT_HOOK_PORT;
  const probe = createHookReceiver({ token: "x", onEvent: () => undefined });
  const port = await probe.listen(0);
  await probe.close();
  return port;
}

export async function getClaudeHooksStatus(): Promise<ClaudeHooksStatus> {
  let text: string | null = null;
  let error: string | null = null;
  try {
    text = await readText(settingsPath());
  } catch (err) {
    error = `Can't read ${settingsPath()}: ${(err as Error)?.message ?? err}`;
  }
  const status = error
    ? { state: "invalid" as const, port: null, warnings: [], error }
    : hookStatus(text, endpoint);
  const stats = getLiveAgentStats();
  return {
    settingsPath: settingsPath(),
    claudeFound: fs.existsSync(CLAUDE_DIR),
    state: status.state,
    saved: endpoint !== null,
    receiver: receiver ? "listening" : receiverError ? "error" : "off",
    receiverError,
    port: receiver?.port() ?? endpoint?.port ?? status.port,
    error: status.error ?? null,
    warnings: status.warnings,
    lastEventAt: stats.lastEventAt === null ? null : new Date(stats.lastEventAt).toISOString(),
    eventsReceived: stats.eventsReceived,
  };
}

async function plan(action: HookAction, text: string | null) {
  if (action === "disconnect") return planUninstall(text);
  if (!pending) {
    // Keep a working connection's port and token; after a port clash, move
    pending =
      endpoint && !receiverError
        ? endpoint
        : {
            port: await choosePort(),
            token: endpoint?.token ?? randomBytes(32).toString("base64url"),
          };
  }
  return planInstall(text, pending);
}

/** The exact change Connect / Disconnect would make, as a line diff. */
export async function previewClaudeHooks(action: HookAction): Promise<ClaudeHooksPreview> {
  const base = { action, settingsPath: settingsPath(), diff: [], changed: false, creates: false, warnings: [] };
  if (action === "connect" && !fs.existsSync(CLAUDE_DIR)) {
    return { ...base, ok: false, baseHash: "", error: `Claude Code isn't set up on this computer (no ${CLAUDE_DIR}).` };
  }
  if (action === "connect" && !(await curlAvailable())) {
    return { ...base, ok: false, baseHash: "", error: "The hooks use curl, which wasn't found on this computer. Install curl and try again." };
  }
  let text: string | null;
  try {
    text = await readText(settingsPath());
  } catch (err) {
    return { ...base, ok: false, baseHash: "", error: `Can't read ${settingsPath()}: ${(err as Error)?.message ?? err}` };
  }
  if (action === "connect" && receiverError) pending = null; // pick a free port again
  const p = await plan(action, text);
  if (!p.ok) return { ...base, ok: false, baseHash: hashOf(text), error: p.error };
  return {
    ...base,
    ok: true,
    diff: lineDiff(maskTokens(p.before), maskTokens(p.after)),
    changed: p.changed,
    creates: p.creates,
    warnings: p.warnings,
    baseHash: hashOf(text),
  };
}

/** Backup name next to the file, e.g. settings.json.dev-time-tracker-20261015-143000.bak */
function backupPathFor(file: string, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${file}.dev-time-tracker-${stamp}.bak`;
}

/** Make the previewed change, if the file is still the one previewed. */
export async function applyClaudeHooks(
  action: HookAction,
  baseHash: string,
): Promise<ClaudeHooksApplyResult> {
  const file = settingsPath();
  const fail = async (error: string, stale = false) => ({
    ok: false,
    error,
    stale,
    backupPath: null,
    status: await getClaudeHooksStatus(),
  });
  let text: string | null;
  try {
    text = await readText(file);
  } catch (err) {
    return fail(`Can't read ${file}: ${(err as Error)?.message ?? err}`);
  }
  if (hashOf(text) !== baseHash) {
    return fail("settings.json changed since the preview. Review the change again.", true);
  }
  if (action === "connect" && !pending) {
    return fail("Open the preview again.", true);
  }
  const p = await plan(action, text);
  if (!p.ok) return fail(p.error);

  let backupPath: string | null = null;
  try {
    if (p.changed) {
      if (text !== null) {
        backupPath = backupPathFor(file);
        await fs.promises.writeFile(backupPath, text, { encoding: "utf-8", flag: "wx" });
      }
      await writeAtomic(file, p.after);
    }
    if (action === "connect") {
      const ep = pending as HookEndpoint;
      await writeAtomic(configPath(), JSON.stringify(ep));
      endpoint = ep;
      pending = null;
      await startReceiver(ep);
    } else {
      await fs.promises.rm(configPath(), { force: true });
      endpoint = null;
      pending = null;
      receiverError = null;
      await stopReceiver();
      clearLiveAgents();
    }
  } catch (err) {
    logError("claudeHooks.apply", err);
    return { ...(await fail(`Couldn't write the change: ${(err as Error)?.message ?? err}`)), backupPath };
  }
  return { ok: true, backupPath, status: await getClaudeHooksStatus() };
}

/** At startup: listen again if the user connected Claude Code before. */
export async function initClaudeHooks() {
  endpoint = await loadConfig();
  if (endpoint) await startReceiver(endpoint);
}

export async function shutdownClaudeHooks() {
  await stopReceiver();
}

/**
 * The app is being uninstalled (Squirrel --squirrel-uninstall): take our
 * hooks out of Claude Code's settings, with a backup, so it doesn't keep
 * running curl for an app that's gone. Synchronous: the process exits next.
 */
export function removeClaudeHooksOnUninstall() {
  try {
    const file = settingsPath();
    const text = fs.readFileSync(file, "utf-8");
    const p = planUninstall(text);
    if (!p.ok || !p.changed) return;
    fs.writeFileSync(backupPathFor(file), text, { encoding: "utf-8", flag: "wx" });
    fs.writeFileSync(`${file}.dtt-tmp`, p.after, "utf-8");
    fs.renameSync(`${file}.dtt-tmp`, file);
  } catch {
    // no settings file, or not writable: nothing we can do while uninstalling
  }
}
