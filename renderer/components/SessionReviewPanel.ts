import { safeIpcInvoke } from "../utils";
import { showConfirmationModal } from "./Modals";
import { showInAppNotification } from "./Notifications";

interface SmallSession {
  id: string;
  title: string;
  start_time: string;
  duration: number;
  description?: string;
}

const THRESHOLD_OPTIONS = [
  { label: "10 seconds", value: 10 },
  { label: "30 seconds", value: 30 },
  { label: "1 minute", value: 60 },
  { label: "5 minutes", value: 300 },
  { label: "10 minutes", value: 600 },
  { label: "30 minutes", value: 1800 },
];

/**
 * Show the Session Review Panel as a modal.
 * Allows users to find and batch-delete short/incomplete sessions.
 * @param onComplete Callback after sessions are deleted (e.g., refresh session list)
 */
export function showSessionReviewPanel(onComplete?: () => void) {
  let currentThreshold = 60; // default: 1 minute
  let sessions: SmallSession[] = [];
  const selectedIds = new Set<string>();

  // Create the modal overlay
  const overlay = document.createElement("div");
  overlay.id = "sessionReviewOverlay";
  overlay.className = "custom-modal-overlay";
  overlay.style.display = "block";
  document.body.appendChild(overlay);

  const modal = document.createElement("div");
  modal.id = "sessionReviewModal";
  modal.className = "active";
  modal.innerHTML = `
    <div class="session-modal-content session-review-panel">
      <button class="modal-close-btn">&times;</button>
      <h2>Review Short Sessions</h2>
      <p class="review-description">
        Find and clean up short or incomplete sessions. Select a duration threshold to find sessions shorter than that.
      </p>
      <div class="review-controls">
        <label for="review-threshold">Show sessions shorter than:</label>
        <select id="review-threshold">
          ${THRESHOLD_OPTIONS.map(
            (opt) =>
              `<option value="${opt.value}" ${opt.value === currentThreshold ? "selected" : ""}>${opt.label}</option>`,
          ).join("")}
        </select>
        <button id="review-fetch-btn" class="btn-confirm">Search</button>
      </div>
      <div id="review-results"></div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => {
    modal.remove();
    overlay.remove();
  };

  // Close handlers
  modal
    .querySelector(".modal-close-btn")!
    .addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  modal
    .querySelector(".session-modal-content")!
    .addEventListener("click", (e) => {
      e.stopPropagation();
    });

  // Fetch logic
  const fetchBtn = modal.querySelector(
    "#review-fetch-btn",
  ) as HTMLButtonElement;
  const thresholdSelect = modal.querySelector(
    "#review-threshold",
  ) as HTMLSelectElement;
  const resultsDiv = modal.querySelector("#review-results") as HTMLDivElement;

  async function fetchSessions() {
    currentThreshold = parseInt(thresholdSelect.value);
    selectedIds.clear();

    resultsDiv.innerHTML =
      '<div class="tab-loading"><div class="tab-loading-spinner"></div><span class="tab-loading-text">Searching…</span></div>';

    sessions = await safeIpcInvoke<SmallSession[]>(
      "get-small-sessions",
      [currentThreshold],
      { fallback: [] },
    );

    renderResults();
  }

  function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }

  function renderResults() {
    if (sessions.length === 0) {
      resultsDiv.innerHTML = `
        <div class="review-empty">
          <p>No sessions found shorter than ${THRESHOLD_OPTIONS.find((o) => o.value === currentThreshold)?.label || currentThreshold + "s"}.</p>
        </div>
      `;
      return;
    }

    resultsDiv.innerHTML = `
      <div class="review-actions-bar">
        <label class="review-select-all-label">
          <input type="checkbox" id="review-select-all" ${selectedIds.size === sessions.length ? "checked" : ""}>
          Select All (${sessions.length} session${sessions.length === 1 ? "" : "s"})
        </label>
        <button id="review-delete-btn" class="btn-delete" ${selectedIds.size === 0 ? "disabled" : ""}>
          Delete Selected (${selectedIds.size})
        </button>
      </div>
      <div class="review-session-list">
        ${sessions
          .map(
            (s) => `
          <div class="review-session-item ${selectedIds.has(String(s.id)) ? "selected" : ""}" data-id="${s.id}">
            <input type="checkbox" class="review-session-check" data-id="${s.id}" ${selectedIds.has(String(s.id)) ? "checked" : ""}>
            <div class="review-session-info">
              <span class="review-session-title">${escapeHtml(s.title || "Untitled")}</span>
              <span class="review-session-meta">
                ${new Date(s.start_time).toLocaleDateString()} ${new Date(s.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                &middot; ${formatDuration(s.duration)}
              </span>
            </div>
          </div>
        `,
          )
          .join("")}
      </div>
    `;

    // Select all
    const selectAllCheckbox = resultsDiv.querySelector(
      "#review-select-all",
    ) as HTMLInputElement;
    selectAllCheckbox.addEventListener("change", () => {
      if (selectAllCheckbox.checked) {
        sessions.forEach((s) => selectedIds.add(String(s.id)));
      } else {
        selectedIds.clear();
      }
      renderResults();
    });

    // Individual checkboxes
    resultsDiv.querySelectorAll(".review-session-check").forEach((checkbox) => {
      checkbox.addEventListener("change", (e) => {
        const target = e.target as HTMLInputElement;
        const id = target.dataset.id!;
        if (target.checked) {
          selectedIds.add(id);
        } else {
          selectedIds.delete(id);
        }
        renderResults();
      });
    });

    // Row click toggles selection
    resultsDiv.querySelectorAll(".review-session-item").forEach((item) => {
      item.addEventListener("click", (e) => {
        // Don't toggle if clicking the checkbox directly
        if (
          (e.target as HTMLElement).classList.contains("review-session-check")
        )
          return;
        const id = (item as HTMLElement).dataset.id!;
        if (selectedIds.has(id)) {
          selectedIds.delete(id);
        } else {
          selectedIds.add(id);
        }
        renderResults();
      });
    });

    // Delete button
    const deleteBtn = resultsDiv.querySelector(
      "#review-delete-btn",
    ) as HTMLButtonElement;
    deleteBtn.addEventListener("click", () => {
      if (selectedIds.size === 0) return;

      showConfirmationModal({
        title: "Delete Sessions",
        message: `Are you sure you want to delete ${selectedIds.size} session${selectedIds.size === 1 ? "" : "s"}? This cannot be undone.`,
        confirmText: `Delete ${selectedIds.size}`,
        confirmClass: "btn-delete",
        onConfirm: async () => {
          const idsToDelete = Array.from(selectedIds);
          const success = await safeIpcInvoke(
            "delete-sessions",
            [idsToDelete],
            { fallback: false },
          );
          if (success) {
            showInAppNotification(
              `Deleted ${idsToDelete.length} session${idsToDelete.length === 1 ? "" : "s"}`,
            );
            // Remove deleted sessions from local list
            sessions = sessions.filter(
              (s) => !idsToDelete.includes(String(s.id)),
            );
            selectedIds.clear();
            renderResults();
            onComplete?.();
          }
        },
      });
    });
  }

  fetchBtn.addEventListener("click", fetchSessions);

  // Auto-fetch on open
  fetchSessions();
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
