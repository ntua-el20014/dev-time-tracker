import { ipcRenderer } from "electron";
import edit from "../../assets/edit.png";
import {
  escapeHtml,
  getCurrentUserId,
  prettyDate,
  safeIpcInvoke,
} from "../utils";
import {
  showModal,
  showChartConfigModal,
  showConfirmationModal,
  showDetailsModal,
} from "../components";
import { PaginationManager, PageInfo } from "../utils/performance";
import { createExportModal } from "../utils/sessionExporter";
import {
  createSortableHeader,
  sortData,
  createFilterBar,
} from "./utils/tableUtils";
import { addCustomChart } from "./utils/chartUtils";
import type { SessionRow, Tag, Project } from "@shared/types";

// State for by-session view
export interface BySessionViewState {
  filteredSessions: SessionRow[];
  sortState: { column: string | null; direction: "asc" | "desc" };
  pagination: PaginationManager<SessionRow> | null;
}

const SESSIONS_PER_PAGE = 25;

export function createBySessionViewState(): BySessionViewState {
  return {
    filteredSessions: [],
    sortState: { column: null, direction: "asc" },
    pagination: null,
  };
}

export async function renderBySessionView(
  container: HTMLElement,
  state: BySessionViewState,
) {
  container.innerHTML = "";

  // Fetch all tags and sessions for dropdowns
  const allTags: Tag[] = await safeIpcInvoke(
    "get-all-tags",
    [getCurrentUserId()],
    { fallback: [] },
  );
  const allProjects = await safeIpcInvoke(
    "get-user-projects",
    [getCurrentUserId()],
    { fallback: [] },
  );
  let sessions: SessionRow[];
  if (state.filteredSessions.length) {
    sessions = state.filteredSessions;
  } else {
    sessions = await safeIpcInvoke("get-sessions", [getCurrentUserId()], {
      fallback: [],
    });
    state.filteredSessions = sessions;
  }

  // Unique tags and projects for dropdowns
  const uniqueTags = Array.from(new Set(sessions.flatMap((s) => s.tags || [])));
  const uniqueProjects = Array.from(
    new Set(sessions.filter((s) => s.project_name).map((s) => s.project_name!)),
  );

  // Create filter bar
  const filterBar = createFilterBar({
    filters: {
      "tag-session": { type: "select", label: "Tag", options: uniqueTags },
      "project-session": {
        type: "select",
        label: "Project",
        options: uniqueProjects,
      },
      "billable-session": {
        type: "select",
        label: "Billable",
        options: ["Yes", "No"],
      },
      "start-session": { type: "date", label: "Start" },
      "end-session": { type: "date", label: "End" },
    },
    onApply: async (filterValues) => {
      const filters: Record<string, string | number | boolean> = {};
      if (filterValues["tag-session"])
        filters.tag = filterValues["tag-session"];
      if (filterValues["project-session"]) {
        // Convert project name to project ID
        const projectName = filterValues["project-session"];
        const project = allProjects.find(
          (p: Project) => p.name === projectName,
        );
        if (project) {
          filters.projectId = project.id;
        }
      }
      if (filterValues["billable-session"]) {
        // Convert "Yes"/"No" to boolean
        filters.billableOnly = filterValues["billable-session"] === "Yes";
      }
      if (filterValues["start-session"])
        filters.startDate = filterValues["start-session"];
      if (filterValues["end-session"])
        filters.endDate = filterValues["end-session"];
      const filtered = await safeIpcInvoke(
        "get-sessions",
        [getCurrentUserId(), filters],
        { fallback: [] },
      );
      state.filteredSessions = filtered;
      renderSessionRows(container, filtered, state, allTags);
    },
    onClear: async () => {
      state.filteredSessions = await safeIpcInvoke(
        "get-sessions",
        [getCurrentUserId()],
        { fallback: [] },
      );
      renderSessionRows(container, state.filteredSessions, state, allTags);
    },
  });
  container.appendChild(filterBar);

  const sessionTitle = document.createElement("h1");
  sessionTitle.textContent = "Sessions";
  sessionTitle.className = "section-title-with-button";

  // Add create chart button next to title
  const createSessionChartBtn = document.createElement("button");
  createSessionChartBtn.textContent = "📊 Create Chart";
  createSessionChartBtn.className = "create-chart-button";
  createSessionChartBtn.onclick = () => {
    showChartConfigModal({
      data: state.filteredSessions,
      dataSource: "sessions",
      onCreateChart: (config, data) => {
        addCustomChart(config, data);
      },
    });
  };

  // Add export button next to title
  const exportSessionBtn = document.createElement("button");
  exportSessionBtn.textContent = "📥 Export Data";
  exportSessionBtn.className = "create-chart-button";
  exportSessionBtn.onclick = () => {
    createExportModal(getCurrentUserId());
  };

  sessionTitle.appendChild(createSessionChartBtn);
  sessionTitle.appendChild(exportSessionBtn);
  container.appendChild(sessionTitle);

  const sessionTable = document.createElement("table");
  sessionTable.className = "summary-table";
  sessionTable.innerHTML = `
    <thead>
      <tr>
        ${createSortableHeader("Name", "name", state.sortState)}
        ${createSortableHeader("Date", "date", state.sortState)}
        ${createSortableHeader("Duration", "duration", state.sortState)}
        ${createSortableHeader("Project", "project", state.sortState)}
        <th></th>
      </tr>
    </thead>
    <tbody id="sessionTableBody"></tbody>
  `;
  container.appendChild(sessionTable);

  // Attach click handlers to sortable headers
  sessionTable.querySelectorAll(".sortable-header").forEach((header) => {
    header.addEventListener("click", () => {
      const column = (header as HTMLElement).getAttribute("data-column");
      if (column) {
        handleSessionSort(container, column, state, allTags);
      }
    });
  });

  renderSessionRows(container, sessions, state, allTags);
}

