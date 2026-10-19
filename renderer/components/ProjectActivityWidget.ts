/**
 * Home's "Last 7 days by project" (C6): per project, your time (with the
 * supervising part), AI agent time and reported cost, and code changed.
 * Agent time runs alongside yours, so the two are shown side by side.
 * Refreshes itself after agent sessions sync, without re-rendering Home.
 */
import { ipcRenderer } from "../ipc";
import { escapeHtml } from "../utils/domUtils";
import { safeIpcInvoke } from "../utils/ipcHelpers";
import { navigateTo } from "../navigation";
import { getLocalDateString } from "../../src/utils/timeFormat";
import {
  busiestProjects,
  formatAgentTotals,
  formatSpan,
  type ProjectActivity,
} from "../../shared/projectActivity";
import { formatCodeTotals } from "../../shared/codeStats";

const DAYS = 7;
const MAX_ROWS = 5;

let mounted: HTMLElement | null = null;

function rowHtml(
  a: ProjectActivity,
  project: { name: string; color?: string | null } | undefined,
): string {
  const yours = a.humanSeconds + a.supervisingSeconds;
  const cells: string[] = [];
  if (a.sessions > 0) {
    cells.push(
      `<span title="Your sessions: time with input, plus time supervising an AI agent">You ${escapeHtml(formatSpan(yours))}${
        a.supervisingSeconds >= 60
          ? ` <span class="home-projects-sub">(${escapeHtml(formatSpan(a.supervisingSeconds))} supervising)</span>`
          : ""
      }</span>`,
    );
  }
  if (a.agent.sessions > 0) {
    cells.push(
      `<span title="Claude Code / Codex in this project's linked repos; cost as reported">AI agents ${escapeHtml(formatAgentTotals(a.agent))}</span>`,
    );
  }
  const code = formatCodeTotals(a.code);
  if (code) cells.push(`<span title="From git at the end of your sessions">${escapeHtml(code)}</span>`);
  return `
    <li class="home-projects-row">
      <span class="home-projects-name">
        <span class="home-projects-dot" style="${project?.color ? `background:${escapeHtml(project.color)}` : ""}" aria-hidden="true"></span>
        ${escapeHtml(project?.name ?? "Archived project")}
      </span>
      <span class="home-projects-cells">${cells.join('<span class="home-projects-sep" aria-hidden="true">·</span>')}</span>
    </li>`;
}

export async function renderProjectActivityWidget(container: HTMLElement) {
  mounted = container;
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (DAYS - 1));
  const [activity, projects] = await Promise.all([
    safeIpcInvoke<ProjectActivity[]>(
      "get-project-activity",
      [{ startDate: getLocalDateString(from), endDate: getLocalDateString(today) }],
      { fallback: [], showNotification: false },
    ),
    safeIpcInvoke<{ id: string; name: string; color?: string | null }[]>(
      "get-projects-for-user",
      [],
      { fallback: [], showNotification: false },
    ),
  ]);
  if (mounted !== container) return; // re-rendered meanwhile
  const names = new Map((projects ?? []).map((p) => [p.id, p]));
  const top = busiestProjects(activity ?? [], MAX_ROWS);

  container.innerHTML = `
    <section class="home-projects" aria-label="Last ${DAYS} days by project">
      <div class="home-projects-header">
        <h3>Last ${DAYS} days by project</h3>
        <button type="button" class="link-btn home-projects-link">All projects →</button>
      </div>
      ${
        top.length
          ? `<ul class="home-projects-list">${top.map((a) => rowHtml(a, names.get(a.projectId))).join("")}</ul>`
          : `<p class="home-projects-empty">No sessions or agent work in a project this week. Pick a project before Start, or link a repo to one, and it shows up here.</p>`
      }
    </section>`;
  container
    .querySelector(".home-projects-link")
    ?.addEventListener("click", () => navigateTo("projects"));
}

// Agents work in the background: refresh just this widget when they sync
ipcRenderer.on("agent-sessions-synced", () => {
  if (mounted?.isConnected) void renderProjectActivityWidget(mounted);
});
