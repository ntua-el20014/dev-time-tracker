import { ipcRenderer } from "electron";
import { formatTimeSpent } from "../../src/utils/timeFormat";
import { escapeHtml, getCurrentUserId, prettyDate } from "../utils";
import { showChartConfigModal } from "../components";
import { DateBasedPaginationManager, PageInfo } from "../utils/performance";
import {
  createSortableHeader,
  sortData,
  createFilterBar,
} from "./utils/tableUtils";
import { addCustomChart } from "./utils/chartUtils";
import type { DailySummaryRow } from "@shared/types";

// State for by-date view
export interface ByDateViewState {
  filteredData: DailySummaryRow[];
  sortState: { column: string | null; direction: "asc" | "desc" };
  pagination: DateBasedPaginationManager | null;
}

const DAYS_PER_PAGE = 10;

export function createByDateViewState(): ByDateViewState {
  return {
    filteredData: [],
    sortState: { column: null, direction: "asc" },
    pagination: null,
  };
}

export async function renderByDateView(
  container: HTMLElement,
  allDailyData: DailySummaryRow[],
  state: ByDateViewState
) {
  container.innerHTML = "";

  // Get unique languages and editors from allDailyData for dropdowns
  const uniqueLangs = Array.from(
    new Set(allDailyData.map((r) => r.language).filter(Boolean))
  );
  const uniqueApps = Array.from(
    new Set(allDailyData.map((r) => r.app).filter(Boolean))
  );

  // Create filter bar
  const filterBar = createFilterBar({
    filters: {
      "language-bydate": {
        type: "select",
        label: "Language",
        options: uniqueLangs.filter(
          (lang): lang is string => lang !== undefined
        ),
      },
      "app-bydate": { type: "select", label: "Editor", options: uniqueApps },
      "start-bydate": { type: "date", label: "Start" },
      "end-bydate": { type: "date", label: "End" },
    },
    onApply: async (filterValues) => {
      const filters: Record<string, string> = {};
      if (filterValues["language-bydate"])
        filters.language = filterValues["language-bydate"];
      if (filterValues["app-bydate"]) filters.app = filterValues["app-bydate"];
      if (filterValues["start-bydate"])
        filters.startDate = filterValues["start-bydate"];
      if (filterValues["end-bydate"])
        filters.endDate = filterValues["end-bydate"];
      state.filteredData = await ipcRenderer.invoke(
        "get-daily-summary",
        getCurrentUserId(),
        filters
      );
      renderByDateTable(container, state.filteredData, state);
    },
    onClear: async () => {
      state.filteredData = await ipcRenderer.invoke(
        "get-daily-summary",
        getCurrentUserId()
      );
      renderByDateTable(container, state.filteredData, state);
    },
  });
  container.appendChild(filterBar);

  const detailsTitle = document.createElement("h1");
  detailsTitle.textContent = "Summary";
  detailsTitle.className = "section-title-with-button";

  // Add create chart button next to title
  const createChartBtn = document.createElement("button");
  createChartBtn.textContent = "📊 Create Chart";
  createChartBtn.className = "create-chart-button";
  createChartBtn.onclick = () => {
    showChartConfigModal({
      data: state.filteredData,
      dataSource: "daily-summary",
      onCreateChart: (config, data) => {
        addCustomChart(config, data);
      },
    });
  };

  detailsTitle.appendChild(createChartBtn);
  container.appendChild(detailsTitle);

  // Initial data load
  if (!state.filteredData.length) {
    state.filteredData = await ipcRenderer.invoke(
      "get-daily-summary",
      getCurrentUserId()
    );
  }
  renderByDateTable(container, state.filteredData, state);
}

export function renderByDateTable(
  container: HTMLElement,
  data: DailySummaryRow[],
  state: ByDateViewState
) {
  // Remove old table and pagination if they exist
  const oldTable = container.querySelector(".details-container");
  if (oldTable) oldTable.remove();
  const oldPagination = container.querySelectorAll(".pagination-container");
  oldPagination.forEach((p) => p.remove());

  // Sort data by date first (descending by default - most recent first)
  const sortedData =
    state.sortState.column === "date"
      ? sortData(data, "date", state.sortState.direction, (item, column) => {
          if (column === "date") return new Date(item.date).getTime();
          return String(item[column as keyof DailySummaryRow] || "");
        })
      : sortData(data, "date", "desc", (item) => new Date(item.date).getTime());

  // Apply sorting to non-date columns if needed
  let finalSortedData = sortedData;
  if (state.sortState.column && state.sortState.column !== "date") {
    finalSortedData = sortData(
      sortedData,
      state.sortState.column,
      state.sortState.direction,
      (item, column) => {
        if (column === "app") return item.app;
        if (column === "time") return item.total_time;
        return String(item[column as keyof DailySummaryRow] || "");
      }
    );
  }

  // Initialize or update pagination
  if (!state.pagination) {
    state.pagination = new DateBasedPaginationManager(
      DAYS_PER_PAGE,
      (pageData: DailySummaryRow[], pageInfo: PageInfo) => {
        renderByDatePage(container, pageData, state);
        updateByDatePaginationControls(container, pageInfo, state);
      }
    );
  }

  // Set data and render first page
  state.pagination.setData(finalSortedData);
}

