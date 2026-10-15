/**
 * Settings → Integrations → AI coding agents: whether the app reads Claude
 * Code / Codex session logs (metadata only), its sync status, the agent
 * sessions it recorded this week, and Connect Claude Code (live hooks).
 */
import { escapeHtml } from "../utils/domUtils";
import { safeIpcInvoke } from "../utils/ipcHelpers";
import { getLocalDateString } from "../../src/utils/timeFormat";
import { showConfirmationModal } from "./Modals";
import { showInAppNotification } from "./Notifications";
import { renderClaudeHooks } from "./ClaudeHooks";

interface Status {
  enabled: boolean;
  transcriptsFound: number;
  lastRunAt: string | null;
  pending: number;
  lastError: string | null;
}

interface AgentSession {
  id: string;
  source: "claude-code" | "codex";
  repo_name: string | null;
  project_id: string | null;
  started_at: string;
  active_seconds: number;
  prompts: number;
  tool_calls: number;
  files_changed: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number | null;
}

const AGENT_NAMES: Record<AgentSession["source"], string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

function hm(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

function statusLine(s: Status): string {
  if (!s.enabled) return "Off — nothing is read or uploaded.";
  const parts = [
    `${s.transcriptsFound} session log${s.transcriptsFound === 1 ? "" : "s"} found`,
    s.lastRunAt
      ? `last synced ${new Date(s.lastRunAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : "first sync within a minute",
  ];
  if (s.lastError === "offline") parts.push(`offline — ${s.pending} waiting to upload`);
  else if (s.lastError) parts.push(`last sync failed: ${s.lastError}`);
  else if (s.pending) parts.push(`${s.pending} waiting to upload`);
  return parts.join(" · ");
}

function sessionsTable(sessions: AgentSession[], projects: Map<string, string>): string {
  if (sessions.length === 0) {
    return `<p class="info-note">No agent sessions in the last 7 days.</p>`;
  }
  const rows = sessions
    .map((s) => {
      const tokens = s.input_tokens + s.output_tokens + s.cache_read_tokens + s.cache_write_tokens;
      const project = s.project_id ? projects.get(s.project_id) : null;
      return `<tr>
        <td>${escapeHtml(new Date(s.started_at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }))}</td>
        <td>${escapeHtml(AGENT_NAMES[s.source] ?? s.source)}</td>
        <td>${escapeHtml(s.repo_name ?? "—")}${project ? ` <span class="agent-project">→ ${escapeHtml(project)}</span>` : ""}</td>
        <td>${hm(s.active_seconds)}</td>
        <td>${s.prompts}</td>
        <td>${s.files_changed}</td>
        <td title="${tokens.toLocaleString()} tokens">${compact(tokens)}</td>
        <td>${s.cost_usd != null ? `$${Number(s.cost_usd).toFixed(2)}` : "—"}</td>
      </tr>`;
    })
    .join("");
  return `
    <div class="agent-sessions-table">
      <table>
        <thead><tr>
          <th>Started</th><th>Agent</th><th>Repo → project</th><th>Active</th>
          <th>Prompts</th><th>Files</th><th>Tokens</th><th>Cost</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

export async function renderAgentIntegration(container: HTMLElement) {
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 6 * 86_400_000);
  const [status, sessions, projects] = await Promise.all([
    safeIpcInvoke<Status | null>("get-agent-integration", [], {
      fallback: null,
      showNotification: false,
    }),
    safeIpcInvoke<AgentSession[]>(
      "get-agent-sessions",
      [{ startDate: getLocalDateString(weekAgo), endDate: getLocalDateString(today) }],
      { fallback: [], showNotification: false },
    ),
    safeIpcInvoke<{ id: string; name: string }[]>("get-projects-for-user", [], {
      fallback: [],
      showNotification: false,
    }),
  ]);
  if (!status) {
    container.innerHTML = "";
    return;
  }
  const projectNames = new Map((projects ?? []).map((p) => [p.id, p.name]));

  container.innerHTML = `
    <div class="language-pie-info agent-integration">
      <b>AI coding agents</b>
      <p>
        Reads the session logs Claude Code and Codex keep on this computer and
        records, per agent session: when it ran, the repo (and its linked
        project), prompt/tool/file counts, tokens and cost.
        <b>Never</b> your prompts, the agent's answers or file names.
      </p>
      <label class="agent-toggle">
        <input type="checkbox" id="agentIngestToggle" ${status.enabled ? "checked" : ""}>
        Record AI agent sessions
      </label>
      <div class="info-note" id="agentIngestStatus">${escapeHtml(statusLine(status))}</div>
      <div class="agent-actions">
        <button type="button" id="agentSyncBtn" class="open-lang-json-btn" ${status.enabled ? "" : "disabled"}>Sync now</button>
        <button type="button" id="agentDeleteBtn" class="btn-cancel">Delete uploaded agent data</button>
      </div>
      <h4>Last 7 days</h4>
      ${sessionsTable(sessions ?? [], projectNames)}
      <div id="claudeHooks"></div>
    </div>
  `;

  const hooks = container.querySelector<HTMLElement>("#claudeHooks");
  if (hooks) void renderClaudeHooks(hooks);

  const rerender = () => void renderAgentIntegration(container);

  container.querySelector("#agentIngestToggle")?.addEventListener("change", async (e) => {
    const enabled = (e.target as HTMLInputElement).checked;
    const next = await safeIpcInvoke<Status | null>("set-agent-integration", [enabled], {
      fallback: null,
    });
    if (!next) showInAppNotification("Could not change the setting.", 3500, "error");
    rerender();
  });

  container.querySelector("#agentSyncBtn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "Syncing…";
    await safeIpcInvoke("sync-agent-sessions", [], { fallback: null });
    rerender();
  });

  container.querySelector("#agentDeleteBtn")?.addEventListener("click", () => {
    showConfirmationModal({
      title: "Delete agent data",
      message:
        "This deletes every AI agent session the app uploaded for you and turns recording off. Your agents' own logs are not touched.",
      confirmText: "Delete",
      confirmClass: "btn-delete",
      onConfirm: async () => {
        const ok = await safeIpcInvoke<boolean>("delete-agent-data", [], { fallback: false });
        showInAppNotification(
          ok ? "Agent data deleted." : "Could not delete the agent data.",
          3500,
          ok ? "success" : "error",
        );
        rerender();
      },
    });
  });
}
