/**
 * Pure: the "Connect Claude Code" change to Claude Code's user settings
 * (~/.claude/settings.json). Adds one hook per event that posts the event
 * to the app's local receiver (claudeHooks.ts), next to whatever hooks the
 * user already has, and removes exactly those again.
 *
 * The hook runs `curl` in the background (`async`, exec form: no shell, so
 * it's the same under Git Bash, PowerShell and sh). Claude Code's own HTTP
 * hooks would need no process, but whenever the app isn't running they
 * fail visibly ("Stop hook error" after every turn); a background command
 * that can't connect stays silent and never holds Claude up.
 *
 * Our entries are recognised by the receiver URL in them (127.0.0.1,
 * HOOK_PATH), so no extra keys are written: Claude Code validates its
 * settings. The file is edited as text: everything else keeps its exact
 * bytes, new lines follow the file's indentation and line endings, and
 * removing our hooks gives back the file as it was. If the file isn't JSON
 * we leave it alone.
 */

import {
  appendElement,
  applyEdits,
  memberOf,
  parseSpans,
  removeElements,
  type TextEdit,
} from "../utils/jsonTextEdit";

export const HOOK_PATH = "/dev-time-tracker/claude-hook";

/**
 * The events we listen to. PostToolUse is purely observational; the others
 * mark prompts, turns ending, waiting for the user, and the session ending.
 */
export const HOOK_EVENTS = [
  "UserPromptSubmit",
  "PostToolUse",
  "Notification",
  "Stop",
  "StopFailure",
  "SessionEnd",
] as const;
export type HookEventName = (typeof HOOK_EVENTS)[number];

/** curl gives up after this many seconds; the receiver answers at once. */
export const HOOK_TIMEOUT_SECONDS = 2;