export function renderByDatePage(
  container: HTMLElement,
  dataToRender: DailySummaryRow[],
  state: ByDateViewState
) {
  // Remove old table if exists
  const oldTable = container.querySelector(".details-container");
  if (oldTable) oldTable.remove();

  // Group filtered data by date for detailed view
  const grouped: { [date: string]: DailySummaryRow[] } = {};
  dataToRender.forEach((row: DailySummaryRow) => {
    if (!grouped[row.date]) grouped[row.date] = [];
    grouped[row.date].push(row);
  });

  const detailsContainer = document.createElement("div");
  detailsContainer.className = "details-container";

  // Create single table with header
  const table = document.createElement("table");
  table.className = "summary-table";

  // Create table header
  table.innerHTML = `
    <thead>
      <tr>
        <th></th>
        ${createSortableHeader("Editor", "app", state.sortState)}
        ${createSortableHeader("Time Spent", "time", state.sortState)}
      </tr>
    </thead>
    <tbody></tbody>
  `;

  // Generate table content with date separators
  const tbody = table.querySelector("tbody");
  if (!tbody) return;

  let tableContent = "";

  Object.entries(grouped).forEach(([date, rows]) => {
    // Add date separator row
    tableContent += `
      <tr class="date-separator-row">
        <td colspan="3" class="date-separator">
          <div class="sortable-header date-header" data-column="date">
            ${prettyDate(date)}${
      state.sortState.column === "date"
        ? state.sortState.direction === "asc"
          ? " ▲"
          : " ▼"
        : ""
    }
          </div>
        </td>
      </tr>
    `;

    // Add data rows for this date
    rows.forEach((row: DailySummaryRow) => {
      tableContent += `
        <tr>
          <td><img src="${row.icon}" alt="${escapeHtml(
        row.app
      )} icon" class="icon" /></td>
          <td>${escapeHtml(row.app)}</td>
          <td>${escapeHtml(formatTimeSpent(row.total_time))}</td>
        </tr>
      `;
    });
  });

  tbody.innerHTML = tableContent;
  detailsContainer.appendChild(table);
  container.appendChild(detailsContainer);

  // Attach click handlers to sortable headers
  table.querySelectorAll(".sortable-header").forEach((header) => {
    header.addEventListener("click", () => {
      const column = (header as HTMLElement).getAttribute("data-column");
      if (column) {
        handleByDateSort(container, column, state);
      }
    });
  });
}

export function updateByDatePaginationControls(
  container: HTMLElement,
  pageInfo: PageInfo,
  state: ByDateViewState
) {
  // Always remove any existing pagination containers first
  const oldPaginationContainers = container.querySelectorAll(
    ".pagination-container"
  );
  oldPaginationContainers.forEach((pc) => pc.remove());

  if (pageInfo.totalPages <= 1) {
    return; // No pagination needed
  }

  // Create new pagination container and always append at the end
  const paginationContainer = document.createElement("div");
  paginationContainer.className = "pagination-container";

  // Add pagination info with date range
  const infoDiv = document.createElement("div");
  infoDiv.className = "pagination-info";

  if (state.pagination) {
    const dateRange = state.pagination.getCurrentPageDateRange();
    if (dateRange.startDay === dateRange.endDay) {
      infoDiv.textContent = `Showing day ${dateRange.startDay} of ${dateRange.totalDays} (Page ${pageInfo.currentPage} of ${pageInfo.totalPages})`;
    } else {
      infoDiv.textContent = `Showing days ${dateRange.startDay}-${dateRange.endDay} of ${dateRange.totalDays} (Page ${pageInfo.currentPage} of ${pageInfo.totalPages})`;
    }
  } else {
    const uniqueDates = new Set(state.filteredData.map((row) => row.date)).size;
    infoDiv.textContent = `Showing ${uniqueDates} days of data (Page ${pageInfo.currentPage} of ${pageInfo.totalPages})`;
  }

  paginationContainer.appendChild(infoDiv);

  // Add pagination controls
  if (state.pagination) {
    const controls = state.pagination.createPaginationControls();
    paginationContainer.appendChild(controls);
  }

  // Always append pagination at the bottom
  container.appendChild(paginationContainer);
}

export function handleByDateSort(
  container: HTMLElement,
  column: string,
  state: ByDateViewState
) {
  if (state.sortState.column === column) {
    state.sortState.direction =
      state.sortState.direction === "asc" ? "desc" : "asc";
  } else {
    state.sortState.column = column;
    state.sortState.direction = "asc";
  }

  // Re-render with pagination
  renderByDateTable(container, state.filteredData, state);
}
