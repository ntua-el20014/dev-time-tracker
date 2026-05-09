/* eslint-disable @typescript-eslint/no-explicit-any */
import { safeIpcInvoke, withLoading } from "./utils";
import { showNotification } from "./components";
import { getLocalDateString } from "./utils/dateUtils";
import { renderPercentBar, renderPieChartJS } from "./components/Charts";
import type {
  OrgAnalyticsSummary,
  TopProject,
  LanguageBreakdown,
  MemberActivity,
} from "../src/supabase/orgAnalytics";
import type {
  UserProfile,
  CloudProjectWithManager,
} from "../src/types/organization.types";

const currentFilter = {
  startDate: getLocalDateString(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  ), // 30 days ago
  endDate: getLocalDateString(new Date()),
  projectIds: null as string[] | null,
  memberIds: null as string[] | null,
  billableOnly: false,
};

let orgMembers: UserProfile[] = [];
let orgProjects: CloudProjectWithManager[] = [];

/**
 * Main render function for Team Analytics Tab
 */
export async function renderTeamAnalytics() {
  const container = document.getElementById("teamAnalyticsContent");
  if (!container) return;

  container.innerHTML = `
    <div id="team-analytics-inner">
      <h1 class="org-title">Team Analytics</h1>
      <div id="analytics-filters"></div>
      <div id="analytics-loading" style="text-align: center; padding: 20px;">Loading analytics...</div>
      <div id="analytics-content" style="display: none;">
        <div id="analytics-kpi"></div>
        <div id="analytics-charts-row"></div>
        <div id="analytics-member-table"></div>
      </div>
    </div>
  `;

  // Render filters
  await renderFilters();

  // Load and render analytics
  await loadAndRenderAnalytics();
}

/**
 * Render filter controls
 */