export function handleSessionSort(
  container: HTMLElement,
  column: string,
  state: BySessionViewState,
  allTags: Tag[],
) {
  if (state.sortState.column === column) {
    state.sortState.direction =
      state.sortState.direction === "asc" ? "desc" : "asc";
  } else {
    state.sortState.column = column;
    state.sortState.direction = "asc";
  }

  // Re-sort and render the current sessions with pagination
  renderSessionRows(container, state.filteredSessions, state, allTags);

  // Update header arrows
  updateSessionTableHeaders(container, state);
}

export function updateSessionTableHeaders(
  container: HTMLElement,
  state: BySessionViewState,
) {
  const headers = container.querySelectorAll(".sortable-header");
  headers.forEach((header) => {
    const column = (header as HTMLElement).getAttribute("data-column");
    const text = header.textContent?.replace(/ [▲▼]/, "") || "";
    const arrow =
      state.sortState.column === column
        ? state.sortState.direction === "asc"
          ? " ▲"
          : " ▼"
        : "";
    header.textContent = text + arrow;
  });
}

export function renderSessionRows(
  container: HTMLElement,
  sessionsToRender: SessionRow[],
  state: BySessionViewState,
  allTags: Tag[],
) {
  // Apply current sorting if any
  let sortedSessions = sessionsToRender;
  if (state.sortState.column) {
    sortedSessions = sortData(
      sessionsToRender,
      state.sortState.column,
      state.sortState.direction,
      (item, column) => {
        if (column === "name") return item.title;
        if (column === "date") return new Date(item.date).getTime();
        if (column === "duration") return item.duration || 0;
        if (column === "project") return item.project_name || "";
        return String(item[column as keyof SessionRow] || "");
      },
    );
  }

  // Initialize or update pagination
  if (!state.pagination) {
    state.pagination = new PaginationManager<SessionRow>(
      SESSIONS_PER_PAGE,
      (pageData, pageInfo) => {
        renderSessionPage(container, pageData, state, allTags);
        updatePaginationControls(container, pageInfo, state);
      },
    );
  }

  // Set data and render first page
  state.pagination.setData(sortedSessions);
}

