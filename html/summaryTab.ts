/* eslint-disable @typescript-eslint/no-explicit-any */
import { ipcRenderer } from 'electron';
import { formatTimeSpent } from '../src/utils/timeFormat';

function escapeHtml(text: string) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getLocalDateString(date: Date): string {
  return date.toLocaleDateString('en-CA'); // YYYY-MM-DD format
}

function getWeekDates(startDate: Date): Date[] {
  // Create a new Date object to avoid modifying the original
  const date = new Date(startDate);
  const day = date.getDay();
  // Adjust to get Monday (1) as first day of week
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date);
  monday.setDate(diff);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const weekDay = new Date(monday);
    weekDay.setDate(monday.getDate() + i);
    dates.push(weekDay);
  }
  return dates;
}

// Helper to get the Monday of the week for a given date
function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Store the current week start date (Monday)
let currentWeekMonday = getMonday(new Date());

// Render the timeline chart for a specific week
function renderTimelineChart(dailyData: any[], weekMonday: Date) {
  const timelineContainer = document.createElement('div');
  timelineContainer.className = 'timeline-container';

  // Group data by date and calculate total time per day (in seconds)
  const timeByDate: Record<string, number> = {};
  dailyData.forEach(row => {
    const date = row.date;
    timeByDate[date] = (timeByDate[date] || 0) + row.total_time;
  });

  // Get week dates (Monday to Sunday)
  const weekDays = getWeekDates(weekMonday);
  const todayDateStr = getLocalDateString(new Date());

  // Find maximum time for scaling (in seconds)
  const weekDateStrs = weekDays.map(d => getLocalDateString(d));
  const maxSeconds = Math.max(
    1,
    ...weekDateStrs.map(dateStr => timeByDate[dateStr] || 0)
  );
  const maxBarHeight = 70;

  // Create chart HTML
  timelineContainer.innerHTML = `
    <div class="timeline-header" style="display: flex; align-items: center; justify-content: space-between;">
      <button id="week-prev-btn" style="font-size:1.5em; background:none; border:none; cursor:pointer;">&#8592;</button>
      <h3 style="flex:1; text-align:center; margin:0;">
        ${weekDays[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - 
        ${weekDays[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
      </h3>
      <button id="week-next-btn" style="font-size:1.5em; background:none; border:none; cursor:pointer;">&#8594;</button>
    </div>
    <div class="timeline-chart">
      ${weekDays.map(day => {
        const dateStr = getLocalDateString(day);
        const dayName = day.toLocaleDateString('en-US', { weekday: 'short' });
        const seconds = timeByDate[dateStr] || 0;
        const height = seconds > 0 ? (seconds / maxSeconds * maxBarHeight) : 0;
        const isToday = dateStr === todayDateStr;
        const timeText = seconds > 0 ? formatTimeSpent(seconds) : '';
        return `
          <div class="timeline-day ${isToday ? 'today' : ''}">
            <div class="timeline-bar-container">
              ${seconds > 0 ? `
                <div class="timeline-bar" style="height: ${height}px"></div>
                <div class="timeline-hours">${timeText}</div>
              ` : `
                <div class="timeline-bar" style="height: 0; visibility: hidden;"></div>
                <div class="timeline-hours"></div>
              `}
            </div>
            <div class="timeline-day-label">${dayName}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  return timelineContainer;
}

// Store all daily data for all dates (for client-side week switching)
let allDailyData: any[] = [];

// Helper to filter daily data for a specific week
function filterDailyDataForWeek(dailyData: any[], weekMonday: Date): any[] {
  const weekDates = getWeekDates(weekMonday).map(d => getLocalDateString(d));
  return dailyData.filter(row => weekDates.includes(row.date));
}