async function renderFilters() {
  const filterContainer = document.getElementById("analytics-filters");
  if (!filterContainer) return;

  // Fetch org members and projects for filter options
  try {
    const org = await safeIpcInvoke<any>("org:get-current", [], {
      fallback: null,
    });
    if (!org) {
      filterContainer.innerHTML = "<p>Unable to load organization data</p>";
      return;
    }

    orgMembers = await safeIpcInvoke<UserProfile[]>(
      "org:get-members",
      [org.id],
      {
        fallback: [],
      },
    );
    orgProjects = await safeIpcInvoke<CloudProjectWithManager[]>(
      "org:get-projects",
      [],
      { fallback: [] },
    );
  } catch (err) {
    console.error("Failed to load filter options", err);
  }

  const html = `
    <div class="analytics-filter-bar">
      <div class="filter-group">
        <label>Date Range:</label>
        <input type="date" id="filter-start-date" value="${currentFilter.startDate}" />
        <span>to</span>
        <input type="date" id="filter-end-date" value="${currentFilter.endDate}" />
      </div>

      <div class="filter-group">
        <label>Projects:</label>
        <div id="filter-projects-selector" class="filter-selector">
          <span class="filter-chip-summary" id="projects-summary">All Projects</span>
          <button class="filter-toggle-btn" id="toggle-projects">▼</button>
          <div id="projects-dropdown" class="filter-dropdown" style="display: none;"></div>
        </div>
      </div>

      <div class="filter-group">
        <label>Team Members:</label>
        <div id="filter-members-selector" class="filter-selector">
          <span class="filter-chip-summary" id="members-summary">All Members</span>
          <button class="filter-toggle-btn" id="toggle-members">▼</button>
          <div id="members-dropdown" class="filter-dropdown" style="display: none;"></div>
        </div>
      </div>

      <div class="filter-group">
        <label>
          <input type="checkbox" id="filter-billable-only" ${currentFilter.billableOnly ? "checked" : ""} />
          Billable Only
        </label>
      </div>

      <button id="apply-filters-btn" class="btn btn-primary">Apply Filters</button>
    </div>
  `;

  filterContainer.innerHTML = html;

  // Populate project selector (dropdown lives inside selector so positioning is correct)
  const projectsDiv = document.getElementById("filter-projects-selector");
  const projectsDropdown = document.getElementById("projects-dropdown");
  if (projectsDiv && projectsDropdown) {
    const toggleBtn = projectsDiv.querySelector("#toggle-projects");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        const dd = projectsDiv.querySelector(
          ".filter-dropdown",
        ) as HTMLElement | null;
        if (dd) dd.style.display = dd.style.display === "none" ? "" : "none";
      });
    }

    // Build dropdown contents
    if (orgProjects.length === 0) {
      projectsDropdown.innerHTML = `<div style="padding:8px;">No projects</div>`;
    } else {
      projectsDropdown.innerHTML = `
        <div style="padding: 8px; border-bottom: 1px solid #e0e0e0;">
          <button id="select-all-projects" class="filter-action-btn">Select All</button>
          <button id="clear-projects" class="filter-action-btn">Clear Selection</button>
        </div>
        <div style="max-height: 200px; overflow-y: auto;">
          ${orgProjects
            .map(
              (project) => `
            <label style="display: block; padding: 8px 12px; cursor: pointer;">
              <input type="checkbox" class="project-checkbox" value="${project.id}" />
              ${project.name}
            </label>
          `,
            )
            .join("")}
        </div>
      `;

      const selectAllBtn = projectsDropdown.querySelector(
        "#select-all-projects",
      );
      const clearBtn = projectsDropdown.querySelector("#clear-projects");
      if (selectAllBtn) {
        selectAllBtn.addEventListener("click", () => {
          projectsDropdown
            .querySelectorAll(".project-checkbox")
            .forEach((cb: any) => (cb.checked = true));
          updateSummaryCounts();
        });
      }
      if (clearBtn) {
        clearBtn.addEventListener("click", () => {
          projectsDropdown
            .querySelectorAll(".project-checkbox")
            .forEach((cb: any) => (cb.checked = false));
          updateSummaryCounts();
        });
      }

      // Update summary when checkboxes change
      projectsDropdown.querySelectorAll(".project-checkbox").forEach((cb) => {
        cb.addEventListener("change", updateSummaryCounts);
      });
    }
  }

  // Populate members selector (dropdown is inside selector so positioning is correct)
  const membersDiv = document.getElementById("filter-members-selector");
  const membersDropdownEl = document.getElementById("members-dropdown");
  if (membersDiv && membersDropdownEl) {
    const toggleBtn = membersDiv.querySelector("#toggle-members");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        const dd = membersDiv.querySelector(
          ".filter-dropdown",
        ) as HTMLElement | null;
        if (dd) dd.style.display = dd.style.display === "none" ? "" : "none";
      });
    }

    membersDropdownEl.innerHTML = `
      <div style="padding: 8px; border-bottom: 1px solid #e0e0e0;">
        <button id="select-all-members" class="filter-action-btn">Select All</button>
        <button id="clear-members" class="filter-action-btn">Clear Selection</button>
      </div>
      <div style="max-height: 200px; overflow-y: auto;">
        ${orgMembers
          .map(
            (member) => `
          <label style="display: block; padding: 8px 12px; cursor: pointer;">
            <input type="checkbox" class="member-checkbox" value="${member.id}" />
            ${member.username}
          </label>
        `,
          )
          .join("")}
      </div>
    `;

    // Wire up select/clear buttons and checkbox change handlers
    const selectAllBtn = membersDropdownEl.querySelector("#select-all-members");
    const clearBtn = membersDropdownEl.querySelector("#clear-members");
    if (selectAllBtn) {
      selectAllBtn.addEventListener("click", () => {
        membersDropdownEl
          .querySelectorAll(".member-checkbox")
          .forEach((cb: any) => (cb.checked = true));
        updateSummaryCounts();
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        membersDropdownEl
          .querySelectorAll(".member-checkbox")
          .forEach((cb: any) => (cb.checked = false));
        updateSummaryCounts();
      });
    }

    membersDropdownEl.querySelectorAll(".member-checkbox").forEach((cb) => {
      cb.addEventListener("change", updateSummaryCounts);
    });
  }

  // Wire up apply filters
  const applyBtn = document.getElementById("apply-filters-btn");
  if (applyBtn) {
    applyBtn.addEventListener("click", async () => {
      const startInput = document.getElementById(
        "filter-start-date",
      ) as HTMLInputElement;
      const endInput = document.getElementById(
        "filter-end-date",
      ) as HTMLInputElement;
      const billableInput = document.getElementById(
        "filter-billable-only",
      ) as HTMLInputElement;

      currentFilter.startDate = startInput?.value || currentFilter.startDate;
      currentFilter.endDate = endInput?.value || currentFilter.endDate;
      currentFilter.billableOnly = billableInput?.checked || false;

      // Collect selected members
      const memberCheckboxes = membersDropdownEl?.querySelectorAll(
        ".member-checkbox:checked",
      );
      currentFilter.memberIds =
        memberCheckboxes && memberCheckboxes.length > 0
          ? Array.from(memberCheckboxes).map((cb: any) => cb.value)
          : null;

      // Collect selected projects
      const projectCheckboxes = projectsDropdown?.querySelectorAll(
        ".project-checkbox:checked",
      );
      currentFilter.projectIds =
        projectCheckboxes && projectCheckboxes.length > 0
          ? Array.from(projectCheckboxes).map((cb: any) => cb.value)
          : null;

      await loadAndRenderAnalytics();
    });
  }
}

