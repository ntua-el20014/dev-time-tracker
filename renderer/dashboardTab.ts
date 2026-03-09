import { renderPercentBar } from "./components";
import {
  getMonday,
  getWeekDates,
  getLocalDateString,
  filterDailyDataForWeek,
  safeIpcInvoke,
  withLoading,
  getDailyGoalCached,
} from "./utils";
import { getLangIconUrl } from "../src/utils/langIconUrl";
import { showInAppNotification } from "./components/Notifications";
import type { DailySummaryRow, SessionRow } from "@shared/types";

export async function renderDashboard() {
  const container = document.getElementById("dashboardContent");
  if (!container) return;
  container.innerHTML = `
    <div id="dashboard-inner">
      <div id="dashboard-goal-progress"></div>
      <h1 class="dashboard-title">Developer Time Tracker</h1>
      <div class="standup-btn-row">
        <button id="generate-standup-btn" class="standup-btn" title="Generate a daily summary for standups">
          📋 Generate Daily Summary
        </button>
      </div>
      <div id="dashboard-calendar"></div>
      <div id="dashboard-quickstats"></div>
      <div id="dashboard-charts"></div>
    </div>
  `;

  // Attach standup button handler
  const standupBtn = document.getElementById("generate-standup-btn");
  if (standupBtn) {
    standupBtn.addEventListener("click", () => showStandupModal());
  }

  // --- Daily Goal Progress Bar ---
  const today = new Date().toLocaleDateString("en-CA");
  const { goal: dailyGoal, totalMins } = await getDailyGoalCached(today);

  const goalDiv = document.getElementById("dashboard-goal-progress");
  if (goalDiv && dailyGoal) {
    const percent = Math.min(100, (totalMins / dailyGoal.time) * 100);
    goalDiv.innerHTML = `
      <div style="margin-bottom:8px;">
        <b>Daily Goal:</b> ${totalMins.toFixed(0)} / ${
          dailyGoal.time
        } mins (${percent.toFixed(0)}%)
      </div>
      ${renderPercentBar(
        [
          {
            label: "Progress",
            percent,
            color: percent >= 100 ? "#4caf50" : "var(--accent)",
          },
          { label: "", percent: 100 - percent, color: "#eee" },
        ],
        18,
        8,
      )}
    `;
  } else if (goalDiv) {
    goalDiv.innerHTML = "";
  }

  // --- Calendar Widget ---
  const calendarDiv = document.getElementById("dashboard-calendar");
  if (calendarDiv) {
    // Clear any existing calendars before rendering a new one
    calendarDiv.innerHTML = "";
    const calendar = await renderCalendarWidget();
    calendarDiv.appendChild(calendar);
  }

  // --- Recent Activity Stats ---
  const quickstatsDiv = document.getElementById("dashboard-quickstats");
  if (quickstatsDiv) {
    await withLoading(quickstatsDiv, "Loading dashboard…", async () => {
      await renderRecentActivity();
    });
  }
  /*
  // Recent activity chart (example: last 7 days total usage)
  const chartsDiv = document.getElementById('dashboard-charts');
  const daily = await ipcRenderer.invoke('get-daily-summary', getCurrentUserId());
  const last7 = daily.slice(0, 7).reverse();
  const data = last7.map((row: DailySummaryRow) => ({
    title: 'Total Usage',
    name: 'Total',
    date: row.date,
    usage: row.total_time / 60
  }));
  if (chartsDiv) {
    chartsDiv.innerHTML = `<div id="dashboard-usage-chart" style="max-width:400px"></div>`;
    renderLineChartJS({
      containerId: 'dashboard-usage-chart',
      data,
      yLabel: 'Minutes'
    });

    // --- Theme-aware chart text color ---
    // Remove previous listener to avoid duplicates
    window.removeEventListener('theme-changed', rerenderDashboardChartOnThemeChange);
    window.addEventListener('theme-changed', rerenderDashboardChartOnThemeChange);
  }

  function rerenderDashboardChartOnThemeChange() {
    renderLineChartJS({
      containerId: 'dashboard-usage-chart',
      data,
      yLabel: 'Minutes'
    });
  }
  */
}
interface LoggedDay {
  date: string; // 'YYYY-MM-DD'
}

// Calendar state (module-level, not on function)
let calendarMonth: number = new Date().getMonth() + 1; // 1-based
let calendarYear: number = new Date().getFullYear();

