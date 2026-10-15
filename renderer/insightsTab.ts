/**
 * Sessions → Insights: where attention went, from the foreground-window
 * samples (editor and language breakdowns) plus the daily goal history.
 */
import { escapeHtml } from "./utils/domUtils";
import { renderPercentBar, renderPieChartJS } from "./components";
import { prettyDate, safeIpcInvoke, withLoading } from "./utils";

let rerenderPieChart: (() => void) | null = null;

export async function renderInsights() {
  const container = document.getElementById("insightsContent");
  if (!container) return;

  container.innerHTML = `
    <h1>Insights</h1>
    <p class="info-note">
      Where your attention went, based on the app and file in the foreground
      while you were recording.
    </p>
    <section id="insights-editors" class="insights-section"></section>
    <section id="insights-languages" class="insights-section"></section>
    <section id="insights-goals" class="insights-section"></section>
  `;

  const sections: [string, (el: HTMLElement) => Promise<void>][] = [
    ["insights-editors", renderEditorUsage],
    ["insights-languages", renderLanguageUsage],
    ["insights-goals", renderDailyGoalHistory],
  ];
  await Promise.all(
    sections.map(async ([id, render]) => {
      const el = container.querySelector<HTMLElement>(`#${id}`);
      if (el) await withLoading(el, "Loading…", () => render(el));
    }),
  );
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
