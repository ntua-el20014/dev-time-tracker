import { Chart } from "chart.js/auto";
import type { DailySummaryRow, SessionRow } from "@shared/types";

export function renderPercentBar(
  items: { label: string; percent: number; color: string }[],
  height = 32,
  borderRadius = 8
): string {
  return `
    <div style="display: flex; height: ${height}px; border-radius: ${borderRadius}px; overflow: hidden; border: 1px solid #ccc; margin-bottom: 12px;">
      ${items
        .map(
          (item) => `
        <div title="${item.label}: ${item.percent.toFixed(1)}%" 
             style="width:${item.percent}%;background:${
            item.color
          };display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;">
          ${item.percent > 10 ? item.label : ""}
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

type PieChartContainer = HTMLElement & { _pieChartInstance?: Chart };

export function renderPieChartJS(
  containerId: string,
  items: { label: string; percent: number; color: string }[],
  size = 160
) {
  const container = document.getElementById(
    containerId
  ) as PieChartContainer | null;
  if (!container) return;
  container.innerHTML = "";

  // Create and append canvas
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size / 2;
  container.appendChild(canvas);

  // Destroy previous chart instance if any
  if (container._pieChartInstance) {
    container._pieChartInstance.destroy();
  }

  // Prepare data
  const data = {
    labels: items.map((i) => i.label),
    datasets: [
      {
        data: items.map((i) => i.percent),
        backgroundColor: items.map((i) => i.color),
        borderWidth: 1,
        borderColor: "#fff",
      },
    ],
  };

  // Create Chart.js pie chart
  const chart = new Chart(canvas, {
    type: "pie",
    data,
    options: {
      responsive: false,
      plugins: {
        legend: {
          display: true,
          position: "right",
          labels: {
            boxWidth: 14,
            boxHeight: 12,
            generateLabels: function (chart: Chart) {
              const data = chart.data;
              if (!data.labels || !data.datasets.length) return [];
              const dataset = data.datasets[0];
              return data.labels.map(function (label, i) {
                const value = dataset.data[i];
                const color = (dataset.backgroundColor as string[])[i];
                return {
                  text: `${label} (${
                    typeof value === "number"
                      ? value.toFixed(1)
                      : Array.isArray(value) && typeof value[0] === "number"
                      ? value[0].toFixed(1)
                      : ""
                  }%)`,
                  fillStyle: color,
                  borderRadius: 3,
                  fontColor: color,
                  strokeStyle: color,
                  hidden: !chart.getDataVisibility(i),
                  index: i,
                };
              });
            },
            font: { size: 14 },
          },
        },
        tooltip: {
          callbacks: {
            label: function (ctx) {
              const label = ctx.label || "";
              const value = ctx.parsed || 0;
              return `${label}: ${value.toFixed(1)}%`;
            },
          },
        },
      },
    },
  });

  // Store chart instance for later cleanup
  container._pieChartInstance = chart;
}

type LineChartDataPoint = {
  title: string;
  date: string; // YYYY-MM-DD
  name?: string; // Editor or language
  usage: number; // Usage in seconds or minutes
  color?: string; // Optional: for custom series color
};

type LineChartOptions = {
  containerId: string;
  data: LineChartDataPoint[];
  width?: number;
  height?: number;
  yLabel?: string;
  dateSpan?: string[]; // Optional: array of dates to use as x-axis (for missing days)
};

type LineChartContainer = HTMLElement & { _lineChartInstance?: Chart };

