/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ipcRenderer } from "electron";
import {
  getMonday,
  filterDailyDataForWeek,
  getCurrentUserId,
  safeIpcInvoke,
} from "./utils";
import {
  renderTimelineChart,
  renderCustomChartsSection,
} from "./summary/utils/chartUtils";
import { renderByDateView } from "./summary/summaryByDateView";
import { renderBySessionView } from "./summary/summaryBySessionView";
import {
  createSummaryState,
  resetSummaryState,
  SummaryState,
} from "./summary/summaryState";

// Global state
const summaryState: SummaryState = createSummaryState();

export async function renderSummary() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).__resetSummaryTabState) {
    resetSummaryState(summaryState);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).__resetSummaryTabState;
  }

  const summaryDiv = document.getElementById("summaryContent");
  if (!summaryDiv) return;
  summaryDiv.innerHTML = "";

  // Show loading spinner
  summaryDiv.innerHTML =
    '<div class="tab-loading"><div class="tab-loading-spinner"></div><span class="tab-loading-text">Loading summary…</span></div>';

  summaryState.allDailyData = await safeIpcInvoke(
    "get-daily-summary",
    [getCurrentUserId()],
    { fallback: [] },
  );

  summaryDiv.innerHTML = "";

  if (!summaryState.allDailyData || summaryState.allDailyData.length === 0) {
    summaryDiv.innerHTML = "<p>No summary data available.</p>";
    return;
  }

  // --- Weekly Timeline Chart (always unfiltered) ---
  const weeklySummaryContainer = document.createElement("div");
  weeklySummaryContainer.className = "weekly-summary";

  function updateWeeklySummary() {
    weeklySummaryContainer.innerHTML = "";
    const weekData = filterDailyDataForWeek(
      summaryState.allDailyData,
      summaryState.currentWeekMonday,
    );
    weeklySummaryContainer.appendChild(
      renderTimelineChart(weekData, summaryState.currentWeekMonday),
    );
    attachWeekNavHandlers();
  }

  // Attach navigation button handlers
  function attachWeekNavHandlers() {
    const prevBtn = weeklySummaryContainer.querySelector(
      "#week-prev-btn",
    ) as HTMLButtonElement;
    const nextBtn = weeklySummaryContainer.querySelector(
      "#week-next-btn",
    ) as HTMLButtonElement;
    if (prevBtn) {
      prevBtn.onclick = () => {
        // Go to previous week
        summaryState.currentWeekMonday.setDate(
          summaryState.currentWeekMonday.getDate() - 7,
        );
        updateWeeklySummary();
      };
    }
    if (nextBtn) {
      nextBtn.onclick = () => {
        // Go to next week (but not future)
        const nextMonday = new Date(summaryState.currentWeekMonday);
        nextMonday.setDate(nextMonday.getDate() + 7);
        const todayMonday = getMonday(new Date());
        if (nextMonday <= todayMonday) {
          summaryState.currentWeekMonday = nextMonday;
          updateWeeklySummary();
        }
      };
    }
  }

  updateWeeklySummary();
  summaryDiv.appendChild(weeklySummaryContainer);

  // --- Filter toggle ---
  const filterContainer = document.createElement("div");
  filterContainer.className = "summary-filter-container";

  const byDateBtn = document.createElement("button");
  byDateBtn.textContent = "Summary by Date";
  byDateBtn.className = "summary-filter-btn active";

  const bySessionBtn = document.createElement("button");
  bySessionBtn.textContent = "Summary by Session";
  bySessionBtn.className = "summary-filter-btn";

  filterContainer.appendChild(byDateBtn);
  filterContainer.appendChild(bySessionBtn);
  summaryDiv.appendChild(filterContainer);

  // --- Containers for each summary type ---
  const byDateContainer = document.createElement("div");
  const bySessionContainer = document.createElement("div");
  bySessionContainer.style.display = "none";

  // Initialize views
  await renderByDateView(
    byDateContainer,
    summaryState.allDailyData,
    summaryState.byDateView,
  );
  summaryDiv.appendChild(byDateContainer);
  summaryDiv.appendChild(bySessionContainer);

  // Initialize custom charts section
  const customChartsSection = document.createElement("div");
  customChartsSection.id = "customChartsSection";
  customChartsSection.className = "custom-charts-section";
  summaryDiv.appendChild(customChartsSection);
  renderCustomChartsSection();

  // --- Toggle logic ---
  byDateBtn.onclick = async () => {
    byDateBtn.classList.add("active");
    bySessionBtn.classList.remove("active");
    byDateContainer.style.display = "";
    bySessionContainer.style.display = "none";
    summaryState.byDateView.filteredData = [];
    // Reset sorting state and pagination for by-date view
    summaryState.byDateView.sortState = { column: null, direction: "asc" };
    summaryState.byDateView.pagination = null;
    await renderByDateView(
      byDateContainer,
      summaryState.allDailyData,
      summaryState.byDateView,
    );
  };
  bySessionBtn.onclick = async () => {
    bySessionBtn.classList.add("active");
    byDateBtn.classList.remove("active");
    byDateContainer.style.display = "none";
    bySessionContainer.style.display = "";
    summaryState.bySessionView.filteredSessions = [];
    // Reset sorting state and pagination for session view
    summaryState.bySessionView.sortState = { column: null, direction: "asc" };
    summaryState.bySessionView.pagination = null;
    await renderBySessionView(bySessionContainer, summaryState.bySessionView);
  };
}