function updateSummaryCounts() {
  const projectsDropdown = document.getElementById("projects-dropdown");
  const membersDropdown = document.getElementById("members-dropdown");
  const projectsSummary = document.getElementById("projects-summary");
  const membersSummary = document.getElementById("members-summary");

  if (projectsDropdown && projectsSummary) {
    const selected = projectsDropdown.querySelectorAll(
      ".project-checkbox:checked",
    ).length;
    projectsSummary.textContent =
      selected === 0 ? "All Projects" : `${selected} selected`;
  }
  if (membersDropdown && membersSummary) {
    const selected = membersDropdown.querySelectorAll(
      ".member-checkbox:checked",
    ).length;
    membersSummary.textContent =
      selected === 0 ? "All Members" : `${selected} selected`;
  }
}

/**
 * Load and render all analytics data
 */
async function loadAndRenderAnalytics() {
  const container = document.getElementById("analytics-content");
  const loadingDiv = document.getElementById("analytics-loading");

  if (!container || !loadingDiv) return;

  try {
    await withLoading(loadingDiv, "Loading analytics...", async () => {
      // Fetch summary
      const summary = await safeIpcInvoke<OrgAnalyticsSummary>(
        "org:get-analytics-summary",
        [
          currentFilter.startDate,
          currentFilter.endDate,
          currentFilter.billableOnly,
        ],
        { fallback: undefined },
      );

      // Fetch top projects
      const topProjects = await safeIpcInvoke<TopProject[]>(
        "org:get-top-projects",
        [
          currentFilter.startDate,
          currentFilter.endDate,
          currentFilter.projectIds,
          currentFilter.billableOnly,
          5,
        ],
        { fallback: [] },
      );

      // Fetch language breakdown
      const languages = await safeIpcInvoke<LanguageBreakdown[]>(
        "org:get-language-breakdown",
        [
          currentFilter.startDate,
          currentFilter.endDate,
          currentFilter.projectIds,
          currentFilter.memberIds,
          currentFilter.billableOnly,
        ],
        { fallback: [] },
      );

      // Fetch member activity
      const members = await safeIpcInvoke<MemberActivity[]>(
        "org:get-member-activity",
        [
          currentFilter.startDate,
          currentFilter.endDate,
          currentFilter.projectIds,
          currentFilter.memberIds,
          currentFilter.billableOnly,
        ],
        { fallback: [] },
      );

      // Render all sections
      renderKPICards(summary);
      renderCharts(topProjects, languages);
      renderMemberTable(members);

      loadingDiv.style.display = "none";
      container.style.display = "";
    });
  } catch (err) {
    showNotification(
      `Failed to load analytics: ${err instanceof Error ? err.message : "Unknown error"}`,
    );
    loadingDiv.style.display = "none";
  }
}

/**
 * Render KPI cards (summary stats)
 */
