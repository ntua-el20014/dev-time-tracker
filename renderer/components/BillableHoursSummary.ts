import { safeIpcInvoke } from "../utils";
import { showInAppNotification } from "./Notifications";

interface BillableHoursSummary {
  projectId: string;
  projectName: string;
  projectColor: string;
  hourlyRate: number | null;
  billableHours: number;
  billableSeconds: number;
  billableSessions: number;
  earnings: number;
}

interface EarningsSummary {
  totalEarnings: number;
  totalBillableHours: number;
  totalBillableSessions: number;
  byProject: BillableHoursSummary[];
  startDate: string;
  endDate: string;
}

let billableSummaryMonth = new Date();

function getMonthBounds(date: Date) {
  const startDate = new Date(date.getFullYear(), date.getMonth(), 1);
  const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);

  return {
    monthLabel: date.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    }),
    startDate: startDate.toISOString().split("T")[0],
    endDate: endDate.toISOString().split("T")[0],
  };
}

async function loadMonthlyEarnings(date: Date): Promise<EarningsSummary> {
  const { startDate, endDate } = getMonthBounds(date);

  return safeIpcInvoke("get-earnings-for-range", [startDate, endDate], {
    fallback: {
      totalEarnings: 0,
      totalBillableHours: 0,
      totalBillableSessions: 0,
      byProject: [],
      startDate,
      endDate,
    },
  });
}

function renderBillableHoursMarkup(
  summary: EarningsSummary,
  monthLabel: string,
) {
  const activeMonth = new Date(
    billableSummaryMonth.getFullYear(),
    billableSummaryMonth.getMonth(),
    1,
  );
  const currentMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  );
  const canGoNext = activeMonth.getTime() < currentMonth.getTime();

  return `
    <div class="billable-hours-summary">
      <div class="billable-summary-header">
        <div>
          <h3>💰 Billable Hours & Earnings</h3>
          <div class="billable-date-range">${monthLabel}</div>
        </div>
        <div class="billable-month-nav" aria-label="Month navigation">
          <button type="button" class="billable-month-nav-btn" data-month-action="prev" aria-label="Previous month">‹</button>
          <button type="button" class="billable-month-nav-btn billable-month-nav-today" data-month-action="current" aria-label="Current month">This Month</button>
          <button type="button" class="billable-month-nav-btn" data-month-action="next" aria-label="Next month" ${canGoNext ? "" : "disabled"}>›</button>
        </div>
      </div>
      
      <div class="billable-totals">
        <div class="billable-total-card">
          <div class="billable-total-value">$${summary.totalEarnings.toFixed(2)}</div>
          <div class="billable-total-label">Total Earnings</div>
        </div>
        <div class="billable-total-card">
          <div class="billable-total-value">${summary.totalBillableHours.toFixed(1)}h</div>
          <div class="billable-total-label">Billable Hours</div>
        </div>
        <div class="billable-total-card">
          <div class="billable-total-value">${summary.totalBillableSessions}</div>
          <div class="billable-total-label">Billable Sessions</div>
        </div>
      </div>
      
      ${
        summary.byProject.length > 0
          ? `
        <div class="billable-projects-table">
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Hourly Rate</th>
                <th>Hours</th>
                <th>Sessions</th>
                <th>Earnings</th>
              </tr>
            </thead>
            <tbody>
              ${summary.byProject
                .map(
                  (project: BillableHoursSummary) => `
                <tr>
                  <td>
                    <div class="project-name-cell">
                      <div class="project-color-dot" style="background-color: ${project.projectColor}"></div>
                      <span>${project.projectName}</span>
                    </div>
                  </td>
                  <td>
                    ${project.hourlyRate != null ? `$${project.hourlyRate.toFixed(2)}/h` : "No rate"}
                  </td>
                  <td>${project.billableHours.toFixed(1)}h</td>
                  <td>${project.billableSessions}</td>
                  <td class="earnings-value">$${project.earnings.toFixed(2)}</td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `
          : `
        <div class="billable-empty-state">
          <p>No billable hours tracked for this month</p>
        </div>
      `
      }
    </div>
  `;
}

async function renderBillableHoursSummaryInternal(container: HTMLElement) {
  const activeMonth = new Date(
    billableSummaryMonth.getFullYear(),
    billableSummaryMonth.getMonth(),
    1,
  );
  const summary = await loadMonthlyEarnings(activeMonth);
  const { monthLabel } = getMonthBounds(activeMonth);

  container.innerHTML = renderBillableHoursMarkup(summary, monthLabel);

  const navButtons = container.querySelectorAll(".billable-month-nav-btn");
  navButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.getAttribute("data-month-action");

      if (action === "prev") {
        billableSummaryMonth = new Date(
          billableSummaryMonth.getFullYear(),
          billableSummaryMonth.getMonth() - 1,
          1,
        );
      } else if (action === "next") {
        billableSummaryMonth = new Date(
          billableSummaryMonth.getFullYear(),
          billableSummaryMonth.getMonth() + 1,
          1,
        );
      } else {
        billableSummaryMonth = new Date();
      }

      await renderBillableHoursSummaryInternal(container);
    });
  });
}

export async function renderBillableHoursSummary(
  container: HTMLElement,
): Promise<void> {
  try {
    await renderBillableHoursSummaryInternal(container);
  } catch (error) {
    console.error("Error rendering billable hours summary:", error);
    showInAppNotification({
      type: "error",
      message: "Failed to load billable hours summary",
    });
  }
}

export async function renderEarningsWidget(): Promise<HTMLElement> {
  const widget = document.createElement("div");
  widget.className = "dashboard-earnings-widget";

  try {
    const summary = await safeIpcInvoke("get-current-month-earnings", [], {
      fallback: {
        totalEarnings: 0,
        totalBillableHours: 0,
        totalBillableSessions: 0,
        byProject: [],
        startDate: new Date().toISOString().split("T")[0],
        endDate: new Date().toISOString().split("T")[0],
      },
    });

    widget.innerHTML = `
      <div class="earnings-widget-content">
        <div class="earnings-widget-header">
          <h3>💰 Current Period Earnings</h3>
        </div>
        <div class="earnings-widget-stats">
          <div class="earnings-stat">
            <div class="earnings-stat-value">$${summary.totalEarnings.toFixed(2)}</div>
            <div class="earnings-stat-label">Total Earnings</div>
          </div>
          <div class="earnings-stat">
            <div class="earnings-stat-value">${summary.totalBillableHours.toFixed(1)}h</div>
            <div class="earnings-stat-label">Billable Hours</div>
          </div>
        </div>
        <div class="earnings-widget-footer">
          ${summary.startDate} - ${summary.endDate}
        </div>
      </div>
    `;
  } catch (error) {
    console.error("Error rendering earnings widget:", error);
    widget.innerHTML = `
      <div class="earnings-widget-content">
        <div class="earnings-widget-header">
          <h3>💰 Current Period Earnings</h3>
        </div>
        <div class="earnings-widget-error">
          <p>Unable to load earnings data</p>
        </div>
      </div>
    `;
  }

  return widget;
}