export function renderSessionPage(
  container: HTMLElement,
  sessionsToRender: SessionRow[],
  state: BySessionViewState,
  allTags: Tag[],
) {
  const sessionTableBody = container.querySelector("#sessionTableBody");
  if (!sessionTableBody) return;

  sessionTableBody.innerHTML = sessionsToRender
    .map((session: SessionRow) => {
      const durationSec = session.duration || 0;
      const h = Math.floor(durationSec / 3600);
      const m = Math.floor((durationSec % 3600) / 60);
      const s = durationSec % 60;
      let durationStr = "";
      if (h > 0) durationStr += `${h}h `;
      if (m > 0) durationStr += `${m}m `;
      if (s > 0 || (!h && !m)) durationStr += `${s}s`;
      return `
      <tr class="clickable-row" data-session-id="${session.id}">
        <td>
          ${escapeHtml(session.title)}
          ${
            session.tags && session.tags.length
              ? `<div class="session-tags">
            ${session.tags
              .map((t: string) => {
                const tagObj = allTags.find((tag) => tag.name === t);
                const color =
                  tagObj?.color ||
                  getComputedStyle(document.body).getPropertyValue(
                    "--accent",
                  ) ||
                  "#f0db4f";
                return `<span class="session-tag" style="background:${color}">${escapeHtml(
                  t,
                )}</span>`;
              })
              .join("")}
          </div>`
              : ""
          }
        </td>
        <td>${prettyDate(session.date)}</td>
        <td>${durationStr.trim()}</td>
        <td>
          ${
            session.project_name
              ? `<div class="session-project">
                  <div class="project-indicator" style="background-color: ${
                    session.project_color || "#3b82f6"
                  }"></div>
                  <span class="project-name">${escapeHtml(
                    session.project_name,
                  )}</span>
                  ${
                    session.is_billable
                      ? '<span class="billable-indicator" title="Billable">💰</span>'
                      : ""
                  }
                </div>`
              : `<span class="no-project">No project</span>`
          }
        </td>
        <td>
          <button class="session-edit-btn" title="Edit session">
            <img src="${edit}" alt="Edit">
          </button>
        </td>
      </tr>
    `;
    })
    .join("");

  // Attach edit button listeners
  sessionTableBody.querySelectorAll(".session-edit-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const tr = (btn as HTMLElement).closest("tr");
      const sessionId = tr?.getAttribute("data-session-id");
      const session = state.filteredSessions.find(
        (s: SessionRow) => String(s.id) === String(sessionId),
      );
      if (session)
        showEditSessionModal(session, allTags, async () => {
          const updatedSessions = await safeIpcInvoke(
            "get-sessions",
            [getCurrentUserId()],
            { fallback: [] },
          );
          state.filteredSessions = updatedSessions;
          // Reset filter UI fields
          const filterBar = container.querySelector(".summary-filter-bar");
          if (filterBar) {
            const tagSelect = filterBar.querySelector(
              "#filter-tag-session",
            ) as HTMLSelectElement;
            const startInput = filterBar.querySelector(
              "#filter-start-session",
            ) as HTMLInputElement;
            const endInput = filterBar.querySelector(
              "#filter-end-session",
            ) as HTMLInputElement;
            if (tagSelect) tagSelect.value = "";
            if (startInput) startInput.value = "";
            if (endInput) endInput.value = "";
          }
          renderSessionRows(container, updatedSessions, state, allTags);
        });
    });
  });

  // Attach row click listeners for details
  sessionTableBody.querySelectorAll(".clickable-row").forEach((row) => {
    row.addEventListener("click", () => {
      const sessionId = (row as HTMLElement).getAttribute("data-session-id");
      const session = state.filteredSessions.find(
        (s: SessionRow) => String(s.id) === String(sessionId),
      );
      if (session && sessionId) {
        showDetailsModal({
          type: "session",
          data: {
            sessionId: parseInt(sessionId),
            title: session.title,
          },
        });
      }
    });
  });
}

export function updatePaginationControls(
  container: HTMLElement,
  pageInfo: PageInfo,
  state: BySessionViewState,
) {
  // Always remove any existing pagination containers first
  const oldPaginationContainers = container.querySelectorAll(
    ".pagination-container",
  );
  oldPaginationContainers.forEach((pc) => pc.remove());

  if (pageInfo.totalPages <= 1) {
    return; // No pagination needed
  }

  // Create new pagination container and always append at the end
  const paginationContainer = document.createElement("div");
  paginationContainer.className = "pagination-container";

  // Add pagination info
  const infoDiv = document.createElement("div");
  infoDiv.className = "pagination-info";
  infoDiv.textContent = `Showing ${pageInfo.startIndex + 1}-${
    pageInfo.endIndex
  } of ${pageInfo.totalItems} sessions`;
  paginationContainer.appendChild(infoDiv);

  // Add pagination controls
  if (state.pagination) {
    const controls = state.pagination.createPaginationControls();
    paginationContainer.appendChild(controls);
  }

  // Always append pagination at the bottom
  container.appendChild(paginationContainer);
}

