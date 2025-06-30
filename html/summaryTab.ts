/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ipcRenderer } from 'electron';
import { formatTimeSpent } from '../src/utils/timeFormat';
import edit from '../data/edit.png';
import { escapeHtml, getLocalDateString, getWeekDates, getMonday, filterDailyDataForWeek, getCurrentUserId, prettyDate } from './utils';
import { showModal, showChartConfigModal, renderCustomChart } from './components';
import { PaginationManager, PageInfo } from './utils/performance';
import { createExportModal } from './utils/sessionExporter';
import type { DailySummaryRow, SessionRow, Tag } from '../src/backend/types';
import type { ChartConfig } from './components';

// Store the current week start date (Monday)
let currentWeekMonday = getMonday(new Date());
// Store all daily data for all dates (for client-side week switching, for the chart only)
let allDailyData: DailySummaryRow[] = [];

// Store filtered data for each view
let filteredByDateData: DailySummaryRow[] = [];
let filteredSessions: SessionRow[] = [];

// Sorting state for both views
let byDateSortState: { column: string | null; direction: 'asc' | 'desc' } = { column: null, direction: 'asc' };
let bySessionSortState: { column: string | null; direction: 'asc' | 'desc' } = { column: null, direction: 'asc' };

// Pagination for sessions
let sessionPagination: PaginationManager<SessionRow> | null = null;
const SESSIONS_PER_PAGE = 25;

// Store created charts
const customCharts: Array<{ id: string; config: ChartConfig; data: (DailySummaryRow | SessionRow)[] }> = [];

// Helper functions for chart display
function getAxisLabel(groupBy: string): string {
  switch (groupBy) {
    case 'date': return 'Date';
    case 'language': return 'Programming Language';
    case 'editor': return 'Editor/IDE';
    case 'tag': return 'Tag';
    case 'day-of-week': return 'Day of Week';
    case 'hour-of-day': return 'Hour of Day';
    default: return 'Category';
  }
}

function getDatasetLabel(config: ChartConfig): string {
  switch (config.aggregation) {
    case 'total-time': return 'Total Time';
    case 'session-count': return 'Number of Sessions';
    case 'average-duration': return 'Average Duration';
    default: return 'Value';
  }
}

// Utility function to create sortable header
function createSortableHeader(text: string, columnKey: string, currentSort: { column: string | null; direction: 'asc' | 'desc' }): string {
  const isCurrentColumn = currentSort.column === columnKey;
  const arrow = isCurrentColumn 
    ? (currentSort.direction === 'asc' ? ' ▲' : ' ▼')
    : '';
  
  return `<th class="sortable-header" data-column="${columnKey}">${text}${arrow}</th>`;
}

// Utility function to sort data
function sortData<T>(data: T[], column: string, direction: 'asc' | 'desc', getValue: (item: T, column: string) => string | number): T[] {
  return [...data].sort((a, b) => {
    const aVal = getValue(a, column);
    const bVal = getValue(b, column);
    
    // Handle different data types
    let comparison = 0;
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      comparison = aVal.localeCompare(bVal);
    } else if (typeof aVal === 'number' && typeof bVal === 'number') {
      comparison = aVal - bVal;
    } else {
      // Convert to string for comparison
      comparison = String(aVal).localeCompare(String(bVal));
    }
    
    return direction === 'asc' ? comparison : -comparison;
  });
}

