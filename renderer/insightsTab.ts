/**
 * Sessions → Insights: what got built (C2: lines changed per language and
 * repo, from git, over the sessions of the last 30 days), where attention
 * went (foreground-window samples: editor and language breakdowns, and
 * what browser time was for, C5), and the daily goal history.
 */
import { escapeHtml } from "./utils/domUtils";
import { getLocalDateString } from "../src/utils/timeFormat";
import {
  addCodeStats,
  emptyTotals,
  formatCodeTotals,
} from "../shared/codeStats";
import type { SessionRow } from "../shared/types";
import { renderPercentBar, renderPieChartJS } from "./components";
import { browserCategoryLabel } from "../shared/browserCategories";
import { formatTimeSpent } from "../src/utils/timeFormat";
import { prettyDate, safeIpcInvoke, withLoading } from "./utils";

let rerenderPieChart: (() => void) | null = null;

export async function renderInsights() {
  const container = document.getElementById("insightsContent");
  if (!container) return;

  container.innerHTML = `
    <h1>Insights</h1>
    <section id="insights-code" class="insights-section"></section>
    <p class="info-note">
      Where your attention went, based on the app and file in the foreground
      while you were recording.
    </p>
    <section id="insights-editors" class="insights-section"></section>
    <section id="insights-languages" class="insights-section"></section>
    <section id="insights-browser" class="insights-section"></section>
    <section id="insights-goals" class="insights-section"></section>
  `;

  const sections: [string, (el: HTMLElement) => Promise<void>][] = [
    ["insights-code", renderCodeChanged],
    ["insights-editors", renderEditorUsage],
    ["insights-languages", renderLanguageUsage],
    ["insights-browser", renderBrowserUsage],
    ["insights-goals", renderDailyGoalHistory],
  ];
  await Promise.all(
    sections.map(async ([id, render]) => {
      const el = container.querySelector<HTMLElement>(`#${id}`);
      if (el) await withLoading(el, "Loading…", () => render(el));
    }),
  );
}

const CODE_DAYS = 30;
const CODE_COLORS = ["#4f8cff", "#ffb347", "#7ed957", "#ff6961", "#b19cd9", "#f67280", "#355c7d"];

/** What the sessions produced, from git: lines per language and per repo. */
async function renderCodeChanged(container: HTMLElement) {
  const end = new Date();
  const start = new Date(end.getTime() - (CODE_DAYS - 1) * 86_400_000);
  const sessions = await safeIpcInvoke<SessionRow[]>(
    "get-sessions",
    [{ startDate: getLocalDateString(start), endDate: getLocalDateString(end) }],
    { fallback: [] },
  );
  const totals = emptyTotals();
  const byRepo = new Map<string, { name: string; added: number; removed: number }>();
  for (const s of sessions ?? []) {
    addCodeStats(totals, s.code_stats);
    for (const r of s.code_stats ?? []) {
      const e = byRepo.get(r.repo_key) ?? { name: r.repo_name, added: 0, removed: 0 };
      e.added += r.lines_added || 0;
      e.removed += r.lines_removed || 0;
      byRepo.set(r.repo_key, e);
    }
  }
  const summary = formatCodeTotals(totals);
  if (!summary) {
    container.innerHTML = `<h2>Code changed</h2><p>No changes from git in the last ${CODE_DAYS} days yet. When you stop a session, the app counts the commits you made and the lines you changed in the repos you (or an AI agent) worked in.</p>`;
    return;
  }

  const languages = Object.entries(totals.languages)
    .map(([lang, n]) => ({ lang, ...n, lines: n.added + n.removed }))
    .filter((l) => l.lines > 0)
    .sort((a, b) => b.lines - a.lines);
  const allLines = languages.reduce((sum, l) => sum + l.lines, 0);
  const shown = languages.slice(0, 6);
  const rest = allLines - shown.reduce((sum, l) => sum + l.lines, 0);
  const items = shown.map((l, i) => ({
    label: l.lang,
    percent: (l.lines / allLines) * 100,
    color: CODE_COLORS[i % CODE_COLORS.length],
  }));
  if (rest > 0) items.push({ label: "Other", percent: (rest / allLines) * 100, color: "#8a8f98" });
  const repos = [...byRepo.values()].sort((a, b) => b.added + b.removed - (a.added + a.removed));

  container.innerHTML = `
    <h2>Code changed <span class="insights-sub">from git, last ${CODE_DAYS} days</span></h2>
    <p class="insights-code-total">${escapeHtml(summary)}</p>
    ${allLines > 0 ? renderPercentBar(items) : ""}
    <div class="insights-code-columns">
      <ul class="editor-usage-list">
        ${shown
          .map(
            (l, i) => `<li class="editor-usage-item">
              <span class="editor-usage-app" style="color:${CODE_COLORS[i % CODE_COLORS.length]};">${escapeHtml(l.lang)}</span>
              <span class="editor-usage-time">+${l.added.toLocaleString()} −${l.removed.toLocaleString()}</span>
            </li>`,
          )
          .join("")}
      </ul>
      <ul class="editor-usage-list">
        ${repos
          .slice(0, 6)
          .map(
            (r) => `<li class="editor-usage-item">
              <span class="editor-usage-app">${escapeHtml(r.name)}</span>
              <span class="editor-usage-time">+${r.added.toLocaleString()} −${r.removed.toLocaleString()}</span>
            </li>`,
          )
          .join("")}
      </ul>
    </div>
    <p class="info-note">Commits you made during sessions, plus changes still uncommitted when you stopped, in the repos you or an AI agent worked in. Lock files aren't counted.</p>
  `;
}

