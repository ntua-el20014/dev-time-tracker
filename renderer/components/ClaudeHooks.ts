/**
 * Settings → Integrations → Connect Claude Code: opt-in hooks that tell the
 * app live what Claude Code sessions are doing. The change to Claude Code's
 * settings.json is always shown first (preview), and made only for the
 * file the user saw; main backs the file up and keeps other hooks.
 */
import { escapeHtml } from "../utils/domUtils";
import { safeIpcInvoke } from "../utils/ipcHelpers";
import { showModal } from "./Modals";
import { showInAppNotification } from "./Notifications";

type Action = "connect" | "disconnect";

interface Status {
  settingsPath: string;
  claudeFound: boolean;
  state: "connected" | "outdated" | "not-connected" | "invalid";
  saved: boolean;
  receiver: "listening" | "off" | "error";
  receiverError: string | null;
  port: number | null;
  error: string | null;
  warnings: string[];
  lastEventAt: string | null;
  eventsReceived: number;
}

interface Preview {
  ok: boolean;
  action: Action;
  error?: string;
  settingsPath: string;
  diff: { op: " " | "+" | "-" | "…"; text: string }[];
  changed: boolean;
  creates: boolean;
  warnings: string[];
  baseHash: string;
}

interface ApplyResult {
  ok: boolean;
  error?: string;
  stale?: boolean;
  backupPath: string | null;
  status: Status;
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** One line on where things stand, and whether it needs attention. */
function statusLine(s: Status): { text: string; warn: boolean } {
  if (s.state === "invalid") return { text: s.error ?? "settings.json can't be read.", warn: true };
  if (s.receiverError) return { text: s.receiverError, warn: true };
  if (s.state === "connected") {
    const last = s.lastEventAt
      ? `last event ${time(s.lastEventAt)} (${s.eventsReceived} this run)`
      : "no events yet — start a new Claude Code session";
    return { text: `Connected · listening on 127.0.0.1:${s.port} · ${last}`, warn: false };
  }
  if (s.state === "outdated") {
    return {
      text: s.saved
        ? "Claude Code's hooks for this app are incomplete or changed. Reconnect to fix them."
        : "settings.json has hooks from another copy (or an older install) of this app. Reconnect to use this one, or disconnect to remove them.",
      warn: true,
    };
  }
  if (s.saved) {
    return { text: "The hooks were removed from settings.json. Reconnect to add them again.", warn: true };
  }
  if (!s.claudeFound) return { text: "Claude Code isn't set up on this computer.", warn: false };
  return { text: "Not connected.", warn: false };
}

function diffElement(preview: Preview): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "hook-preview";
  const what =
    preview.action === "connect"
      ? preview.creates
        ? `The file doesn't exist yet; it will be created with:`
        : `A backup of the file is saved next to it first. Lines marked + are added (the line before them may gain a comma); nothing else changes.`
      : `A backup of the file is saved next to it first. Lines marked − are removed (with the comma before them); your other hooks and settings stay exactly as they are.`;
  const lines = preview.diff
    .map((l) => {
      const cls = l.op === "+" ? "add" : l.op === "-" ? "del" : l.op === "…" ? "fold" : "same";
      const mark = l.op === "-" ? "−" : l.op === "…" ? "" : l.op;
      return `<div class="hook-diff-line ${cls}"><span class="hook-diff-op">${mark}</span>${escapeHtml(l.op === "…" ? `⋯ ${l.text}` : l.text) || "&nbsp;"}</div>`;
    })
    .join("");
  wrap.innerHTML = `
    <p class="hook-preview-file"><code>${escapeHtml(preview.settingsPath)}</code></p>
    <p>${escapeHtml(what)}</p>
    ${preview.warnings.map((w) => `<p class="hook-warning">⚠ ${escapeHtml(w)}</p>`).join("")}
    <div class="hook-diff" role="region" aria-label="Change to settings.json">${lines}</div>
    ${
      preview.action === "connect"
        ? `<p class="info-note">For each of these events (UserPromptSubmit, PostToolUse, Notification, Stop, StopFailure, SessionEnd), Claude Code runs <code>curl</code> in the background to send it to this app on 127.0.0.1 only; when the app isn't running, that fails silently and never holds Claude up. The app keeps the event name, session id and working folder, and discards the rest of the event (your prompt, tool input/output, Claude's reply) without storing or uploading it. Applies to Claude Code sessions started from now on.</p>`
        : ""
    }`;
  return wrap;
}