export function renderLineChartJS(opts: LineChartOptions) {
  const {
    containerId,
    data,
    width = 400,
    height = 200,
    yLabel = "Usage",
    dateSpan,
  } = opts;
  const container = document.getElementById(
    containerId
  ) as LineChartContainer | null;
  if (!container) return;
  container.innerHTML = "";

  // Destroy previous chart instance if any
  if (container._lineChartInstance) {
    container._lineChartInstance.destroy();
  }

  // If all data points are missing 'name', use a default name (from title or 'Usage')
  const names = Array.from(new Set(data.map((d) => d.name).filter(Boolean)));
  if (names.length === 0) {
    const defaultName = data[0]?.title || "Usage";
    names.push(defaultName);
    data.forEach((d) => (d.name = defaultName));
  }

  // Get all unique dates (x-axis)
  const dates = dateSpan
    ? dateSpan
    : Array.from(new Set(data.map((d) => d.date))).sort();

  // Assign colors (fallback palette)
  const palette = [
    "#4f8cff",
    "#ffb347",
    "#7ed957",
    "#ff6961",
    "#b19cd9",
    "#f67280",
    "#355c7d",
  ];
  const colorMap: { [name: string]: string } = {};
  names.forEach((name, i) => {
    const custom = data.find((d) => d.name === name && d.color)?.color;
    colorMap[name!] = custom || palette[i % palette.length];
  });

  // Build datasets for Chart.js
  const datasets = names.map((name) => ({
    label: name,
    data: dates.map((date) => {
      const found = data.find((d) => d.name === name && d.date === date);
      return found ? found.usage : 0;
    }),
    borderColor: colorMap[name!],
    backgroundColor: colorMap[name!] + "33", // semi-transparent fill
    tension: 0.2,
    fill: false,
    pointRadius: 3,
    pointHoverRadius: 5,
  }));

  // Create and append canvas
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  container.appendChild(canvas);

  // Use CSS variable for axis/label color
  const axisColor =
    getComputedStyle(document.body).getPropertyValue("--fg").trim() || "#fff";

  // Create Chart.js line chart
  const chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: dates,
      datasets,
    },
    options: {
      responsive: false,
      plugins: {
        legend: {
          labels: {
            color: axisColor,
            font: { size: 13 },
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const label = ctx.dataset.label || "";
              const value = ctx.parsed.y || 0;
              return `${label}: ${value}`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: "Date", color: axisColor },
          ticks: {
            color: axisColor,
            font: { size: 10 }, // smaller font
            maxRotation: 45, // rotate diagonally
            minRotation: 45,
          },
        },
        y: {
          title: { display: true, text: yLabel, color: axisColor },
          ticks: { color: axisColor },
        },
      },
    },
  });

  // Store chart instance for later cleanup
  container._lineChartInstance = chart;
}

export interface ChartConfig {
  title: string;
  chartType: "line" | "bar" | "pie" | "doughnut";
  dataSource: "sessions" | "daily-summary";
  groupBy:
    | "date"
    | "language"
    | "editor"
    | "tag"
    | "day-of-week"
    | "hour-of-day";
  aggregation: "total-time" | "session-count" | "average-duration";
  dateRange?: { start: string; end: string };
  filters?: {
    language?: string;
    editor?: string;
    tag?: string;
  };
}

type CustomChartContainer = HTMLElement & { _customChartInstance?: Chart };

