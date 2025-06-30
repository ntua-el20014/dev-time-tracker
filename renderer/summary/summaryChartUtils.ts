import { formatTimeSpent } from "../../src/utils/timeFormat";
import {
  getLocalDateString,
  getWeekDates,
  getMonday,
  prettyDate,
} from "../utils";
import { renderCustomChart } from "../components";
import type { DailySummaryRow, SessionRow } from "@shared/types";
import type { ChartConfig } from "../components";

// Store created charts
export const customCharts: Array<{
  id: string;
  config: ChartConfig;
  data: (DailySummaryRow | SessionRow)[];
}> = [];

// Helper functions for chart display
export function getAxisLabel(groupBy: string): string {
  switch (groupBy) {
    case "date":
      return "Date";
    case "language":
      return "Programming Language";
    case "editor":
      return "Editor/IDE";
    case "tag":
      return "Tag";
    case "day-of-week":
      return "Day of Week";
    case "hour-of-day":
      return "Hour of Day";
    default:
      return "Category";
  }
}

export function getDatasetLabel(config: ChartConfig): string {
  switch (config.aggregation) {
    case "total-time":
      return "Total Time";
    case "session-count":
      return "Number of Sessions";
    case "average-duration":
      return "Average Duration";
    default:
      return "Value";
  }
}

// Function to add a custom chart
export function addCustomChart(
  config: ChartConfig,
  data: (DailySummaryRow | SessionRow)[]
) {
  const chartId = `custom-chart-${Date.now()}-${Math.random()
    .toString(36)
    .substr(2, 9)}`;
  customCharts.push({ id: chartId, config, data: [...data] });
  renderCustomChartsSection();
}

// Function to render the custom charts section
export function renderCustomChartsSection() {
  const chartsSection = document.getElementById("customChartsSection");
  if (!chartsSection) return;

  chartsSection.innerHTML = "";

  if (customCharts.length === 0) {
    chartsSection.innerHTML =
      '<p style="text-align: center; color: var(--fg-secondary); margin: 20px 0;">No custom charts created yet.</p>';
    return;
  }

  // Add clear all button
  const clearAllBtn = document.createElement("button");
  clearAllBtn.id = "clearAllCharts";
  clearAllBtn.className = "chart-action-btn";
  clearAllBtn.textContent = "🗑️ Clear All Charts";
  clearAllBtn.style.marginBottom = "16px";
  chartsSection.appendChild(clearAllBtn);

  customCharts.forEach((chartData, index) => {
    const chartContainer = document.createElement("div");
    chartContainer.className = "chart-item";
    chartContainer.innerHTML = `
      <div class="chart-header">
        <h4>${chartData.config.title}</h4>
        <div class="chart-actions">
          <button class="chart-action-btn" data-action="refresh" data-index="${index}" title="Refresh with current data">🔄</button>
          <button class="chart-action-btn" data-action="duplicate" data-index="${index}" title="Duplicate chart">📋</button>
          <button class="chart-action-btn" data-action="delete" data-index="${index}" title="Delete chart">🗑️</button>
        </div>
      </div>
      <div class="chart-container" id="${chartData.id}"></div>
    `;

    chartsSection.appendChild(chartContainer);
  });

  // Render all charts after DOM is ready
  setTimeout(() => {
    customCharts.forEach((chartData) => {
      renderCustomChart(
        chartData.id,
        chartData.config,
        chartData.data,
        500,
        300
      );
    });
  }, 100);

  // Add event listeners for chart actions
  chartsSection.querySelectorAll(".chart-action-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = (btn as HTMLElement).getAttribute("data-action");
      const indexStr = (btn as HTMLElement).getAttribute("data-index");

      if (action === "clear" || (btn as HTMLElement).id === "clearAllCharts") {
        if (confirm("Delete all custom charts?")) {
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
        case "refresh": {
          // Get fresh data and re-render
          // Note: This will need to be updated to use the current filtered data from the parent
          setTimeout(() => {
            renderCustomChart(
              chartData.id,
              chartData.config,
              chartData.data,
              500,
              300
            );
          }, 100);
          break;
        }
        case "duplicate": {
          const newConfig = {
            ...chartData.config,
            title: chartData.config.title + " (Copy)",
          };
          addCustomChart(newConfig, [...chartData.data]);
          break;
        }
        case "delete": {
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

// render timeline
export function renderTimelineChart(
  dailyData: DailySummaryRow[],
  weekMonday: Date
) {
  const timelineContainer = document.createElement("div");
  timelineContainer.className = "timeline-container";

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
  const weekDateStrs = weekDays.map((d) => getLocalDateString(d));
  const maxSeconds = Math.max(
    1,
    ...weekDateStrs.map((dateStr) => timeByDate[dateStr] || 0)
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
      ${weekDays
        .map((day) => {
          const dateStr = getLocalDateString(day);
          const dayName = day.toLocaleDateString("en-US", { weekday: "short" });
          const seconds = timeByDate[dateStr] || 0;
          const height =
            seconds > 0 ? (seconds / maxSeconds) * maxBarHeight : 0;
          const isToday = dateStr === todayDateStr;
          const timeText = seconds > 0 ? formatTimeSpent(seconds) : "";
          return `
          <div class="timeline-day ${isToday ? "today" : ""}">
            <div class="timeline-bar-container">
              ${
                seconds > 0
                  ? `
                <div class="timeline-bar" style="height: ${height}px"></div>
                <div class="timeline-hours">${timeText}</div>
              `
                  : `
                <div class="timeline-bar timeline-bar-hidden"></div>
                <div class="timeline-hours"></div>
              `
              }
            </div>
            <div class="timeline-day-label">${dayName}</div>
          </div>
        `;
        })
        .join("")}
    </div>
  `;

  return timelineContainer;
}