async function openPreview(action: Action, onDone: () => void) {
  const preview = await safeIpcInvoke<Preview | null>("preview-claude-hooks", [action], {
    fallback: null,
  });
  if (!preview) {
    showInAppNotification("Could not prepare the change.", 3500, "error");
    return;
  }
  if (!preview.ok) {
    showInAppNotification(preview.error ?? "Could not prepare the change.", 6000, "error");
    return;
  }
  if (!preview.changed && action === "disconnect") {
    // Nothing of ours in the file; just forget the connection
    await apply(action, preview.baseHash, onDone);
    return;
  }
  showModal({
    title: action === "connect" ? "Connect Claude Code" : "Disconnect Claude Code",
    fields: [{ name: "preview", label: "", type: "custom", render: () => diffElement(preview) }],
    submitText: action === "connect" ? "Add hooks" : "Remove hooks",
    onSubmit: () => void apply(action, preview.baseHash, onDone),
  });
}

async function apply(action: Action, baseHash: string, onDone: () => void) {
  const result = await safeIpcInvoke<ApplyResult | null>(
    "apply-claude-hooks",
    [{ action, baseHash }],
    { fallback: null },
  );
  if (!result) {
    showInAppNotification("Could not change Claude Code's settings.", 4000, "error");
  } else if (result.stale) {
    showInAppNotification(result.error ?? "settings.json changed. Review the change again.", 5000, "warning");
    void openPreview(action, onDone);
    return;
  } else if (!result.ok) {
    showInAppNotification(result.error ?? "Could not change Claude Code's settings.", 6000, "error");
  } else {
    // Just the name: it's next to settings.json
    const backup = result.backupPath
      ? ` Backup saved next to it: ${result.backupPath.split(/[\\/]/).pop()}`
      : "";
    showInAppNotification(
      action === "connect"
        ? `Claude Code connected. New Claude Code sessions report to the app.${backup}`
        : `Claude Code disconnected; the app's hooks were removed.${backup}`,
      7000,
      "success",
    );
  }
  onDone();
}

export async function renderClaudeHooks(container: HTMLElement) {
  const status = await safeIpcInvoke<Status | null>("get-claude-hooks-status", [], {
    fallback: null,
    showNotification: false,
  });
  if (!status) {
    container.innerHTML = "";
    return;
  }
  const line = statusLine(status);
  const connected = status.state === "connected" && !status.receiverError;
  const hasOurs = status.state === "connected" || status.state === "outdated" || status.saved;
  const canConnect = status.claudeFound && status.state !== "invalid";

  container.innerHTML = `
    <div class="claude-hooks">
      <h4>Connect Claude Code <span class="badge-optional">optional</span></h4>
      <p>
        Lets Claude Code tell the app <b>as it happens</b> when a session is
        working, waiting for you, or done: Supervising starts right away,
        long-running tools count as agent work, and a terminal running
        <code>claude</code> is matched to its repo. It adds hooks to
        <code>${escapeHtml(status.settingsPath)}</code> — you see the exact
        change first, the file is backed up, and your own hooks are kept.
      </p>
      <div class="info-note${line.warn ? " hook-warning" : ""}" id="claudeHooksStatus">${escapeHtml(line.text)}</div>
      ${status.warnings.map((w) => `<div class="info-note hook-warning">⚠ ${escapeHtml(w)}</div>`).join("")}
      <div class="agent-actions">
        ${
          connected
            ? ""
            : `<button type="button" id="claudeHooksConnectBtn" class="open-lang-json-btn" ${canConnect ? "" : "disabled"}>${hasOurs ? "Reconnect" : "Connect Claude Code"}…</button>`
        }
        ${hasOurs ? `<button type="button" id="claudeHooksDisconnectBtn" class="btn-cancel">Disconnect…</button>` : ""}
      </div>
    </div>`;

  const rerender = () => void renderClaudeHooks(container);
  container
    .querySelector("#claudeHooksConnectBtn")
    ?.addEventListener("click", () => void openPreview("connect", rerender));
  container
    .querySelector("#claudeHooksDisconnectBtn")
    ?.addEventListener("click", () => void openPreview("disconnect", rerender));
}