export function renderCustomChart(
  containerId: string,
  config: ChartConfig,
  data: (DailySummaryRow | SessionRow)[]
) {
  const container = document.getElementById(
    containerId
  ) as CustomChartContainer | null;
  if (!container) return;
  container.innerHTML = "";

  // Destroy previous chart instance if any
  if (container._customChartInstance) {
    container._customChartInstance.destroy();
  }

  // Process data based on configuration
  const processedData = processChartData(data, config);

  // Create canvas
  const canvas = document.createElement("canvas");
  container.appendChild(canvas);

  // Get theme colors
  const axisColor =
    getComputedStyle(document.body).getPropertyValue("--fg").trim() || "#333";
  const palette = [
    "#4f8cff",
    "#ffb347",
    "#7ed957",
    "#ff6961",
    "#b19cd9",
    "#f67280",
    "#355c7d",
    "#ff9999",
    "#66b3ff",
    "#99ff99",
  ];

  // Chart configuration
  const chartConfig = {
    type: config.chartType,
    data: {
      labels: processedData.labels,
      datasets: [
        {
          label: getDatasetLabel(config),
          data: processedData.values,
          backgroundColor:
            config.chartType === "pie" || config.chartType === "doughnut"
              ? processedData.labels.map((_, i) => palette[i % palette.length])
              : palette[0] + "80",
          borderColor:
            config.chartType === "pie" || config.chartType === "doughnut"
              ? processedData.labels.map((_, i) => palette[i % palette.length])
              : palette[0],
          borderWidth: 2,
          tension: config.chartType === "line" ? 0.3 : undefined,
          fill: config.chartType === "line" ? false : undefined,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: config.title,
          color: axisColor,
          font: { size: 16, weight: "bold" as const },
        },
        legend: {
          display:
            config.chartType === "pie" || config.chartType === "doughnut",
          labels: {
            color: axisColor,
            font: { size: 12 },
          },
        },
        tooltip: {
          callbacks: {
            label: function (ctx: {
              label?: string;
              parsed: number | { y: number };
            }) {
              const label = ctx.label || "";
              const value =
                typeof ctx.parsed === "number" ? ctx.parsed : ctx.parsed.y;
              const unit = getValueUnit(config.aggregation);
              return `${label}: ${formatChartValue(
                value,
                config.aggregation
              )}${unit}`;
            },
          },
        },
      },
      scales:
        config.chartType !== "pie" && config.chartType !== "doughnut"
          ? {
              x: {
                title: {
                  display: true,
                  text: getAxisLabel(config.groupBy),
                  color: axisColor,
                },
                ticks: {
                  color: axisColor,
                  maxRotation: 45,
                  minRotation: 0,
                },
              },
              y: {
                title: {
                  display: true,
                  text: getDatasetLabel(config),
                  color: axisColor,
                },
                ticks: {
                  color: axisColor,
                  callback: function (value: string | number) {
                    return (
                      formatChartValue(
                        typeof value === "string" ? parseFloat(value) : value,
                        config.aggregation
                      ) + getValueUnit(config.aggregation)
                    );
                  },
                },
              },
            }
          : undefined,
    },
  };

  // Create chart
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chart = new Chart(canvas, chartConfig as any);
  container._customChartInstance = chart;
}

function processChartData(
  data: (DailySummaryRow | SessionRow)[],
  config: ChartConfig
) {
  const grouped: { [key: string]: number[] } = {};

  data.forEach((item) => {
    let key: string;
    let value: number;

    // Determine grouping key
    switch (config.groupBy) {
      case "date": {
        key = "date" in item ? item.date : (item as SessionRow).date;
        break;
      }
      case "language": {
        key = "language" in item ? item.language || "Unknown" : "Unknown";
        break;
      }
      case "editor": {
        key = "app" in item ? item.app || "Unknown" : "Unknown";
        break;
      }
      case "tag": {
        if (config.dataSource === "sessions" && "tags" in item && item.tags) {
          item.tags.forEach((tag: string) => {
            const tagKey = tag || "Untagged";
            if (!grouped[tagKey]) grouped[tagKey] = [];
            const tagValue = getItemValue(item, config.aggregation);
            grouped[tagKey].push(tagValue);
          });
          return; // Skip the rest for tag processing
        } else {
          key = "Untagged";
        }
        break;
      }
      case "day-of-week": {
        const dateStr = "date" in item ? item.date : (item as SessionRow).date;
        const date = new Date(dateStr);
        key = date.toLocaleDateString("en-US", { weekday: "long" });
        break;
      }
      case "hour-of-day": {
        if (config.dataSource === "sessions" && "start_time" in item) {
          const hour = new Date(item.start_time || item.timestamp).getHours();
          key = `${hour}:00`;
        } else {
          key = "All Day"; // Daily summary doesn't have hour data
        }
        break;
      }
      default:
        key = "Unknown";
    }

    if (config.groupBy !== "tag") {
      value = getItemValue(item, config.aggregation);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(value);
    }
  });

  // Aggregate values
  const result: { labels: string[]; values: number[] } = {
    labels: [],
    values: [],
  };

  Object.entries(grouped).forEach(([key, values]) => {
    result.labels.push(key);

    let aggregatedValue: number;
    switch (config.aggregation) {
      case "total-time":
        aggregatedValue = values.reduce((sum, val) => sum + val, 0);
        break;
      case "session-count":
        aggregatedValue = values.length;
        break;
      case "average-duration":
        aggregatedValue =
          values.reduce((sum, val) => sum + val, 0) / values.length;
        break;
      default:
        aggregatedValue = values.reduce((sum, val) => sum + val, 0);
    }

    result.values.push(aggregatedValue);
  });

  // Sort by value (descending) for better visualization
  const sortedIndices = result.values
    .map((val, index) => ({ val, index }))
    .sort((a, b) => b.val - a.val)
    .map((item) => item.index);

  const sortedLabels = sortedIndices.map((i) => result.labels[i]);
  const sortedValues = sortedIndices.map((i) => result.values[i]);

  return { labels: sortedLabels, values: sortedValues };
}