/** What browser time was for (C5), last CODE_DAYS days. */
async function renderBrowserUsage(container: HTMLElement) {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (CODE_DAYS - 1));
  const usage = await safeIpcInvoke<{ category: string | null; seconds: number }[]>(
    "get-browser-usage",
    [{ startDate: getLocalDateString(start), endDate: getLocalDateString(end) }],
    { fallback: [], showNotification: false },
  );
  const total = (usage ?? []).reduce((sum, c) => sum + c.seconds, 0);
  if (!total) {
    container.innerHTML = `<h2>Browser time</h2><p>No browser time in the last ${CODE_DAYS} days yet. While you record, time in a browser is sorted into code review, docs, AI chat and so on, from the page title (or address).</p>`;
    return;
  }
  // Unclassified time last, in grey
  const rows = [...usage].sort((a, b) => Number(a.category === null) - Number(b.category === null) || b.seconds - a.seconds);
  let color = 0;
  const colorOf = (c: string | null) => (c === null ? "#8a8f98" : CODE_COLORS[color++ % CODE_COLORS.length]);
  const items = rows.map((c) => ({
    label: browserCategoryLabel(c.category),
    percent: (c.seconds / total) * 100,
    color: colorOf(c.category),
    seconds: c.seconds,
  }));
  container.innerHTML = `
    <h2>Browser time <span class="insights-sub">last ${CODE_DAYS} days</span></h2>
    ${renderPercentBar(items)}
    <ul class="editor-usage-list">
      ${items
        .map(
          (i) => `<li class="editor-usage-item">
            <span class="editor-usage-app" style="color:${i.color};">${escapeHtml(i.label)}</span>
            <span class="editor-usage-time">${escapeHtml(formatTimeSpent(i.seconds))}</span>
          </li>`,
        )
        .join("")}
    </ul>
    <p class="info-note">Sorted on this computer from the page title, or the address when the title says nothing. Only the category is saved, never the address.</p>
  `;
}