async function renderCalendarWidget(): Promise<HTMLDivElement> {
  const month = calendarMonth;
  const year = calendarYear;

  const daysInMonth = new Date(year, month, 0).getDate();

  const loggedDaysRaw = await safeIpcInvoke<LoggedDay[]>(
    "get-logged-days-of-month",
    [year, month],
    { fallback: [] },
  );
  const loggedDaysSet = new Set(
    loggedDaysRaw.map((row) => {
      const dateStr = typeof row === "string" ? row : row.date;
      return Number(dateStr.split("-")[2]);
    }),
  );

  // Build calendar grid
  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=Sunday
  const calendar = document.createElement("div");
  calendar.className = "calendar-widget";

  let html = `
    <div class="calendar-header" style="display:flex;align-items:center;justify-content:space-between;">
      <button id="cal-prev-btn" style="font-size:1.2em;background:none;border:none;cursor:pointer;">&#8592;</button>
      <span style="flex:1;text-align:center;">
        ${new Date(year, month - 1).toLocaleString(undefined, {
          month: "long",
          year: "numeric",
        })}
      </span>
      <button id="cal-next-btn" style="font-size:1.2em;background:none;border:none;cursor:pointer;">&#8594;</button>
    </div>
    <div class="calendar-grid">
      ${["S", "M", "T", "W", "T", "F", "S"]
        .map((d) => `<div class="calendar-day-label">${d}</div>`)
        .join("")}
  `;
  let day = 1;
  for (let i = 0; i < 42; i++) {
    // 6 weeks max
    if (i < firstDay || day > daysInMonth) {
      html += `<div class="calendar-cell"></div>`;
    } else {
      html += `<div class="calendar-cell${
        loggedDaysSet.has(day) ? " logged" : ""
      }">${
        loggedDaysSet.has(day) ? "✗" : ""
      }<span class="calendar-date">${day}</span></div>`;
      day++;
    }
  }
  html += `</div>`;
  calendar.innerHTML = html;

  // Add navigation handlers
  setTimeout(() => {
    const prevBtn = calendar.querySelector(
      "#cal-prev-btn",
    ) as HTMLButtonElement;
    const nextBtn = calendar.querySelector(
      "#cal-next-btn",
    ) as HTMLButtonElement;
    if (prevBtn) {
      prevBtn.onclick = async () => {
        calendarMonth--;
        if (calendarMonth < 1) {
          calendarMonth = 12;
          calendarYear--;
        }
        const newCal = await renderCalendarWidget();
        calendar.replaceWith(newCal);
      };
    }
    if (nextBtn) {
      // Prevent moving forward from the current month
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();
      if (calendarYear >= currentYear && calendarMonth >= currentMonth) {
        nextBtn.disabled = true;
        nextBtn.style.opacity = "0.5";
        nextBtn.style.cursor = "";
      } else {
        nextBtn.disabled = false;
        nextBtn.style.opacity = "";
        nextBtn.style.cursor = "pointer";
        nextBtn.onclick = async () => {
          calendarMonth++;
          if (calendarMonth > 12) {
            calendarMonth = 1;
            calendarYear++;
          }
          const newCal = await renderCalendarWidget();
          calendar.replaceWith(newCal);
        };
      }
    }
  }, 0);

  return calendar;
}