function getItemValue(
  item: DailySummaryRow | SessionRow,
  aggregation: string
): number {
  switch (aggregation) {
    case "total-time":
      return "total_time" in item
        ? item.total_time
        : (item as SessionRow).duration || 0;
    case "session-count":
      return 1; // Each item counts as 1
    case "average-duration":
      return "total_time" in item
        ? item.total_time
        : (item as SessionRow).duration || 0;
    default:
      return "total_time" in item
        ? item.total_time
        : (item as SessionRow).duration || 0;
  }
}

function getDatasetLabel(config: ChartConfig): string {
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

function getAxisLabel(groupBy: string): string {
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

function getValueUnit(aggregation: string): string {
  switch (aggregation) {
    case "total-time":
    case "average-duration":
      return " min";
    case "session-count":
      return "";
    default:
      return "";
  }
}

function formatChartValue(value: number, aggregation: string): string {
  switch (aggregation) {
    case "total-time":
    case "average-duration": {
      const minutes = Math.round(value / 60);
      return minutes.toString();
    }
    case "session-count":
      return Math.round(value).toString();
    default:
      return value.toFixed(1);
  }
}

export function showChartConfigModal(options: {
  data: (DailySummaryRow | SessionRow)[];
  dataSource: "sessions" | "daily-summary";
  onCreateChart: (
    config: ChartConfig,
    data: (DailySummaryRow | SessionRow)[]
  ) => void;
}) {
  const modal = document.createElement("div");
  modal.className = "chart-modal-overlay";

  modal.innerHTML = `
    <div class="chart-modal-content chart-config-modal">
      <div class="chart-modal-header">
        <h3>Create Custom Chart</h3>
        <button class="chart-modal-close">&times;</button>
      </div>
      <div class="chart-modal-body">
        <form id="chartConfigForm">
          <div class="form-group">
            <label for="chartTitle">Chart Title:</label>
            <input type="text" id="chartTitle" class="chart-title-input" value="${
              options.dataSource === "sessions"
                ? "Session Analysis"
                : "Daily Summary Analysis"
            }" required>
          </div>
          
          <div class="form-group">
            <label for="chartType">Chart Type:</label>
            <div id="chartType-container"></div>
          </div>
          
          <div class="form-group">
            <label for="groupBy">Group Data By:</label>
            <div id="groupBy-container"></div>
          </div>
          
          <div class="form-group">
            <label for="aggregation">Show:</label>
            <div id="aggregation-container"></div>
          </div>
          
          <div class="chart-preview">
            <h4>Preview:</h4>
            <div id="chartPreview">
              Configure chart to see preview
            </div>
          </div>
        </form>
      </div>
      <div class="chart-modal-footer">
        <button type="button" class="chart-modal-cancel">Cancel</button>
        <button type="button" class="chart-modal-submit" id="createChartBtn">Create Chart</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Create custom dropdowns
  const { createCustomDropdown } = require("./CustomDropdown");

  const titleInput = modal.querySelector("#chartTitle") as HTMLInputElement;
  const createBtn = modal.querySelector("#createChartBtn") as HTMLButtonElement;
  const cancelBtn = modal.querySelector(
    ".chart-modal-cancel"
  ) as HTMLButtonElement;
  const closeBtn = modal.querySelector(
    ".chart-modal-close"
  ) as HTMLButtonElement;

  // Update preview when form changes
  function updatePreview() {
    const config: ChartConfig = {
      title: titleInput.value,
      chartType: chartTypeDropdown.getValue() as ChartConfig["chartType"],
      dataSource: options.dataSource,
      groupBy: groupByDropdown.getValue() as ChartConfig["groupBy"],
      aggregation: aggregationDropdown.getValue() as ChartConfig["aggregation"],
    };

    if (options.data.length > 0) {
      try {
        renderCustomChart("chartPreview", config, options.data);
      } catch (error) {
        // Handle Preview error silently
      }
    }
  }

  // Chart Type dropdown
  const chartTypeDropdown = createCustomDropdown({
    id: "chartType",
    name: "chartType",
    value: "bar",
    options: [
      { value: "bar", label: "Bar Chart" },
      { value: "line", label: "Line Chart" },
      { value: "pie", label: "Pie Chart" },
      { value: "doughnut", label: "Doughnut Chart" },
    ],
    onChange: updatePreview,
  });
  document
    .getElementById("chartType-container")
    ?.appendChild(chartTypeDropdown.getElement());

  // Group By dropdown
  const groupByOptions = [
    { value: "date", label: "Date" },
    { value: "language", label: "Programming Language" },
    { value: "editor", label: "Editor/IDE" },
    ...(options.dataSource === "sessions"
      ? [{ value: "tag", label: "Tag" }]
      : []),
    { value: "day-of-week", label: "Day of Week" },
    ...(options.dataSource === "sessions"
      ? [{ value: "hour-of-day", label: "Hour of Day" }]
      : []),
  ];
  const groupByDropdown = createCustomDropdown({
    id: "groupBy",
    name: "groupBy",
    value: "date",
    options: groupByOptions,
    onChange: updatePreview,
  });
  document
    .getElementById("groupBy-container")
    ?.appendChild(groupByDropdown.getElement());

  // Aggregation dropdown
  const aggregationOptions = [
    { value: "total-time", label: "Total Time Spent" },
    ...(options.dataSource === "sessions"
      ? [{ value: "session-count", label: "Number of Sessions" }]
      : []),
    ...(options.dataSource === "sessions"
      ? [{ value: "average-duration", label: "Average Session Duration" }]
      : []),
  ];
  const aggregationDropdown = createCustomDropdown({
    id: "aggregation",
    name: "aggregation",
    value: "total-time",
    options: aggregationOptions,
    onChange: updatePreview,
  });
  document
    .getElementById("aggregation-container")
    ?.appendChild(aggregationDropdown.getElement());

  // Add event listeners for preview updates
  titleInput.addEventListener("input", updatePreview);

  // Initial preview
  setTimeout(updatePreview, 100);

  // Focus the title input and select all text for easy editing
  setTimeout(() => {
    titleInput.focus();
    titleInput.select();
  }, 150);

  // Event handlers
  createBtn.addEventListener("click", () => {
    const config: ChartConfig = {
      title: titleInput.value,
      chartType: chartTypeDropdown.getValue() as ChartConfig["chartType"],
      dataSource: options.dataSource,
      groupBy: groupByDropdown.getValue() as ChartConfig["groupBy"],
      aggregation: aggregationDropdown.getValue() as ChartConfig["aggregation"],
    };

    options.onCreateChart(config, options.data);
    modal.remove();
  });

  [cancelBtn, closeBtn].forEach((btn) => {
    btn.addEventListener("click", () => modal.remove());
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });

  // Prevent modal content clicks from bubbling up
  const modalContent = modal.querySelector(".chart-modal-content");
  if (modalContent) {
    modalContent.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }
}
