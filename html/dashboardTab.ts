import { ipcRenderer } from 'electron';
import { renderLineChartJS } from './components';

export async function renderDashboard() {
  const container = document.getElementById('tab-dashboard');
  if (!container) return;
  container.innerHTML = `
    <h2>Dashboard</h2>
    <div id="dashboard-quickstats"></div>
    <div id="dashboard-calendar"></div>
    <div id="dashboard-charts"></div>
  `;

  // Quick stats (you can uncomment and adjust as needed)
  // const statsDiv = document.getElementById('dashboard-quickstats');
  // const summary = await ipcRenderer.invoke('get-summary');
  // const today = summary?.reduce((sum: number, row: any) => sum + row.time_spent, 0) || 0;
  // statsDiv!.innerHTML = `
  //   <div style="display:flex;gap:32px;margin-bottom:24px;">
  //     <div><b>Today:</b> ${Math.round(today/60)} min</div>
  //     <div><b>Sessions:</b> ${summary?.length || 0}</div>
  //   </div>
  // `;

  // --- Calendar Widget ---
  const calendarDiv = document.getElementById('dashboard-calendar');
  if (calendarDiv) {
    const calendar = await renderCalendarWidget();
    calendarDiv.appendChild(calendar);
  }

  // Recent activity chart (example: last 7 days total usage)
  const chartsDiv = document.getElementById('dashboard-charts');
  const daily = await ipcRenderer.invoke('get-daily-summary');
  const last7 = daily.slice(0, 7).reverse();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = last7.map((row: any) => ({
    title: 'Total Usage',
    name: 'Total',
    date: row.date,
    usage: row.total_time / 60 // minutes
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

  // Get logged days from main process
  const loggedDaysRaw = await ipcRenderer.invoke('get-logged-days-of-month', year, month) as LoggedDay[];
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