// --- Recent Activity Stats ---
async function renderRecentActivity() {
  const statsDiv = document.getElementById("dashboard-quickstats");
  if (!statsDiv) return;

  // Only fetch last 90 days for streak calculation (avoids unbounded growth)
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const streakStartDate = getLocalDateString(ninetyDaysAgo);

  const dailySummary: DailySummaryRow[] = await safeIpcInvoke(
    "get-daily-summary",
    [{ startDate: streakStartDate }],
    { fallback: [] },
  );
  // Dashboard only needs this week's sessions — fetch with date range
  const weekStart = getLocalDateString(getMonday(new Date()));
  const sessions: SessionRow[] = await safeIpcInvoke(
    "get-sessions",
    [{ startDate: weekStart }],
    { fallback: [] },
  );

  // Get current week dates
  const monday = getMonday(new Date());
  const weekDate = getWeekDates(monday);
  const weekDates = weekDate.map(getLocalDateString);

  // Filter daily summary for this week
  const weekSummary = filterDailyDataForWeek(dailySummary, monday);

  // Top language of the week
  const startDate = getLocalDateString(weekDate[0]);
  const endDate = getLocalDateString(weekDate[6]);
  const weeklyLangSummary = await safeIpcInvoke<any[]>(
    "get-language-summary-by-date-range",
    [startDate, endDate],
    { fallback: [] },
  );
  // weeklyLangSummary: Array<{ language: string, total_time: number }>
  const topLang = weeklyLangSummary[0];

  // Get icon for topLang
  let topLangIconHtml = "";
  if (topLang && topLang.language) {
    const langExt = topLang.lang_ext;
    const langIconUrl = getLangIconUrl(langExt);
    if (langIconUrl) {
      topLangIconHtml = `<img src="${langIconUrl}" alt="${topLang.language}" class="lang-icon" style="width:32px;height:32px;display:block;margin:6px auto 0 auto;" />`;
    }
  }

  // Top editor of the week
  const editorTotals: Record<string, number> = {};
  weekSummary.forEach((row: DailySummaryRow) => {
    if (row.app)
      editorTotals[row.app] = (editorTotals[row.app] || 0) + row.total_time;
  });
  const topEditor = Object.entries(editorTotals).sort((a, b) => b[1] - a[1])[0];
  const topEditorName = topEditor ? topEditor[0] : null;
  const topEditorRow = weekSummary.find((row) => row.app === topEditorName);
  const topEditorIcon = topEditorRow?.icon;

  // 3 largest sessions of the week
  const weekSessions = sessions.filter((s: SessionRow) =>
    weekDates.includes(getLocalDateString(new Date(s.timestamp))),
  );
  const topSessions = weekSessions
    .sort((a: SessionRow, b: SessionRow) => b.duration - a.duration)
    .slice(0, 3);

  // Longest streak (consecutive days with activity)
  const uniqueDates = [
    ...new Set(dailySummary.map((row: DailySummaryRow) => row.date)),
  ].sort();
  let maxStreak = 0;
  let currentStreak = 0;

  for (let i = 0; i < uniqueDates.length; i++) {
    if (i === 0) {
      // First date - start counting
      currentStreak = 1;
    } else {
      // Check if current date is exactly one day after previous date
      const prevDate = new Date(uniqueDates[i - 1]);
      const currDate = new Date(uniqueDates[i]);

      // Add one day to previous date and compare
      const expectedNext = new Date(prevDate);
      expectedNext.setDate(expectedNext.getDate() + 1);

      if (expectedNext.toDateString() === currDate.toDateString()) {
        // Consecutive day
        currentStreak++;
      } else {
        // Gap found - save max and start new streak
        maxStreak = Math.max(maxStreak, currentStreak);
        currentStreak = 1;
      }
    }

    // Always update max streak (handles case where longest streak is at the end)
    maxStreak = Math.max(maxStreak, currentStreak);
  }

  // Render quick stats
  statsDiv.innerHTML = `
    <div class="dashboard-bubbles">
      <div class="dashboard-bubble bubble-lang">
        <div class="bubble-label">Language of the Week</div>
        <div class="bubble-value">
          ${
            topLang
              ? `<span class="bubble-main">${topLang.language}</span>
                 ${topLangIconHtml}
                 <br><span class="bubble-sub">${Math.round(
                   topLang.total_time / 60,
                 )} min</span>`
              : "—"
          }
        </div>
      </div>
      <div class="dashboard-bubble bubble-editor">
        <div class="bubble-label">Editor of the Week</div>
          <div class="bubble-value">
          ${
            topEditor && topEditorIcon
              ? `<img src="${topEditorIcon}" alt="${topEditorName}" class="editor-icon" title="${topEditorName}" style="width:36px;height:36px;vertical-align:middle;border-radius:8px;margin-bottom:6px;"><br>
                <span class="bubble-sub">${Math.round(
                  topEditor[1] / 60,
                )} min</span>`
              : "—"
          }
          </div>
        </div>
      <div class="dashboard-bubble bubble-session">
        <div class="bubble-label">Largest Sessions</div>
        <div class="bubble-value">
          ${
            topSessions.length
              ? topSessions
                  .map(
                    (s: SessionRow) =>
                      `<div class="bubble-session-row">
              <span class="bubble-main">
                ${s.title}
                <span class="bubble-duration">${Math.floor(s.duration / 60)}m ${
                  s.duration % 60
                }s</span>
              </span>
            </div>`,
                  )
                  .join("")
              : "—"
          }
        </div>
      </div>
      <div class="dashboard-bubble bubble-streak">
        <div class="bubble-label">Longest Streak</div>
        <div class="bubble-value"><span class="bubble-main">${maxStreak}</span><br><span class="bubble-sub">day${
          maxStreak === 1 ? "" : "s"
        }</span></div>
      </div>
    </div>
  `;
}
// ═══════════════════════════════════════════════════════════════════
// Standup Summary Modal
// ═══════════════════════════════════════════════════════════════════