// render timeline
function renderTimelineChart(dailyData: DailySummaryRow[], weekMonday: Date) {
  const timelineContainer = document.createElement('div');
  timelineContainer.className = 'timeline-container';

  // Group data by date and calculate total time per day (in seconds)
  const timeByDate: Record<string, number> = {};
  dailyData.forEach((row: DailySummaryRow) => {
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
    <div class="timeline-header">
      <button id="week-prev-btn">&#8592;</button>
      <h3>
        ${prettyDate(weekDays[0])} - 
        ${prettyDate(weekDays[6])}
      </h3>
      ${
        // Hide right arrow if at current week
        (() => {
          const todayMonday = getMonday(new Date());
          if (weekMonday >= todayMonday) {
            return `<span class="week-nav-spacer"></span>`;
          }
          return `<button id="week-next-btn">&#8594;</button>`;
        })()
      }
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
                <div class="timeline-bar timeline-bar-hidden"></div>
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

// Utility to create a filter bar for a view
function createFilterBar(options: {
  filters: { [key: string]: { type: 'select' | 'date', label: string, options?: string[] } },
  onApply: (filterValues: Record<string, string>) => void,
  onClear: () => void
}) {
  const filterBar = document.createElement('div');
  filterBar.className = 'summary-filter-bar';

  // Build filter controls
  filterBar.innerHTML = Object.entries(options.filters).map(([key, filter]) => {
    if (filter.type === 'select') {
      return `<label>${filter.label}: <select id="filter-${key}"><option value="">All</option>${(filter.options || []).map(opt => `<option value="${opt}">${opt}</option>`).join('')}</select></label>`;
    }
    if (filter.type === 'date') {
      return `<label>${filter.label}: <input type="date" id="filter-${key}"></label>`;
    }
    return '';
  }).join(' ') + `
    <div class="filter-btn-container">
      <button id="filter-apply" class="filter-btn apply">Apply</button>
      <button id="filter-clear" class="filter-btn clear" type="button">Clear</button>
    </div>
  `;

  // Attach handlers
  setTimeout(() => {
    const applyBtn = filterBar.querySelector('#filter-apply') as HTMLButtonElement;
    const clearBtn = filterBar.querySelector('#filter-clear') as HTMLButtonElement;
    if (applyBtn) {
      applyBtn.onclick = () => {
        const filterValues: Record<string, string> = {};
        Object.keys(options.filters).forEach(key => {
          const el = filterBar.querySelector(`#filter-${key}`) as HTMLInputElement | HTMLSelectElement;
          filterValues[key] = el?.value || '';
        });
        options.onApply(filterValues);
      };
    }
    if (clearBtn) {
      clearBtn.onclick = () => {
        Object.keys(options.filters).forEach(key => {
          const el = filterBar.querySelector(`#filter-${key}`) as HTMLInputElement | HTMLSelectElement;
          if (el) el.value = '';
        });
        options.onClear();
      };
    }
  }, 0);

  return filterBar;
}

// Function to add a custom chart
function addCustomChart(config: ChartConfig, data: (DailySummaryRow | SessionRow)[]) {
  const chartId = `chart_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const chartData = { id: chartId, config, data };
  customCharts.push(chartData);
  renderCustomChartsSection();
  
  // Scroll to the newly created chart after a short delay
  setTimeout(() => {
    const newChart = document.getElementById(chartId);
    if (newChart) {
      newChart.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 500);
}

// Function to render the custom charts section
function renderCustomChartsSection() {
  const summaryDiv = document.getElementById('summaryContent');
  if (!summaryDiv) return;
  
  // Find or create the custom charts section
  let chartsSection = summaryDiv.querySelector('.custom-charts-section') as HTMLElement;
  if (!chartsSection) {
    chartsSection = document.createElement('div');
    chartsSection.className = 'custom-charts-section';
    summaryDiv.appendChild(chartsSection);
  }
  
  chartsSection.innerHTML = `
    <h2>
      Custom Charts (${customCharts.length})
      ${customCharts.length > 0 ? '<button class="chart-action-btn" id="clearAllCharts">Clear All</button>' : ''}
    </h2>
  `;
  
  if (customCharts.length === 0) {
    chartsSection.innerHTML += '<p style="color: var(--fg-secondary); font-style: italic;">No custom charts created yet. Use the "📊 Create Chart" buttons above to analyze your data with visual charts.</p>';
    return;
  }
  
  customCharts.forEach((chartData, index) => {
    const chartContainer = document.createElement('div');
    chartContainer.className = 'custom-chart-item';
    chartContainer.innerHTML = `
      <div class="custom-chart-header">
        <div>
          <div class="custom-chart-title">${chartData.config.title}</div>
          <div class="custom-chart-config">
            ${chartData.config.chartType} chart • ${getAxisLabel(chartData.config.groupBy)} vs ${getDatasetLabel(chartData.config)} • ${chartData.data.length} data points
          </div>
        </div>
        <div class="chart-actions">
          <button class="chart-action-btn" data-action="refresh" data-index="${index}">Refresh</button>
          <button class="chart-action-btn" data-action="duplicate" data-index="${index}">Duplicate</button>
          <button class="chart-action-btn" data-action="delete" data-index="${index}">Delete</button>
        </div>
      </div>
      <div class="chart-container" id="${chartData.id}"></div>
    `;
    
    chartsSection.appendChild(chartContainer);
  });
  
  // Render all charts after DOM is ready
  setTimeout(() => {
    customCharts.forEach((chartData) => {
      renderCustomChart(chartData.id, chartData.config, chartData.data, 500, 300);
    });
  }, 100);
  
  // Add event listeners for chart actions
  chartsSection.querySelectorAll('.chart-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = (btn as HTMLElement).getAttribute('data-action');
      const indexStr = (btn as HTMLElement).getAttribute('data-index');
      
      if (action === 'clear' || (btn as HTMLElement).id === 'clearAllCharts') {
        if (confirm('Delete all custom charts?')) {
          customCharts.length = 0;
          renderCustomChartsSection();
        }
        return;
      }
      
      if (indexStr === null) return;
      const index = parseInt(indexStr);
      const chartData = customCharts[index];
      if (!chartData) return;
      
      switch (action) {
        case 'refresh': {
          // Get fresh data and re-render
          const currentData = chartData.config.dataSource === 'sessions' ? filteredSessions : filteredByDateData;
          chartData.data = [...currentData];
          setTimeout(() => {
            renderCustomChart(chartData.id, chartData.config, chartData.data, 500, 300);
          }, 100);
          break;
        }
        case 'duplicate': {
          const newConfig = { ...chartData.config, title: chartData.config.title + ' (Copy)' };
          addCustomChart(newConfig, [...chartData.data]);
          break;
        }
        case 'delete': {
          if (confirm(`Delete chart "${chartData.config.title}"?`)) {
            customCharts.splice(index, 1);
            renderCustomChartsSection();
          }
          break;
        }
      }
    });
  });
}

export async function renderSummary() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).__resetSummaryTabState) {
    currentWeekMonday = getMonday(new Date());
    allDailyData = [];
    filteredByDateData = [];
    filteredSessions = [];
    // Reset sorting state
    byDateSortState = { column: null, direction: 'asc' };
    bySessionSortState = { column: null, direction: 'asc' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).__resetSummaryTabState;
  }
  const summaryDiv = document.getElementById('summaryContent');
  if (!summaryDiv) return;
  summaryDiv.innerHTML = '';

  allDailyData = await ipcRenderer.invoke('get-daily-summary', getCurrentUserId());
  if (!allDailyData || allDailyData.length === 0) {
    summaryDiv.innerHTML = '<p>No summary data available.</p>';
    return;
  }

  // --- Weekly Timeline Chart (always unfiltered) ---
  const weeklySummaryContainer = document.createElement('div');
  weeklySummaryContainer.className = 'weekly-summary';

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
  filterContainer.className = 'summary-filter-container';

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

  // --- By Date (usage summary) ---
  async function renderByDateView() {
    byDateContainer.innerHTML = '';

    // Get unique languages and editors from allDailyData for dropdowns
    const uniqueLangs = Array.from(new Set(allDailyData.map(r => r.language).filter(Boolean)));
    const uniqueApps = Array.from(new Set(allDailyData.map(r => r.app).filter(Boolean)));

    // Create filter bar
    const filterBar = createFilterBar({
      filters: {
        'language-bydate': { type: 'select', label: 'Language', options: uniqueLangs },
        'app-bydate': { type: 'select', label: 'Editor', options: uniqueApps },
        'start-bydate': { type: 'date', label: 'Start' },
        'end-bydate': { type: 'date', label: 'End' }
      },
      onApply: async (filterValues) => {
        const filters: Record<string, string> = {};
        if (filterValues['language-bydate']) filters.language = filterValues['language-bydate'];
        if (filterValues['app-bydate']) filters.app = filterValues['app-bydate'];
        if (filterValues['start-bydate']) filters.startDate = filterValues['start-bydate'];
        if (filterValues['end-bydate']) filters.endDate = filterValues['end-bydate'];
        filteredByDateData = await ipcRenderer.invoke('get-daily-summary', getCurrentUserId(), filters);
        renderByDateTable(filteredByDateData);
      },
      onClear: async () => {
        filteredByDateData = await ipcRenderer.invoke('get-daily-summary', getCurrentUserId());
        renderByDateTable(filteredByDateData);
      }
    });
    byDateContainer.appendChild(filterBar);

    const detailsTitle = document.createElement('h1');
    detailsTitle.textContent = 'Summary';
    detailsTitle.className = 'section-title-with-button';
    
    // Add create chart button next to title
    const createChartBtn = document.createElement('button');
    createChartBtn.textContent = '📊 Create Chart';
    createChartBtn.className = 'create-chart-button';
    createChartBtn.onclick = () => {
      showChartConfigModal({
        data: filteredByDateData,
        dataSource: 'daily-summary',
        onCreateChart: (config, data) => {
          addCustomChart(config, data);
        }
      });
    };
    
    detailsTitle.appendChild(createChartBtn);
    byDateContainer.appendChild(detailsTitle);

    // Initial data load
    if (!filteredByDateData.length) {
      filteredByDateData = await ipcRenderer.invoke('get-daily-summary', getCurrentUserId());
    }
    renderByDateTable(filteredByDateData);
  }

  // Helper to render just the summary table
  function renderByDateTable(data: DailySummaryRow[]) {
    // Remove old table if exists
    const oldTable = byDateContainer.querySelector('.details-container');
    if (oldTable) oldTable.remove();

    // Sort data by date first (descending by default - most recent first)
    const sortedData = byDateSortState.column === 'date' 
      ? sortData(data, 'date', byDateSortState.direction, (item, column) => {
          if (column === 'date') return new Date(item.date).getTime();
          return String(item[column as keyof DailySummaryRow] || '');
        })
      : sortData(data, 'date', 'desc', (item) => new Date(item.date).getTime());
    
    // Group filtered data by date for detailed view
    const grouped: { [date: string]: DailySummaryRow[] } = {};
    sortedData.forEach((row: DailySummaryRow) => {
      if (!grouped[row.date]) grouped[row.date] = [];
      grouped[row.date].push(row);
    });

    // Sort rows within each date group if needed
    Object.keys(grouped).forEach(date => {
      if (byDateSortState.column && byDateSortState.column !== 'date') {
        grouped[date] = sortData(grouped[date], byDateSortState.column, byDateSortState.direction, (item, column) => {
          if (column === 'app') return item.app;
          if (column === 'time') return item.total_time;
          return String(item[column as keyof DailySummaryRow] || '');
        });
      }
    });

    const detailsContainer = document.createElement('div');
    detailsContainer.className = 'details-container';
    
    // Create single table with header
    const table = document.createElement('table');
    table.className = 'summary-table';
    
    // Create table header
    table.innerHTML = `
      <thead>
        <tr>
          <th></th>
          ${createSortableHeader('Editor', 'app', byDateSortState)}
          ${createSortableHeader('Time Spent', 'time', byDateSortState)}
        </tr>
      </thead>
      <tbody></tbody>
    `;
    
    // Generate table content with date separators
    const tbody = table.querySelector('tbody')!;
    let tableContent = '';
    
    Object.entries(grouped).forEach(([date, rows]) => {
      // Add date separator row
      tableContent += `
        <tr class="date-separator-row">
          <td colspan="3" class="date-separator">
            <div class="sortable-header date-header" data-column="date">
              ${prettyDate(date)}${byDateSortState.column === 'date' ? (byDateSortState.direction === 'asc' ? ' ▲' : ' ▼') : ''}
            </div>
          </td>
        </tr>
      `;
      
      // Add data rows for this date
      rows.forEach((row: DailySummaryRow) => {
        tableContent += `
          <tr>
            <td><img src="${row.icon}" alt="${escapeHtml(row.app)} icon" class="icon" /></td>
            <td>${escapeHtml(row.app)}</td>
            <td>${escapeHtml(formatTimeSpent(row.total_time))}</td>
          </tr>
        `;
      });
    });
    
    tbody.innerHTML = tableContent;
    detailsContainer.appendChild(table);
    byDateContainer.appendChild(detailsContainer);

    // Attach click handlers to sortable headers
    table.querySelectorAll('.sortable-header').forEach(header => {
      header.addEventListener('click', () => {
        const column = (header as HTMLElement).getAttribute('data-column');
        if (column) {
          handleByDateSort(column);
        }
      });
    });
  }

  // Handle sorting for by-date view
  function handleByDateSort(column: string) {
    if (byDateSortState.column === column) {
      byDateSortState.direction = byDateSortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
      byDateSortState.column = column;
      byDateSortState.direction = 'asc';
    }
    renderByDateTable(filteredByDateData);
  }

  // --- By Session ---
  async function renderBySessionView() {
    bySessionContainer.innerHTML = '';

    // Fetch all tags and sessions for dropdowns
    const allTags: Tag[] = await ipcRenderer.invoke('get-all-tags', getCurrentUserId());
    let sessions: SessionRow[];
    if (filteredSessions.length) {
      sessions = filteredSessions;
    } else {
      sessions = await ipcRenderer.invoke('get-sessions', getCurrentUserId());
      filteredSessions = sessions;
    }

    // Unique tags for dropdown
    const uniqueTags = Array.from(new Set(sessions.flatMap(s => s.tags || [])));

    // Create filter bar
    const filterBar = createFilterBar({
      filters: {
        'tag-session': { type: 'select', label: 'Tag', options: uniqueTags },
        'start-session': { type: 'date', label: 'Start' },
        'end-session': { type: 'date', label: 'End' }
      },
      onApply: async (filterValues) => {
        const filters: Record<string, string> = {};
        if (filterValues['tag-session']) filters.tag = filterValues['tag-session'];
        if (filterValues['start-session']) filters.startDate = filterValues['start-session'];
        if (filterValues['end-session']) filters.endDate = filterValues['end-session'];
        const filtered = await ipcRenderer.invoke('get-sessions', getCurrentUserId(), filters);
        filteredSessions = filtered;
        renderSessionRows(filtered);
      },
      onClear: async () => {
        filteredSessions = await ipcRenderer.invoke('get-sessions', getCurrentUserId());
        renderSessionRows(filteredSessions);
      }
    });
    bySessionContainer.appendChild(filterBar);

    const sessionTitle = document.createElement('h1');
    sessionTitle.textContent = 'Sessions';
    sessionTitle.className = 'section-title-with-button';

    // Add create chart button next to title
    const createSessionChartBtn = document.createElement('button');
    createSessionChartBtn.textContent = '📊 Create Chart';
    createSessionChartBtn.className = 'create-chart-button';
    createSessionChartBtn.onclick = () => {
      showChartConfigModal({
        data: filteredSessions,
        dataSource: 'sessions',
        onCreateChart: (config, data) => {
          addCustomChart(config, data);
        }
      });
    };
    
    // Add export button next to title
    const exportSessionBtn = document.createElement('button');
    exportSessionBtn.textContent = '📥 Export Data';
    exportSessionBtn.className = 'create-chart-button';
    exportSessionBtn.onclick = () => {
      createExportModal(getCurrentUserId());
    };
    
    sessionTitle.appendChild(createSessionChartBtn);
    sessionTitle.appendChild(exportSessionBtn);
    bySessionContainer.appendChild(sessionTitle);

    const sessionTable = document.createElement('table');
    sessionTable.className = 'summary-table';
    sessionTable.innerHTML = `
      <thead>
        <tr>
          ${createSortableHeader('Name', 'name', bySessionSortState)}
          ${createSortableHeader('Date', 'date', bySessionSortState)}
          ${createSortableHeader('Duration', 'duration', bySessionSortState)}
          <th></th>
        </tr>
      </thead>
      <tbody id="sessionTableBody"></tbody>
    `;
    bySessionContainer.appendChild(sessionTable);

    // Create pagination controls container
    const paginationContainer = document.createElement('div');
    paginationContainer.id = 'sessionPaginationContainer';
    paginationContainer.className = 'pagination-container';
    bySessionContainer.appendChild(paginationContainer);

    // Attach click handlers to sortable headers
    sessionTable.querySelectorAll('.sortable-header').forEach(header => {
      header.addEventListener('click', () => {
        const column = (header as HTMLElement).getAttribute('data-column');
        if (column) {
          handleSessionSort(column);
        }
      });
    });

    // Handle sorting for session view
    function handleSessionSort(column: string) {
      if (bySessionSortState.column === column) {
        bySessionSortState.direction = bySessionSortState.direction === 'asc' ? 'desc' : 'asc';
      } else {
        bySessionSortState.column = column;
        bySessionSortState.direction = 'asc';
      }
      
      // Re-sort and render the current sessions with pagination
      renderSessionRows(filteredSessions);
      
      // Update header arrows
      updateSessionTableHeaders();
    }

    function updateSessionTableHeaders() {
      const headers = sessionTable.querySelectorAll('.sortable-header');
      headers.forEach(header => {
        const column = (header as HTMLElement).getAttribute('data-column');
        const text = header.textContent?.replace(/ [▲▼]/, '') || '';
        const arrow = bySessionSortState.column === column 
          ? (bySessionSortState.direction === 'asc' ? ' ▲' : ' ▼')
          : '';
        header.textContent = text + arrow;
      });
    }

    // Render filtered sessions with pagination
    function renderSessionRows(sessionsToRender: SessionRow[]) {
      // Apply current sorting if any
      let sortedSessions = sessionsToRender;
      if (bySessionSortState.column) {
        sortedSessions = sortData(sessionsToRender, bySessionSortState.column, bySessionSortState.direction, (item, column) => {
          if (column === 'name') return item.title;
          if (column === 'date') return new Date(item.date).getTime();
          if (column === 'duration') return item.duration || 0;
          return String(item[column as keyof SessionRow] || '');
        });
      }

      // Initialize or update pagination
      if (!sessionPagination) {
        sessionPagination = new PaginationManager<SessionRow>(
          SESSIONS_PER_PAGE,
          (pageData, pageInfo) => {
            renderSessionPage(pageData);
            updatePaginationControls(pageInfo);
          }
        );
      }

      // Set data and render first page
      sessionPagination.setData(sortedSessions);
    }

    // Render a single page of sessions
    function renderSessionPage(sessionsToRender: SessionRow[]) {
      const sessionTableBody = sessionTable.querySelector('tbody')!;
      
      sessionTableBody.innerHTML = sessionsToRender.map((session: SessionRow) => {
        const durationSec = session.duration || 0;
        const h = Math.floor(durationSec / 3600);
        const m = Math.floor((durationSec % 3600) / 60);
        const s = durationSec % 60;
        let durationStr = '';
        if (h > 0) durationStr += `${h}h `;
        if (m > 0) durationStr += `${m}m `;
        if (s > 0 || (!h && !m)) durationStr += `${s}s`;
        return `
          <tr data-session-id="${session.id}">
            <td>
              ${escapeHtml(session.title)}
              ${session.tags && session.tags.length ? `<div class="session-tags">
                ${session.tags.map((t: string) => {
                  const tagObj = allTags.find(tag => tag.name === t);
                  const color = tagObj?.color || getComputedStyle(document.body).getPropertyValue('--accent') || '#f0db4f';
                  return `<span class="session-tag" style="background:${color}">${escapeHtml(t)}</span>`;
                }).join('')}
              </div>` : ''}
            </td>
            <td>${prettyDate(session.date)}</td>
            <td>${durationStr.trim()}</td>
            <td>
              <button class="session-edit-btn" title="Edit session">
                <img src="${edit}" alt="Edit">
              </button>
            </td>
          </tr>
        `;
      }).join('');

      // Attach edit button listeners
      sessionTableBody.querySelectorAll('.session-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const tr = (btn as HTMLElement).closest('tr');
          const sessionId = tr?.getAttribute('data-session-id');
          const session = filteredSessions.find((s: SessionRow) => String(s.id) === String(sessionId));
          if (session) showEditSessionModal(session, async () => {
            const updatedSessions = await ipcRenderer.invoke('get-sessions', getCurrentUserId());
            filteredSessions = updatedSessions;
            // Reset filter UI fields
            const tagSelect = filterBar.querySelector('#filter-tag-session') as HTMLSelectElement;
            const startInput = filterBar.querySelector('#filter-start-session') as HTMLInputElement;
            const endInput = filterBar.querySelector('#filter-end-session') as HTMLInputElement;
            if (tagSelect) tagSelect.value = '';
            if (startInput) startInput.value = '';
            if (endInput) endInput.value = '';
            renderSessionRows(updatedSessions);
          });
        });
      });
    }

    // Update pagination controls
    function updatePaginationControls(pageInfo: PageInfo) {
      const paginationContainer = document.getElementById('sessionPaginationContainer')!;
      
      // Clear existing controls
      paginationContainer.innerHTML = '';
      
      if (pageInfo.totalPages <= 1) {
        return; // No pagination needed
      }
      
      // Add pagination info
      const infoDiv = document.createElement('div');
      infoDiv.className = 'pagination-info';
      infoDiv.textContent = `Showing ${pageInfo.startIndex + 1}-${pageInfo.endIndex} of ${pageInfo.totalItems} sessions`;
      paginationContainer.appendChild(infoDiv);
      
      // Add pagination controls
      if (sessionPagination) {
        const controls = sessionPagination.createPaginationControls();
        paginationContainer.appendChild(controls);
      }
    }

    async function showEditSessionModal(session: SessionRow, onChange: () => void) {
      // Fetch all tags for suggestions
      const allTags: Tag[] = await ipcRenderer.invoke('get-all-tags', getCurrentUserId());
      const currentTags: string[] = session.tags || [];

      let selectedTags = [...currentTags];

      showModal({
        title: 'Edit Session',
        fields: [
          { name: 'title', label: 'Title:', type: 'text', value: session.title, required: true },
          { name: 'description', label: 'Description:', type: 'textarea', value: session.description },
          // Add a custom field for tags (will render below)
        ],
        submitText: 'Save',
        cancelText: 'Delete',
        cancelClass: 'delete',
        onSubmit: async (values) => {
          // Get tags from the tag input UI
          const tags = selectedTags;
          await ipcRenderer.invoke('edit-session', {
            userId: getCurrentUserId(),
            id: session.id,
            title: values.title,
            description: values.description,
            tags
          });
          await ipcRenderer.invoke('set-session-tags', getCurrentUserId(), session.id, tags);
          onChange();
        },
        onCancel: async () => {
          if (confirm('Delete this session? This cannot be undone.')) {
            await ipcRenderer.invoke('delete-session', session.id);
            onChange();
          }
        }
      });

      // Render tag input UI below the modal form
      setTimeout(() => {
        const form = document.getElementById('customModalForm');
        if (!form) return;
        const tagDiv = document.createElement('div');
        tagDiv.className = 'modal-tag-section';

        tagDiv.innerHTML = `
        <div class="modal-tag-section">
          <label>Tags:</label>
          <div id="tag-list" class="modal-tag-list"></div>
          <input id="tag-input" type="text" placeholder="Add tag and press Enter">
          <select id="tag-select">
            <option value="">-- no tag selected --</option>
            ${allTags
              .filter((t: Tag) => !selectedTags.includes(t.name))
              .map((t: Tag) => `<option value="${t.name}">${t.name}</option>`)
              .join('')}
          </select>
        </div>
      `;
        form.appendChild(tagDiv);

        const tagList = tagDiv.querySelector('#tag-list') as HTMLDivElement;
        const tagInput = tagDiv.querySelector('#tag-input') as HTMLInputElement;
        const tagSelect = tagDiv.querySelector('#tag-select') as HTMLSelectElement;

        function renderTags() {
          tagList.innerHTML = selectedTags.map(tag =>
            `<span class="modal-tag-item">
            ${tag}
            <button type="button" class="modal-tag-remove" data-tag="${tag}">&times;</button>
          </span>`
          ).join('');
          tagList.querySelectorAll('button[data-tag]').forEach(btn => {
            btn.addEventListener('click', () => {
              const tag = (btn as HTMLButtonElement).dataset.tag!;
              selectedTags = selectedTags.filter(t => t !== tag);
              renderTags();
              // Update dropdown to show removed tag again
              updateTagSelect();
            });
          });
        }

        function updateTagSelect() {
          tagSelect.innerHTML = `<option value="">Add existing tag</option>` +
            allTags
              .filter((t: Tag) => !selectedTags.includes(t.name))
              .map((t: Tag) => `<option value="${t.name}">${t.name}</option>`)
              .join('');
        }

        renderTags();
        updateTagSelect();

        tagInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && tagInput.value.trim()) {
            const tag = tagInput.value.trim();
            if (!selectedTags.includes(tag)) {
              selectedTags.push(tag);
              renderTags();
              updateTagSelect();
            }
            tagInput.value = '';
            e.preventDefault();
          }
        });

        tagSelect.addEventListener('change', () => {
          const tag = tagSelect.value;
          if (tag && !selectedTags.includes(tag)) {
            selectedTags.push(tag);
            renderTags();
            updateTagSelect();
          }
          tagSelect.value = '';
        });
      }, 100);
    }
    renderSessionRows(sessions);
  }

  // Initial render
  await renderByDateView();
  summaryDiv.appendChild(byDateContainer);
  summaryDiv.appendChild(bySessionContainer);
  
  // Initialize custom charts section
  renderCustomChartsSection();

  // --- Toggle logic ---
  byDateBtn.onclick = async () => {
    byDateBtn.classList.add('active');
    bySessionBtn.classList.remove('active');
    byDateContainer.style.display = '';
    bySessionContainer.style.display = 'none';
    filteredByDateData = [];
    // Reset sorting state for by-date view
    byDateSortState = { column: null, direction: 'asc' };
    await renderByDateView();
  };
  bySessionBtn.onclick = async () => {
    bySessionBtn.classList.add('active');
    byDateBtn.classList.remove('active');
    byDateContainer.style.display = 'none';
    bySessionContainer.style.display = '';
    filteredSessions = [];
    // Reset sorting state and pagination for session view
    bySessionSortState = { column: null, direction: 'asc' };
    sessionPagination = null;
    await renderBySessionView();
  };
}