export async function showEditSessionModal(
  session: SessionRow,
  allTags: Tag[],
  onChange: () => void,
) {
  const currentTags: string[] = session.tags || [];
  let selectedTags = [...currentTags];

  showModal({
    title: "Edit Session",
    fields: [
      { name: "title", label: "Title:", type: "text", value: session.title },
      {
        name: "description",
        label: "Description:",
        type: "textarea",
        value: session.description || "",
      },
      {
        name: "duration",
        label: "Duration (seconds):",
        type: "text",
        value: String(session.duration || 0),
      },
    ],
    submitText: "Save Changes",
    cancelText: "Cancel",
    cancelClass: "",
    onSubmit: async (values) => {
      await ipcRenderer.invoke("edit-session", {
        userId: getCurrentUserId(),
        id: session.id,
        title: values.title,
        description: values.description,
        tags: selectedTags,
      });
      await ipcRenderer.invoke(
        "set-session-tags",
        getCurrentUserId(),
        session.id,
        selectedTags,
      );
      onChange();
    },
    onCancel: () => {
      // Just cancel - no action needed, modal will close automatically
      return;
    },
  });

  // Render tag input UI below the modal form
  setTimeout(() => {
    const form = document.getElementById("customModalForm");
    if (!form) return;

    // Add delete button to the modal actions
    const actionsDiv = form.querySelector(".session-modal-actions");
    if (actionsDiv) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn-delete";
      deleteBtn.textContent = "Delete Session";

      deleteBtn.addEventListener("click", async () => {
        showConfirmationModal({
          title: "Delete Session",
          message: "Delete this session? This cannot be undone.",
          confirmText: "Delete",
          confirmClass: "btn-delete",
          onConfirm: async () => {
            await ipcRenderer.invoke("delete-session", session.id);
            // Close the modal manually
            const modal = document.getElementById("customModal");
            const closeBtn = modal?.querySelector(
              ".modal-close-btn",
            ) as HTMLButtonElement;
            closeBtn?.click();
            onChange();
          },
        });
      });

      // Insert delete button before the cancel button
      const cancelBtn = actionsDiv.querySelector("#customModalCancelBtn");
      if (cancelBtn) {
        actionsDiv.insertBefore(deleteBtn, cancelBtn);
      }
    }

    const tagDiv = document.createElement("div");
    tagDiv.className = "modal-tag-section";

    tagDiv.innerHTML = `
      <div class="modal-tag-section">
        <select id="tag-select">
          <option value="">Add existing tag</option>
          ${allTags
            .filter((t: Tag) => !selectedTags.includes(t.name))
            .map((t: Tag) => `<option value="${t.name}">${t.name}</option>`)
            .join("")}
        </select>
        <label>Tags:</label>
        <div id="tag-list" class="modal-tag-list"></div>
        <input id="tag-input" type="text" placeholder="Add tag and press Enter">
      </div>
    `;
    form.appendChild(tagDiv);

    const tagList = tagDiv.querySelector("#tag-list") as HTMLDivElement;
    const tagInput = tagDiv.querySelector("#tag-input") as HTMLInputElement;
    const tagSelect = tagDiv.querySelector("#tag-select") as HTMLSelectElement;

    function renderTags() {
      tagList.innerHTML = selectedTags
        .map(
          (tag) =>
            `<span class="modal-tag-item">
          ${tag}
          <button type="button" class="modal-tag-remove" data-tag="${tag}">&times;</button>
        </span>`,
        )
        .join("");
      tagList.querySelectorAll("button[data-tag]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const tag = (btn as HTMLButtonElement).dataset.tag;
          if (tag) {
            selectedTags = selectedTags.filter((t) => t !== tag);
            renderTags();
            updateTagSelect();
          }
        });
      });
    }

    function updateTagSelect() {
      tagSelect.innerHTML =
        `<option value="">Add existing tag</option>` +
        allTags
          .filter((t: Tag) => !selectedTags.includes(t.name))
          .map((t: Tag) => `<option value="${t.name}">${t.name}</option>`)
          .join("");
    }

    renderTags();
    updateTagSelect();

    tagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && tagInput.value.trim()) {
        const tag = tagInput.value.trim();
        if (!selectedTags.includes(tag)) {
          selectedTags.push(tag);
          renderTags();
          updateTagSelect();
        }
        tagInput.value = "";
        e.preventDefault();
      }
    });

    tagSelect.addEventListener("change", () => {
      const tag = tagSelect.value;
      if (tag && !selectedTags.includes(tag)) {
        selectedTags.push(tag);
        renderTags();
        updateTagSelect();
      }
      tagSelect.value = "";
    });

    // Move the modal buttons below the tags section after all event listeners are attached
    const actionsContainer = form.querySelector(".session-modal-actions");
    if (actionsContainer) {
      form.appendChild(actionsContainer);
    }
  }, 100);
}