function renderKPICards(summary: OrgAnalyticsSummary | null) {
  const kpiDiv = document.getElementById("analytics-kpi");
  if (!kpiDiv) return;

  const summary_data = summary || {
    total_hours_tracked: 0,
    total_sessions: 0,
    active_members: 0,
  };

  kpiDiv.innerHTML = `
    <div class="kpi-cards">
      <div class="kpi-card">
        <div class="kpi-label">Total Hours Tracked</div>
        <div class="kpi-value">${summary_data.total_hours_tracked.toFixed(1)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Sessions</div>
        <div class="kpi-value">${summary_data.total_sessions}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Active Members</div>
        <div class="kpi-value">${summary_data.active_members}</div>
      </div>
    </div>
  `;
}

/**
 * Render charts (projects, languages)
 */
function renderCharts(
  topProjects: TopProject[],
  languages: LanguageBreakdown[],
) {
  const chartsDiv = document.getElementById("analytics-charts-row");
  if (!chartsDiv) return;

  chartsDiv.innerHTML = `
    <div class="charts-row">
      <div class="chart-card">
        <h3>Top Projects</h3>
        <div id="top-projects-chart"></div>
      </div>
      <div class="chart-card">
        <h3>Language Breakdown</h3>
        <div id="language-chart" class="language-pie-chart"></div>
      </div>
    </div>
  `;

  // Render top projects chart
  const projectsChartDiv = document.getElementById("top-projects-chart");
  if (projectsChartDiv && topProjects.length > 0) {
    const projectChartData = topProjects.map((p) => ({
      label: p.project_name,
      percent: 0, // Will calculate below
      color: "",
    }));
    const totalHours = topProjects.reduce((sum, p) => sum + p.total_hours, 0);
    const palette = ["#4f8cff", "#ffb347", "#7ed957", "#ff6961", "#b19cd9"];
    projectChartData.forEach((item, i) => {
      const project = topProjects[i];
      item.percent =
        totalHours > 0 ? (project.total_hours / totalHours) * 100 : 0;
      item.color = palette[i % palette.length];
    });
    renderPercentBar(projectChartData);
    projectsChartDiv.innerHTML += `
      <ul style="list-style: none; padding: 0; margin-top: 12px;">
        ${topProjects
          .map(
            (p) => `
          <li style="padding: 6px 0; font-size: 0.9em;">
            <strong>${p.project_name}:</strong> ${p.total_hours.toFixed(1)}h (${p.session_count} sessions, ${p.active_members} members)
          </li>
        `,
          )
          .join("")}
      </ul>
    `;
  } else if (projectsChartDiv) {
    projectsChartDiv.innerHTML = "<p>No project data</p>";
  }

  // Render language breakdown pie chart
  const langChartDiv = document.getElementById("language-chart");
  if (langChartDiv && languages.length > 0) {
    const langChartData = languages.map((l, i) => ({
      label: l.language,
      percent: l.percentage,
      color: [
        "#4f8cff",
        "#ffb347",
        "#7ed957",
        "#ff6961",
        "#b19cd9",
        "#f67280",
        "#355c7d",
      ][i % 7],
    }));
    renderPieChartJS("language-chart", langChartData, 420);
  } else if (langChartDiv) {
    langChartDiv.innerHTML = "<p>No language data</p>";
  }
}

/**
 * Render member activity table
 */
function renderMemberTable(members: MemberActivity[]) {
  const tableDiv = document.getElementById("analytics-member-table");
  if (!tableDiv) return;

  if (members.length === 0) {
    tableDiv.innerHTML = "<p>No member activity data</p>";
    return;
  }

  const html = `
    <div class="member-table-card">
      <h3>Team Member Activity</h3>
      <table class="analytics-table">
        <thead>
          <tr>
            <th>Member</th>
            <th>Total Hours</th>
            <th>Sessions</th>
            <th>Active Projects</th>
            <th>Top Language</th>
          </tr>
        </thead>
        <tbody>
          ${members
            .map(
              (m) => `
            <tr>
              <td><strong>${m.username}</strong></td>
              <td>${m.total_hours.toFixed(1)}</td>
              <td>${m.session_count}</td>
              <td>${m.active_projects}</td>
              <td>${m.top_language}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  tableDiv.innerHTML = html;
}
