import { escapeHtml, getLocalDateString, getWeekDates, filterDailyDataForWeek } from '../utils';
import type { DailySummaryRow, SessionRow } from '../../src/backend/types';
import type { ChartConfig } from '../components';

// Helper functions for chart display
export function getAxisLabel(groupBy: string): string {
  switch (groupBy) {
    case 'date': return 'Date';
    case 'language': return 'Programming Language';
    case 'app': return 'App/Editor';
    case 'tag': return 'Tag';
    case 'day-of-week': return 'Day of Week';
    case 'hour-of-day': return 'Hour of Day';
    default: return 'Category';
  }
}

export function getDatasetLabel(config: ChartConfig): string {
  switch (config.aggregation) {
    case 'total-time': return 'Total Time';
    case 'session-count': return 'Number of Sessions';
    case 'average-duration': return 'Average Duration';
    default: return 'Value';
  }
}

export function renderTimelineChart(dailyData: DailySummaryRow[], weekMonday: Date): string {
  const weekDates = getWeekDates(weekMonday);
  const filteredData = filterDailyDataForWeek(dailyData, weekMonday);
  
  // Group by date and sum total_time
  const timeByDate = new Map<string, number>();
  filteredData.forEach(row => {
    const current = timeByDate.get(row.date) || 0;
    timeByDate.set(row.date, current + row.total_time);
  });
  
  const maxTime = Math.max(...Array.from(timeByDate.values()), 1);
  
  return `
    <div class="timeline-chart">
      <h3>Week of ${getLocalDateString(weekMonday)}</h3>
      <div class="chart-container">
        ${weekDates.map(date => {
          const dateStr = getLocalDateString(date);
          const time = timeByDate.get(dateStr) || 0;
          const percentage = (time / maxTime) * 100;
          const hours = Math.floor(time / 3600);
          const minutes = Math.floor((time % 3600) / 60);
          
          return `
            <div class="chart-bar-container">
              <div class="chart-bar" style="height: ${percentage}%" title="${hours}h ${minutes}m"></div>
              <div class="chart-label">${date.toLocaleDateString('en-US', { weekday: 'short' })}</div>
            </div>
          `;
        }).join('')}
      </div>
      <div class="chart-controls">
        <button id="prev-week-btn">← Previous Week</button>
        <button id="next-week-btn">Next Week →</button>
      </div>
    </div>
  `;
}

export interface CustomChart {
  id: string;
  config: ChartConfig;
  data: (DailySummaryRow | SessionRow)[];
}

export function addCustomChart(
  charts: CustomChart[],
  config: ChartConfig,
  data: (DailySummaryRow | SessionRow)[]
): void {
  const chartId = `chart-${Date.now()}`;
  charts.push({ id: chartId, config, data });
}

export function renderCustomChartsSection(charts: CustomChart[]): string {
  if (charts.length === 0) {
    return `
      <div class="custom-charts-section">
        <h3>Custom Charts</h3>
        <div class="chart-controls">
          <button id="add-chart-btn" class="primary">Add Chart</button>
        </div>
        <p class="empty-state">No custom charts created yet. Click "Add Chart" to create one.</p>
      </div>
    `;
  }

  return `
    <div class="custom-charts-section">
      <h3>Custom Charts</h3>
      <div class="chart-controls">
        <button id="add-chart-btn" class="primary">Add Chart</button>
        <button id="clear-charts-btn" class="secondary">Clear All Charts</button>
      </div>
      <div class="charts-grid">
        ${charts.map(chart => renderSingleChart(chart)).join('')}
      </div>
    </div>
  `;
}

function renderSingleChart(chart: CustomChart): string {
  const { id, config } = chart;
  
  return `
    <div class="chart-item" id="${id}">
      <div class="chart-header">
        <h4>${escapeHtml(config.title || 'Untitled Chart')}</h4>
        <button class="chart-remove-btn" data-chart-id="${id}" title="Remove chart">×</button>
      </div>
      <div class="chart-content">
        <div id="${id}-canvas"></div>
      </div>
      <div class="chart-info">
        <small>
          ${getAxisLabel(config.groupBy)} vs ${getDatasetLabel(config)}
          ${config.dateRange ? ` (${config.dateRange.start} to ${config.dateRange.end})` : ''}
        </small>
      </div>
    </div>
  `;
}

export function setupCustomChartsEvents(
  charts: CustomChart[],
  onAddChart: () => void,
  onRemoveChart: (chartId: string) => void,
  onClearAllCharts: () => void
): void {
  const addChartBtn = document.getElementById('add-chart-btn');
  if (addChartBtn) {
    addChartBtn.addEventListener('click', onAddChart);
  }
  
  const clearChartsBtn = document.getElementById('clear-charts-btn');
  if (clearChartsBtn) {
    clearChartsBtn.addEventListener('click', onClearAllCharts);
  }
  
  // Setup remove chart event listeners
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('chart-remove-btn')) {
      const chartId = target.dataset.chartId;
      if (chartId) {
        onRemoveChart(chartId);
      }
    }
  });
}