function showStandupModal() {
  // Remove any existing modal
  const existing = document.getElementById("standup-modal-overlay");
  if (existing) existing.remove();

  // Default dates: yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = toLocalDateStr(yesterday);
  const todayStr = toLocalDateStr(new Date());

  const overlay = document.createElement("div");
  overlay.id = "standup-modal-overlay";
  overlay.className = "standup-modal-overlay";
  overlay.innerHTML = `
    <div class="standup-modal">
      <div class="standup-modal-header">
        <h3>📋 Generate Daily Summary</h3>
        <button class="standup-modal-close" id="standup-close-btn">&times;</button>
      </div>
      <div class="standup-controls">
        <label>From</label>
        <input type="date" id="standup-start-date" value="${yesterdayStr}" max="${todayStr}">
        <label>To</label>
        <input type="date" id="standup-end-date" value="${yesterdayStr}" max="${todayStr}">
        <button class="standup-preset-btn" data-preset="yesterday">Yesterday</button>
        <button class="standup-preset-btn" data-preset="today">Today</button>
        <button class="standup-preset-btn" data-preset="week">Last 7 days</button>
        <button class="standup-generate-btn" id="standup-generate-btn">Generate</button>
      </div>
      <div class="standup-body" id="standup-body">
        <div class="standup-placeholder">Select a date range and click <strong>Generate</strong> to create your standup summary.</div>
      </div>
      <div class="standup-modal-footer" id="standup-footer" style="display:none;">
        <button class="standup-copy-btn" id="standup-copy-btn">📋 Copy to Clipboard</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close on backdrop click
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeStandupModal();
  });

  // Close button
  document
    .getElementById("standup-close-btn")
    ?.addEventListener("click", closeStandupModal);

  // Preset buttons
  overlay.querySelectorAll(".standup-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = (btn as HTMLElement).dataset.preset;
      const startInput = document.getElementById(
        "standup-start-date",
      ) as HTMLInputElement;
      const endInput = document.getElementById(
        "standup-end-date",
      ) as HTMLInputElement;
      const now = new Date();

      if (preset === "yesterday") {
        const yd = new Date(now);
        yd.setDate(yd.getDate() - 1);
        startInput.value = toLocalDateStr(yd);
        endInput.value = toLocalDateStr(yd);
      } else if (preset === "today") {
        startInput.value = toLocalDateStr(now);
        endInput.value = toLocalDateStr(now);
      } else if (preset === "week") {
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 6);
        startInput.value = toLocalDateStr(weekAgo);
        endInput.value = toLocalDateStr(now);
      }

      // Highlight active preset
      overlay
        .querySelectorAll(".standup-preset-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  // Generate button
  document
    .getElementById("standup-generate-btn")
    ?.addEventListener("click", handleStandupGenerate);

  // Copy button
  document
    .getElementById("standup-copy-btn")
    ?.addEventListener("click", handleStandupCopy);

  // Activate "Yesterday" preset by default
  overlay
    .querySelector('.standup-preset-btn[data-preset="yesterday"]')
    ?.classList.add("active");
}

function closeStandupModal() {
  const overlay = document.getElementById("standup-modal-overlay");
  if (overlay) overlay.remove();
}

let _lastStandupText = "";

async function handleStandupGenerate() {
  const startDate = (
    document.getElementById("standup-start-date") as HTMLInputElement
  )?.value;
  const endDate = (
    document.getElementById("standup-end-date") as HTMLInputElement
  )?.value;
  const body = document.getElementById("standup-body");
  const footer = document.getElementById("standup-footer");
  const generateBtn = document.getElementById(
    "standup-generate-btn",
  ) as HTMLButtonElement;

  if (!startDate || !endDate) {
    showInAppNotification("Please select a date range");
    return;
  }

  if (startDate > endDate) {
    showInAppNotification("Start date must be before end date");
    return;
  }

  if (!body) return;

  // Show loading
  body.innerHTML = `<div class="standup-loading"><div class="standup-spinner"></div> Generating summary…</div>`;
  if (footer) footer.style.display = "none";
  if (generateBtn) generateBtn.disabled = true;

  try {
    const data = await safeIpcInvoke<any>(
      "generate-standup-summary",
      [{ startDate, endDate }],
      { fallback: null },
    );

    if (!data) {
      body.innerHTML = `<div class="standup-placeholder">No data found for the selected period.</div>`;
      if (generateBtn) generateBtn.disabled = false;
      return;
    }

    _lastStandupText = data.standupText;

    // Render the visual summary
    body.innerHTML = renderStandupResult(data);
    if (footer) footer.style.display = "flex";

    // Reset copy button state
    const copyBtn = document.getElementById("standup-copy-btn");
    if (copyBtn) {
      copyBtn.classList.remove("copied");
      copyBtn.innerHTML = "📋 Copy to Clipboard";
    }
  } catch {
    body.innerHTML = `<div class="standup-placeholder">Error generating summary. Please try again.</div>`;
  } finally {
    if (generateBtn) generateBtn.disabled = false;
  }
}

function renderStandupResult(data: any): string {
  const {
    totalHours,
    totalSessions,
    languages,
    editors,
    projects,
    topSessions,
    standupText,
  } = data;

  let html = "";

  // Stats row
  html += `<div class="standup-stats">
    <div class="standup-stat">
      <span class="standup-stat-value">${totalHours}h</span>
      <span class="standup-stat-label">Total Time</span>
    </div>
    <div class="standup-stat">
      <span class="standup-stat-value">${totalSessions}</span>
      <span class="standup-stat-label">Sessions</span>
    </div>
    <div class="standup-stat">
      <span class="standup-stat-value">${languages.length}</span>
      <span class="standup-stat-label">Languages</span>
    </div>
    <div class="standup-stat">
      <span class="standup-stat-value">${projects.length}</span>
      <span class="standup-stat-label">Projects</span>
    </div>
  </div>`;

  // Projects
  if (
    projects.length > 0 &&
    !(projects.length === 1 && projects[0].name === "No Project")
  ) {
    html += `<div class="standup-section">
      <div class="standup-section-title">📁 Projects</div>
      <ul class="standup-list">
        ${projects
          .filter((p: any) => p.name !== "No Project")
          .map(
            (p: any) =>
              `<li><span class="standup-list-name">${escapeHtml(p.name)}</span><span class="standup-list-value">${fmtDuration(p.minutes)} · ${p.sessions} session${p.sessions !== 1 ? "s" : ""}</span></li>`,
          )
          .join("")}
      </ul>
    </div>`;
  }

  // Languages
  if (languages.length > 0) {
    html += `<div class="standup-section">
      <div class="standup-section-title">💻 Languages</div>
      <ul class="standup-list">
        ${languages
          .slice(0, 5)
          .map(
            (l: any) =>
              `<li><span class="standup-list-name">${escapeHtml(l.name)}</span><span class="standup-list-value">${fmtDuration(l.minutes)}</span></li>`,
          )
          .join("")}
      </ul>
    </div>`;
  }

  // Editors
  if (editors.length > 0) {
    html += `<div class="standup-section">
      <div class="standup-section-title">🛠️ Editors</div>
      <ul class="standup-list">
        ${editors
          .slice(0, 3)
          .map(
            (e: any) =>
              `<li><span class="standup-list-name">${escapeHtml(e.name)}</span><span class="standup-list-value">${fmtDuration(e.minutes)}</span></li>`,
          )
          .join("")}
      </ul>
    </div>`;
  }

  // Top sessions
  if (topSessions.length > 0) {
    html += `<div class="standup-section">
      <div class="standup-section-title">🏆 Top Sessions</div>
      <ul class="standup-list">
        ${topSessions
          .slice(0, 3)
          .map((s: any) => {
            const proj = s.project
              ? ` <span style="opacity:0.7">[${escapeHtml(s.project)}]</span>`
              : "";
            return `<li><span class="standup-list-name">${escapeHtml(s.title)}${proj}</span><span class="standup-list-value">${fmtDuration(s.durationMinutes)}</span></li>`;
          })
          .join("")}
      </ul>
    </div>`;
  }

  // Text preview
  html += `<div class="standup-text-preview">${escapeHtml(standupText)}</div>`;

  return html;
}

async function handleStandupCopy() {
  const copyBtn = document.getElementById("standup-copy-btn");
  if (!_lastStandupText) return;

  try {
    await navigator.clipboard.writeText(_lastStandupText);
    if (copyBtn) {
      copyBtn.classList.add("copied");
      copyBtn.innerHTML = "✅ Copied!";
      setTimeout(() => {
        copyBtn.classList.remove("copied");
        copyBtn.innerHTML = "📋 Copy to Clipboard";
      }, 2000);
    }
  } catch {
    showInAppNotification("Failed to copy to clipboard");
  }
}

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