export async function renderSummary() {
  const summaryDiv = document.getElementById('summaryContent');
  if (!summaryDiv) return;

  // Only fetch all data once, cache for week switching
  if (allDailyData.length === 0) {
    allDailyData = await ipcRenderer.invoke('get-daily-summary');
  }
  if (!allDailyData || allDailyData.length === 0) {
    summaryDiv.innerHTML = '<p>No summary data available.</p>';
    return;
  }

  // Clear and add timeline
  summaryDiv.innerHTML = '';

  // Create a container for the weekly summary
  const weeklySummaryContainer = document.createElement('div');
  weeklySummaryContainer.className = 'weekly-summary';

  // Render the timeline for the current week
  function updateWeeklySummary() {
    weeklySummaryContainer.innerHTML = '';
    const weekData = filterDailyDataForWeek(allDailyData, currentWeekMonday);
    weeklySummaryContainer.appendChild(renderTimelineChart(weekData, currentWeekMonday));
    attachWeekNavHandlers();
  }

  // Attach navigation button handlers
  function attachWeekNavHandlers() {
    const prevBtn = weeklySummaryContainer.querySelector('#week-prev-btn') as HTMLButtonElement;
    const nextBtn = weeklySummaryContainer.querySelector('#week-next-btn') as HTMLButtonElement;
    if (prevBtn) {
      prevBtn.onclick = () => {
        // Go to previous week
        currentWeekMonday.setDate(currentWeekMonday.getDate() - 7);
        updateWeeklySummary();
      };
    }
    if (nextBtn) {
      nextBtn.onclick = () => {
        // Go to next week (but not future)
        const nextMonday = new Date(currentWeekMonday);
        nextMonday.setDate(nextMonday.getDate() + 7);
        const todayMonday = getMonday(new Date());
        if (nextMonday <= todayMonday) {
          currentWeekMonday = nextMonday;
          updateWeeklySummary();
        }
      };
    }
  }

  updateWeeklySummary();
  summaryDiv.appendChild(weeklySummaryContainer);

  // --- Filter toggle ---
  const filterContainer = document.createElement('div');
  filterContainer.style.margin = '24px 0 8px 0';
  filterContainer.style.display = 'flex';
  filterContainer.style.gap = '16px';
  filterContainer.style.alignItems = 'center';

  const byDateBtn = document.createElement('button');
  byDateBtn.textContent = 'Summary by Date';
  byDateBtn.className = 'summary-filter-btn active';

  const bySessionBtn = document.createElement('button');
  bySessionBtn.textContent = 'Summary by Session';
  bySessionBtn.className = 'summary-filter-btn';

  filterContainer.appendChild(byDateBtn);
  filterContainer.appendChild(bySessionBtn);
  summaryDiv.appendChild(filterContainer);

  // --- Containers for each summary type ---
  const byDateContainer = document.createElement('div');
  const bySessionContainer = document.createElement('div');
  bySessionContainer.style.display = 'none';

  // --- By Date (existing) ---
  const detailsTitle = document.createElement('h1');
  detailsTitle.textContent = 'Summary';
  byDateContainer.appendChild(detailsTitle);

  // Group data by date for detailed view
  const grouped: { [date: string]: any[] } = {};
  allDailyData.forEach((row: any) => {
    if (!grouped[row.date]) grouped[row.date] = [];
    grouped[row.date].push(row);
  });

  const detailsContainer = document.createElement('div');
  detailsContainer.className = 'details-container';
  detailsContainer.innerHTML = Object.entries(grouped).map(([date, rows]) => `
    <div class="summary-date-header">
      <h3>${date}</h3>
    </div>
    <table class="summary-table">
      <thead>
        <tr>
          <th></th>
          <th>Editor</th>
          <th>Time Spent</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row: any) => `
          <tr>
            <td><img src="${row.icon}" alt="${escapeHtml(row.app)} icon" class="icon" /></td>
            <td>${escapeHtml(row.app)}</td>
            <td>${escapeHtml(formatTimeSpent(row.total_time))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `).join('');
  byDateContainer.appendChild(detailsContainer);

  // --- By Session ---
  const sessionTitle = document.createElement('h1');
  sessionTitle.textContent = 'Sessions';
  bySessionContainer.appendChild(sessionTitle);

  const sessionTable = document.createElement('table');
  sessionTable.className = 'summary-table';
  sessionTable.innerHTML = `
    <thead>
      <tr>
        <th>Name</th>
        <th>Date</th>
        <th>Duration</th>
      </tr>
    </thead>
    <tbody id="sessionTableBody"></tbody>
  `;
  bySessionContainer.appendChild(sessionTable);

  // Fetch and render sessions
  const sessions = await ipcRenderer.invoke('get-sessions');
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const sessionTableBody = sessionTable.querySelector('tbody')!;
  sessionTableBody.innerHTML = sessions.map((session: any) => {
    const start = new Date(session.start_time);
    const end = new Date(session.end_time);
    const durationSec = Math.floor((end.getTime() - start.getTime()) / 1000);
    const h = Math.floor(durationSec / 3600);
    const m = Math.floor((durationSec % 3600) / 60);
    const s = durationSec % 60;
    let durationStr = '';
    if (h > 0) durationStr += `${h}h `;
    if (m > 0) durationStr += `${m}m `;
    if (s > 0 || (!h && !m)) durationStr += `${s}s`;
    return `
      <tr>
        <td>${escapeHtml(session.title)}</td>
        <td>${escapeHtml(session.date)}</td>
        <td>${durationStr.trim()}</td>
      </tr>
    `;
  }).join('');

  summaryDiv.appendChild(byDateContainer);
  summaryDiv.appendChild(bySessionContainer);

  // --- Toggle logic ---
  byDateBtn.onclick = () => {
    byDateBtn.classList.add('active');
    bySessionBtn.classList.remove('active');
    byDateContainer.style.display = '';
    bySessionContainer.style.display = 'none';
  };
  bySessionBtn.onclick = () => {
    bySessionBtn.classList.add('active');
    byDateBtn.classList.remove('active');
    byDateContainer.style.display = 'none';
    bySessionContainer.style.display = '';
  };
}