async function renderEditorUsage(container: HTMLElement) {
  type EditorUsageRow = { app: string; total_time: number };
  const usage: EditorUsageRow[] = await safeIpcInvoke("get-editor-usage", [], {
    fallback: [],
  });
  if (!usage || usage.length === 0) {
    container.innerHTML = `<h2>Editor Usage Breakdown</h2><p>No data yet. Record a session to see which editors you use.</p>`;
    return;
  }
  const config: Record<string, string> = await safeIpcInvoke(
    "get-editor-colors",
    [],
    { fallback: {} as Record<string, string> },
  );
  const defaultColors = ["#4f8cff", "#ffb347", "#7ed957", "#ff6961", "#b19cd9"];
  const colorMap: { [key: string]: string } = {};
  usage.forEach((row: EditorUsageRow, i: number) => {
    colorMap[row.app] =
      config[row.app] || defaultColors[i % defaultColors.length];
  });
  usage.sort(
    (a: EditorUsageRow, b: EditorUsageRow) => b.total_time - a.total_time,
  );
  const total = usage.reduce(
    (sum: number, row: EditorUsageRow) => sum + row.total_time,
    0,
  );
  const items = usage.map((row: EditorUsageRow) => ({
    label: row.app,
    percent: (row.total_time / total) * 100,
    color: colorMap[row.app],
  }));
  container.innerHTML = `
    <h2>Editor Usage Breakdown</h2>
    ${renderPercentBar(items)}
    <ul class="editor-usage-list">
      ${usage
        .map((row: EditorUsageRow) => {
          const percent = ((row.total_time / total) * 100).toFixed(1);
          const color = colorMap[row.app];
          return `<li class="editor-usage-item">
          <span class="editor-usage-app" style="color:${color};">${escapeHtml(row.app)}</span>
          <span class="editor-usage-percent">${percent}%</span>
          <div class="color-picker-wrapper" data-app="${escapeHtml(row.app)}" style="background-color: ${color};">
            <input type="color" value="${color}" data-app="${escapeHtml(row.app)}" class="editor-color-input" />
          </div>
        </li>`;
        })
        .join("")}
    </ul>
    <div class="info-note">
      Pick your color for each editor and press <b>Enter</b>.
    </div>
  `;

  container.querySelectorAll('input[type="color"]').forEach((input) => {
    input.addEventListener("change", async (e: Event) => {
      const target = e.target as HTMLInputElement;
      const app = target.dataset.app;
      const color = target.value;
      await safeIpcInvoke("set-editor-color", [app, color], { fallback: null });
      void renderEditorUsage(container);
    });
  });
}

async function renderLanguageUsage(container: HTMLElement) {
  type LanguageUsageRow = { language: string; total_time: number };
  const usage: LanguageUsageRow[] = await safeIpcInvoke(
    "get-language-usage",
    [],
    { fallback: [] },
  );
  if (!usage || usage.length === 0) {
    container.innerHTML = `<h2>Language Usage Breakdown</h2><p>No data yet. Languages are detected from the file open in your editor.</p>`;
    return;
  }
  usage.sort(
    (a: LanguageUsageRow, b: LanguageUsageRow) => b.total_time - a.total_time,
  );
  const total = usage.reduce(
    (sum: number, row: LanguageUsageRow) => sum + row.total_time,
    0,
  );
  const defaultColors = [
    "#4f8cff",
    "#ffb347",
    "#7ed957",
    "#ff6961",
    "#b19cd9",
    "#f67280",
    "#355c7d",
  ];
  const items = usage.map((row: LanguageUsageRow, i: number) => ({
    label: row.language,
    percent: (row.total_time / total) * 100,
    color: defaultColors[i % defaultColors.length],
  }));

  container.innerHTML = `
  <h2>Language Usage Breakdown</h2>
  <div class="language-usage-flex">
    <div>
      <div id="languagePieChart" class="language-pie-chart"></div>
    </div>
  </div>
  `;

  renderPieChartJS("languagePieChart", items, 420);

  // Redraw with theme colors; replace the previous render's listener.
  if (rerenderPieChart) {
    window.removeEventListener("theme-changed", rerenderPieChart);
  }
  rerenderPieChart = () => renderPieChartJS("languagePieChart", items, 420);
  window.addEventListener("theme-changed", rerenderPieChart);
}

async function renderDailyGoalHistory(container: HTMLElement) {
  // Fetch all daily goals for the user, newest first
  const goals: {
    date: string;
    time: number;
    description: string;
    isCompleted: number;
  }[] = await safeIpcInvoke("get-all-daily-goals", [], { fallback: [] });

  container.innerHTML = `
    <h2>Daily Goal History</h2>
    ${
      goals.length === 0
        ? `<p>No daily goals set yet.</p>`
        : `<table class="goal-history-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time (min)</th>
                <th>Description</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${goals
                .map(
                  (g) => `
                <tr>
                  <td>${prettyDate(g.date)}</td>
                  <td>${g.time}</td>
                  <td>${escapeHtml(g.description || "")}</td>
                  <td>
                    ${
                      g.isCompleted
                        ? '<span style="color:green;">Completed</span>'
                        : '<span style="color:#aaa;">Not completed</span>'
                    }
                  </td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>`
    }
    <div class="info-note" style="margin-top:12px;">
      Only one daily goal can be set per day. Completed goals are marked in green.
    </div>
  `;
}