export interface HookEndpoint {
  port: number;
  token: string;
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const OUR_URL = /^http:\/\/(?:127\.0\.0\.1|localhost):(\d{1,5})(\/[^?#]*)$/;

export function hookUrl(port: number): string {
  return `http://127.0.0.1:${port}${HOOK_PATH}`;
}

/** curl posts the event JSON (stdin) to the receiver; the reply is empty. */
export function hookEntry(endpoint: HookEndpoint) {
  return {
    type: "command",
    command: "curl",
    args: [
      "-s",
      "-m",
      String(HOOK_TIMEOUT_SECONDS),
      "-H",
      "Content-Type: application/json",
      "-H",
      `Authorization: Bearer ${endpoint.token}`,
      "--data-binary",
      "@-",
      hookUrl(endpoint.port),
    ],
    async: true,
  };
}

/** The receiver URL a hook of ours posts to, or null if it isn't ours. */
function ourUrl(hook: unknown): RegExpExecArray | null {
  if (!isObject(hook)) return null;
  const candidates =
    hook.type === "command" &&
    typeof hook.command === "string" &&
    /^curl(\.exe)?$/i.test(hook.command) &&
    Array.isArray(hook.args)
      ? hook.args
      : hook.type === "http"
        ? [hook.url]
        : [];
  for (const c of candidates) {
    const m = typeof c === "string" ? OUR_URL.exec(c) : null;
    if (m && m[2] === HOOK_PATH) return m;
  }
  return null;
}

/** One of the hooks this app installs (any port or token). */
export function isOurHook(hook: unknown): boolean {
  return ourUrl(hook) !== null;
}

/** Is this hook exactly the one we'd write for this endpoint? */
function matchesEndpoint(hook: unknown, endpoint: HookEndpoint): boolean {
  if (!isObject(hook)) return false;
  const want = hookEntry(endpoint);
  return (
    hook.type === want.type &&
    hook.command === want.command &&
    hook.async === true &&
    JSON.stringify(hook.args) === JSON.stringify(want.args)
  );
}

function portOf(hook: unknown): number | null {
  const m = ourUrl(hook);
  return m ? Number(m[1]) : null;
}

// ── Parsing and writing ─────────────────────────────────────────────

export interface FileFormat {
  indent: string;
  eol: "\n" | "\r\n";
  finalNewline: boolean;
}

const DEFAULT_FORMAT: FileFormat = { indent: "  ", eol: "\n", finalNewline: true };

export type ParsedSettings =
  | { ok: true; settings: Json; format: FileFormat; exists: boolean }
  | { ok: false; error: string };

function detectFormat(text: string): FileFormat {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const indented = /\n([ \t]+)\S/.exec(text);
  return {
    indent: indented ? indented[1] : DEFAULT_FORMAT.indent,
    eol,
    finalNewline: /\n$/.test(text) || text.trim() === "",
  };
}

/** `text` is the file's contents, or null if there is no file. */
export function parseSettings(text: string | null): ParsedSettings {
  if (text === null || text.replace(/^\uFEFF/, "").trim() === "") {
    return { ok: true, settings: {}, format: DEFAULT_FORMAT, exists: text !== null };
  }
  const body = text.replace(/^\uFEFF/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {
      ok: false,
      error: "settings.json isn't valid JSON, so it was left alone. Fix it (or Claude Code will ignore it) and try again.",
    };
  }
  if (!isObject(parsed)) {
    return { ok: false, error: "settings.json doesn't contain a JSON object, so it was left alone." };
  }
  if (parsed.hooks !== undefined) {
    if (!isObject(parsed.hooks)) {
      return { ok: false, error: `"hooks" in settings.json isn't an object, so it was left alone.` };
    }
    for (const [event, groups] of Object.entries(parsed.hooks)) {
      if (!Array.isArray(groups)) {
        return { ok: false, error: `"hooks.${event}" in settings.json isn't a list, so it was left alone.` };
      }
    }
  }
  return { ok: true, settings: parsed, format: detectFormat(text), exists: true };
}

export function serializeSettings(settings: Json, format: FileFormat): string {
  let out = JSON.stringify(settings, null, format.indent);
  if (format.eol === "\r\n") out = out.replace(/\n/g, "\r\n");
  return format.finalNewline ? out + format.eol : out;
}

// ── Changes ─────────────────────────────────────────────────────────
// Made as text edits (jsonTextEdit.ts), so the rest of the file keeps its
// exact bytes and Disconnect gives back the file as it was before Connect.

/** Edits that remove every hook of ours; groups and events emptied by that go too. */
function removalEdits(text: string): { edits: TextEdit[]; removed: number } {
  const root = parseSpans(text);
  const hooksMember = memberOf(root, "hooks");
  if (!hooksMember || hooksMember.value.kind !== "object") return { edits: [], removed: 0 };
  const hooksObj = hooksMember.value;
  const edits: TextEdit[] = [];
  const emptiedEvents = new Set<number>();
  let removed = 0;

  hooksObj.members.forEach((event, e) => {
    if (event.value.kind !== "array") return;
    const emptiedGroups = new Set<number>();
    const groupEdits: TextEdit[] = [];
    event.value.items.forEach((group, g) => {
      const list = memberOf(group, "hooks")?.value;
      if (list?.kind !== "array") return;
      const ours = new Set<number>();
      list.items.forEach((hook, h) => {
        if (isOurHook(JSON.parse(text.slice(hook.start, hook.end)))) ours.add(h);
      });
      if (ours.size === 0) return;
      removed += ours.size;
      if (ours.size === list.items.length) emptiedGroups.add(g);
      else groupEdits.push(...removeElements(list, ours));
    });
    if (emptiedGroups.size > 0 && emptiedGroups.size === event.value.items.length) {
      emptiedEvents.add(e);
    } else {
      edits.push(...groupEdits, ...removeElements(event.value, emptiedGroups));
    }
  });

  if (emptiedEvents.size > 0 && emptiedEvents.size === hooksObj.members.length && root.kind === "object") {
    // Nothing left under "hooks": remove the key too
    edits.push(...removeElements(root, new Set([root.members.indexOf(hooksMember)])));
  } else {
    edits.push(...removeElements(hooksObj, emptiedEvents));
  }
  return { edits, removed };
}

export type HookPlan =
  | {
      ok: true;
      before: string;
      after: string;
      changed: boolean;
      /** The file doesn't exist yet and would be created */
      creates: boolean;
      warnings: string[];
    }
  | { ok: false; error: string };

/** Add our hook to every event (replacing older ones of ours). */
export function planInstall(text: string | null, endpoint: HookEndpoint): HookPlan {
  const parsed = parseSettings(text);
  if (!parsed.ok) return parsed;
  const before = text ?? "";
  const warnings = settingsWarnings(parsed.settings, endpoint.port);
  if (hookStatus(text, endpoint).state === "connected") {
    return { ok: true, before, after: before, changed: false, creates: false, warnings };
  }

  const group = { hooks: [hookEntry(endpoint)] };
  let after: string;
  if (Object.keys(parsed.settings).length === 0) {
    // No file, an empty one, or "{}": write it out whole
    const hooks = Object.fromEntries(HOOK_EVENTS.map((e) => [e, [group]]));
    const bom = before.startsWith("\uFEFF") ? "\uFEFF" : "";
    after = bom + serializeSettings({ hooks }, parsed.format);
  } else {
    after = applyEdits(before, removalEdits(before).edits);
    const format = { indent: parsed.format.indent, eol: parsed.format.eol };
    for (const event of HOOK_EVENTS) {
      // One edit at a time, on fresh spans: several appends can't collide
      const root = parseSpans(after);
      const hooks = memberOf(root, "hooks")?.value;
      if (!hooks) {
        const all = Object.fromEntries(HOOK_EVENTS.map((e) => [e, [group]]));
        after = applyEdits(after, [appendElement(after, root, all, format, "hooks")]);
        break;
      }
      const list = memberOf(hooks, event)?.value;
      after = applyEdits(after, [
        list
          ? appendElement(after, list, group, format)
          : appendElement(after, hooks, [group], format, event),
      ]);
    }
  }
  return { ok: true, before, after, changed: after !== before, creates: text === null, warnings };
}

/** Remove every hook of ours, leaving the rest exactly as it was. */
export function planUninstall(text: string | null): HookPlan {
  const parsed = parseSettings(text);
  if (!parsed.ok) return parsed;
  const before = text ?? "";
  const { edits, removed } = before.trim() ? removalEdits(before) : { edits: [], removed: 0 };
  const after = removed > 0 ? applyEdits(before, edits) : before;
  return { ok: true, before, after, changed: after !== before, creates: false, warnings: [] };
}

/** Settings in this file that would stop our hooks from running. */
export function settingsWarnings(settings: Json, port: number): string[] {
  const warnings: string[] = [];
  if (settings.disableAllHooks === true) {
    warnings.push(
      `"disableAllHooks" is on in this file, so Claude Code won't run any hooks until it's turned off.`,
    );
  }
  const allowed = settings.allowedHttpHookUrls;
  if (Array.isArray(allowed)) {
    const url = hookUrl(port);
    if (!allowed.some((p) => typeof p === "string" && globMatch(p, url))) {
      warnings.push(
        `"allowedHttpHookUrls" doesn't include ${url}, so Claude Code won't call it. Add "http://127.0.0.1:*" to that list.`,
      );
    }
  }
  return warnings;
}

function globMatch(pattern: string, value: string): boolean {
  const re = pattern
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${re}$`).test(value);
}

export type HookInstallState =
  /** Our hook on every event, for this endpoint */
  | "connected"
  /** Some of ours, or for another port/token (another copy of the app, or an old install) */
  | "outdated"
  | "not-connected"
  /** The file can't be read as settings */
  | "invalid";

export interface HookStatus {
  state: HookInstallState;
  /** Events that have a hook of ours */
  events: HookEventName[];
  /** Port our hooks point at (the first found), if any */
  port: number | null;
  error?: string;
  warnings: string[];
}

/** What the file says, compared to the endpoint this app listens on (if any). */
export function hookStatus(text: string | null, endpoint: HookEndpoint | null): HookStatus {
  const parsed = parseSettings(text);
  if (!parsed.ok) {
    return { state: "invalid", events: [], port: null, error: parsed.error, warnings: [] };
  }
  const hooks = isObject(parsed.settings.hooks) ? parsed.settings.hooks : {};
  const events: HookEventName[] = [];
  let complete = endpoint !== null;
  let port: number | null = null;
  for (const event of HOOK_EVENTS) {
    const all = (Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [])
      .flatMap((g) => (isObject(g) && Array.isArray(g.hooks) ? g.hooks : []));
    const ours = all.filter(isOurHook);
    if (ours.length > 0) events.push(event);
    port ??= ours.map(portOf).find((p) => p !== null) ?? null;
    if (!endpoint || ours.length !== 1 || !matchesEndpoint(ours[0], endpoint)) {
      complete = false;
    }
  }
  // Any other event with our hook on it (e.g. from a newer version) also counts
  const extra = Object.entries(hooks).some(
    ([event, groups]) =>
      !(HOOK_EVENTS as readonly string[]).includes(event) &&
      Array.isArray(groups) &&
      groups.some((g) => isObject(g) && Array.isArray(g.hooks) && g.hooks.some(isOurHook)),
  );
  const state: HookInstallState =
    complete && !extra
      ? "connected"
      : events.length > 0 || extra
        ? "outdated"
        : "not-connected";
  return {
    state,
    events,
    port,
    warnings: endpoint ? settingsWarnings(parsed.settings, endpoint.port) : [],
  };
}

// ── Preview ─────────────────────────────────────────────────────────

export interface DiffLine {
  /** " " unchanged, "+" added, "-" removed, "…" unchanged lines left out */
  op: " " | "+" | "-" | "…";
  text: string;
}

/** Line diff of two small texts, with `context` unchanged lines around changes. */
export function lineDiff(before: string, after: string, context = 3): DiffLine[] {
  const a = before === "" ? [] : before.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const b = after === "" ? [] : after.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const full: DiffLine[] = [];
  if (a.length * b.length > 4_000_000) {
    // Too big to diff line by line; settings files never are
    for (const text of a) full.push({ op: "-", text });
    for (const text of b) full.push({ op: "+", text });
  } else {
    // Longest common subsequence, from the end
    const n = a.length;
    const m = b.length;
    const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) {
        full.push({ op: " ", text: a[i] });
        i++;
        j++;
      } else if (i < n && (j >= m || lcs[i + 1][j] >= lcs[i][j + 1])) {
        full.push({ op: "-", text: a[i++] });
      } else {
        full.push({ op: "+", text: b[j++] });
      }
    }
  }

  // Keep `context` lines around changes, fold the rest
  const keep = full.map(() => false);
  full.forEach((line, k) => {
    if (line.op === " ") return;
    for (let c = Math.max(0, k - context); c <= Math.min(full.length - 1, k + context); c++) {
      keep[c] = true;
    }
  });
  const out: DiffLine[] = [];
  let skipped = 0;
  full.forEach((line, k) => {
    if (keep[k]) {
      if (skipped) out.push({ op: "…", text: `${skipped} unchanged line${skipped === 1 ? "" : "s"}` });
      skipped = 0;
      out.push(line);
    } else {
      skipped++;
    }
  });
  if (skipped) out.push({ op: "…", text: `${skipped} unchanged line${skipped === 1 ? "" : "s"}` });
  return out;
}
