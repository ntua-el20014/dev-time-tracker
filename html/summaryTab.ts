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

function renderTimelineChart(dailyData: any[]) {
  const timelineContainer = document.createElement('div');
  timelineContainer.className = 'timeline-container';

  // Group data by date and calculate total time per day (in hours)
  const timeByDate: Record<string, number> = {};
  dailyData.forEach(row => {
    const date = row.date;
    timeByDate[date] = (timeByDate[date] || 0) + (row.total_time / 3600);
  });

  // Get current week dates (Monday to Sunday)
  const today = new Date();
  const weekDays = getWeekDates(today);
  const todayDateStr = getLocalDateString(today);
  //log
  console.log('Today:', todayDateStr, 'Week Days:', weekDays.map(d => getLocalDateString(d)));

  // Find maximum time for scaling
  const maxHours = Math.max(1, ...Object.values(timeByDate));
  const maxBarHeight = 70;

  // Create chart HTML
  timelineContainer.innerHTML = `
    <div class="timeline-header">
      <h3>Weekly Summary</h3>
    </div>
    <div class="timeline-chart">
      ${weekDays.map(day => {
        const dateStr = getLocalDateString(day);
        const dayName = day.toLocaleDateString('en-US', { weekday: 'short' });
        const hours = timeByDate[dateStr] || 0;
        const height = hours > 0 ? (hours / maxHours * maxBarHeight) : 0;
        const isToday = dateStr === todayDateStr;
        const hoursText = hours > 0 ? `${hours.toFixed(1)}h` : '';
        
        return `
          <div class="timeline-day ${isToday ? 'today' : ''}">
            <div class="timeline-bar-container">
              ${hours > 0 ? `
                <div class="timeline-bar" style="height: ${height}px"></div>
                <div class="timeline-hours">${hoursText}</div>
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

export async function renderSummary() {
  const summaryDiv = document.getElementById('summaryContent');
  if (!summaryDiv) return;

  const daily = await ipcRenderer.invoke('get-daily-summary');
  if (!daily || daily.length === 0) {
    summaryDiv.innerHTML = '<p>No summary data available.</p>';
    return;
  }

  // Clear and add timeline
  summaryDiv.innerHTML = '';
  
  // Create a container for the weekly summary
  const weeklySummaryContainer = document.createElement('div');
  weeklySummaryContainer.className = 'weekly-summary';
  weeklySummaryContainer.appendChild(renderTimelineChart(daily));
  summaryDiv.appendChild(weeklySummaryContainer);

  const detailsTitle = document.createElement('h1');
  detailsTitle.textContent = 'Summary';
  summaryDiv.appendChild(detailsTitle);

  // Group data by date for detailed view
  const grouped: { [date: string]: any[] } = {};
  daily.forEach((row: any) => {
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
  summaryDiv.appendChild(detailsContainer);
}