import { ipcRenderer } from 'electron';
import { formatTimeSpent } from '../src/utils/timeFormat';

function escapeHtml(text: string) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

interface LogEntry {
  icon: string;
  app: string;
  language: string;
  time_spent: number;
}

interface LoggedDay {
  date: string; // 'YYYY-MM-DD'
}

// Calendar state (module-level, not on function)
let calendarMonth: number = new Date().getMonth() + 1; // 1-based
let calendarYear: number = new Date().getFullYear();

export async function renderLogs(date?: string) {
  const container = document.querySelector('#logTable')?.parentElement;
  if (!container) return;

  // Remove any existing calendar
  const oldCal = container.querySelector('.calendar-widget');
  if (oldCal) oldCal.remove();

  // Remove any existing custom title or today title
  const oldMainTitle = container.querySelector('.main-title');
  if (oldMainTitle) oldMainTitle.remove();
  const oldTodayTitle = container.querySelector('.today-title');
  if (oldTodayTitle) oldTodayTitle.remove();

  // Insert main title above calendar
  const mainTitle = document.createElement('h1');
  mainTitle.textContent = 'Developer Time Tracker';
  mainTitle.className = 'main-title';
  mainTitle.style.marginBottom = '10px';
  container.insertBefore(mainTitle, container.firstChild);

  // Insert calendar at the top (below main title)
  const calendar = await renderCalendarWidget();
  container.insertBefore(calendar, mainTitle.nextSibling);

  // Insert TODAY title below calendar
  const todayTitle = document.createElement('h2');
  todayTitle.textContent = 'TODAY';
  todayTitle.className = 'today-title';
  todayTitle.style.margin = '12px 0 8px 0';
  todayTitle.style.fontSize = '1.1em';
  todayTitle.style.letterSpacing = '2px';
  todayTitle.style.color = 'var(--accent)';
  container.insertBefore(todayTitle, calendar.nextSibling);

  const logs = await ipcRenderer.invoke('get-logs', date) as LogEntry[];
  const tbody = document.querySelector('#logTable tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  logs.forEach((log) => {
    const timeSpent = formatTimeSpent(log.time_spent);
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><img src="${log.icon}" alt="${escapeHtml(log.app)} icon" class="icon" /></td>
      <td>${escapeHtml(log.app)}</td>
      <td>${escapeHtml(log.language)}</td>
      <td>${escapeHtml(timeSpent)}</td>
    `;
    tbody.appendChild(row);
  });
}

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