import { ipcRenderer } from 'electron';
import { renderLineChartJS } from './components';
import { getMonday, getWeekDates, getLocalDateString, filterDailyDataForWeek, getCurrentUserId } from './utils';
import { getLangIconUrl } from '../src/utils/extractData';
import type { DailySummaryRow, SessionRow } from '../src/logger';

export async function renderDashboard() {
  const container = document.getElementById('dashboardContent');
  if (!container) return;
  container.innerHTML = `
    <div id="dashboard-inner">
      <h1 class="dashboard-title">Developer Time Tracker</h1>
      <div id="dashboard-calendar"></div>
      <div id="dashboard-quickstats"></div>
      <div id="dashboard-charts"></div>
    </div>
  `;

  // --- Calendar Widget ---
  const calendarDiv = document.getElementById('dashboard-calendar');
  if (calendarDiv) {
    const calendar = await renderCalendarWidget();
    calendarDiv.appendChild(calendar);
  }

  // --- Recent Activity Stats ---
  await renderRecentActivity();

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

  // Pass userId as first argument
  const loggedDaysRaw = await ipcRenderer.invoke('get-logged-days-of-month', getCurrentUserId(), year, month) as LoggedDay[];
  const loggedDaysSet = new Set(
    loggedDaysRaw.map((row) => Number(row.date.split('-')[2]))
  );

  // Build calendar grid
  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=Sunday
  const calendar = document.createElement('div');
  calendar.className = 'calendar-widget';

  let html = `
    <div class="calendar-header" style="display:flex;align-items:center;justify-content:space-between;">
      <button id="cal-prev-btn" style="font-size:1.2em;background:none;border:none;cursor:pointer;">&#8592;</button>
      <span style="flex:1;text-align:center;">
        ${new Date(year, month - 1).toLocaleString(undefined, { month: 'long', year: 'numeric' })}
      </span>
      <button id="cal-next-btn" style="font-size:1.2em;background:none;border:none;cursor:pointer;">&#8594;</button>
    </div>
    <div class="calendar-grid">
      ${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<div class="calendar-day-label">${d}</div>`).join('')}
  `;
  let day = 1;
  for (let i = 0; i < 42; i++) { // 6 weeks max
    if (i < firstDay || day > daysInMonth) {
      html += `<div class="calendar-cell"></div>`;
    } else {
      html += `<div class="calendar-cell${loggedDaysSet.has(day) ? ' logged' : ''}">${loggedDaysSet.has(day) ? '✗' : ''}<span class="calendar-date">${day}</span></div>`;
      day++;
    }
  }
  html += `</div>`;
  calendar.innerHTML = html;

  // Add navigation handlers
  setTimeout(() => {
    const prevBtn = calendar.querySelector('#cal-prev-btn') as HTMLButtonElement;
    const nextBtn = calendar.querySelector('#cal-next-btn') as HTMLButtonElement;
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
        nextBtn.style.opacity = '0.5';
        nextBtn.style.cursor = '';
      } else {
        nextBtn.disabled = false;
        nextBtn.style.opacity = '';
        nextBtn.style.cursor = 'pointer';
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
  const statsDiv = document.getElementById('dashboard-quickstats');
  if (!statsDiv) return;

  // Pass userId as first argument
  const dailySummary: DailySummaryRow[] = await ipcRenderer.invoke('get-daily-summary', getCurrentUserId());
  const sessions: SessionRow[] = await ipcRenderer.invoke('get-sessions', getCurrentUserId());

  // Get current week dates
  const monday = getMonday(new Date());
  const weekDate = getWeekDates(monday)
  const weekDates = weekDate.map(getLocalDateString);

  // Filter daily summary for this week
  const weekSummary = filterDailyDataForWeek(dailySummary, monday);

  // Top language of the week
  const startDate = getLocalDateString(weekDate[0]);
  const endDate = getLocalDateString(weekDate[6]);
  const weeklyLangSummary = await ipcRenderer.invoke('get-language-summary-by-date-range', getCurrentUserId(), startDate, endDate);
  // weeklyLangSummary: Array<{ language: string, total_time: number }>
  const topLang = weeklyLangSummary[0];

  // Get icon for topLang
  let topLangIconHtml = '';
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
    if (row.app) editorTotals[row.app] = (editorTotals[row.app] || 0) + row.total_time;
  });
  const topEditor = Object.entries(editorTotals).sort((a, b) => b[1] - a[1])[0];
  const topEditorName = topEditor ? topEditor[0] : null;
  const topEditorRow = weekSummary.find(row => row.app === topEditorName);
  const topEditorIcon = topEditorRow?.icon;

  // 3 largest sessions of the week
  const weekSessions = sessions.filter((s: SessionRow) => weekDates.includes(getLocalDateString(new Date(s.timestamp))));
  const topSessions = weekSessions.sort((a: SessionRow, b: SessionRow) => b.duration - a.duration).slice(0, 3);

  // Longest streak (consecutive days with activity)
  const allDates = dailySummary.map((row: DailySummaryRow) => row.date).sort();
  let maxStreak = 0, curStreak = 0, prevDate: string | null = null;
  for (const date of allDates) {
    if (!prevDate) {
      curStreak = 1;
    } else {
      const prev = new Date(prevDate);
      const curr = new Date(date);
      const diff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
      curStreak = diff === 1 ? curStreak + 1 : 1;
    }
    if (curStreak > maxStreak) maxStreak = curStreak;
    prevDate = date;
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
                 <br><span class="bubble-sub">${Math.round(topLang.total_time/60)} min</span>`
              : '—'
          }
        </div>
      </div>
      <div class="dashboard-bubble bubble-editor">
        <div class="bubble-label">Editor of the Week</div>
          <div class="bubble-value">
          ${
            topEditor && topEditorIcon
              ? `<img src="${topEditorIcon}" alt="${topEditorName}" class="editor-icon" title="${topEditorName}" style="width:36px;height:36px;vertical-align:middle;border-radius:8px;margin-bottom:6px;"><br>
                <span class="bubble-sub">${Math.round(topEditor[1]/60)} min</span>`
              : '—'
          }
          </div>
        </div>
      <div class="dashboard-bubble bubble-session">
        <div class="bubble-label">Largest Sessions</div>
        <div class="bubble-value">
          ${topSessions.length ? topSessions.map((s: SessionRow) =>
            `<div class="bubble-session-row">
              <span class="bubble-main">
                ${s.title}
                <span class="bubble-duration">${Math.floor(s.duration/60)}m ${s.duration%60}s</span>
              </span>
            </div>`
          ).join('') : '—'}
        </div>
      </div>
      <div class="dashboard-bubble bubble-streak">
        <div class="bubble-label">Longest Streak</div>
        <div class="bubble-value"><span class="bubble-main">${maxStreak}</span><br><span class="bubble-sub">day${maxStreak === 1 ? '' : 's'}</span></div>
      </div>
    </div>
  `;
}