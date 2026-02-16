import { showInAppNotification, showNotification } from "./Notifications";
import { showConfirmationModal } from "./Modals";
import { clearAllOnboardingData } from "./Onboarding";
import { renderUserRoleManager } from "./UserRoleManager";
import { isCurrentUserAdmin } from "../utils/userUtils";
import { SessionExporter, createExportModal } from "../utils/sessionExporter";

// Supabase handles automatic backups. Manual backup/rollback of raw DB files
// is no longer applicable.  Export (JSON / CSV) is still available via the
// SessionExporter which fetches data from Supabase.

export function createClearOnboardingButton(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "goal-btn";
  btn.textContent = "Clear All Onboarding Data";
  btn.style.background = "#ff6b6b";
  btn.style.color = "white";

  btn.onclick = async () => {
    showConfirmationModal({
      title: "Clear Onboarding Data",
      message:
        "Are you sure you want to clear all onboarding completion data? This will cause the onboarding tour to show for all users on their next login.",
      confirmText: "Clear",
      confirmClass: "btn-delete",
      onConfirm: async () => {
        try {
          clearAllOnboardingData();
          showNotification(
            "All onboarding data cleared successfully! Users will see the onboarding tour on their next login.",
          );
        } catch (error) {
          showInAppNotification(
            "Failed to clear onboarding data: " +
              (error instanceof Error ? error.message : "Unknown error"),
          );
        }
      },
    });
  };
  return btn;
}

export async function renderAdminPanel(container: HTMLElement) {
  container.innerHTML = "";

  // Check if current user is admin
  const isAdmin = await isCurrentUserAdmin();

  if (!isAdmin) {
    container.innerHTML = `
      <div class="access-denied">
        <h2>Access Denied</h2>
        <p>You don't have permission to access the admin panel. Only administrators can access this section.</p>
      </div>
    `;
    return container;
  }

  const title = document.createElement("h2");
  title.style.marginBottom = "30px";
  title.textContent = "Admin Panel";
  container.appendChild(title);

  // User Management Section
  const userManagementSection = document.createElement("div");
  userManagementSection.className = "admin-section";

  const userManagementTitle = document.createElement("h3");
  userManagementTitle.textContent = "User Management";
  userManagementTitle.style.marginBottom = "15px";
  userManagementTitle.style.color = "var(--fg-muted)";
  userManagementSection.appendChild(userManagementTitle);

  const userManagementContainer = document.createElement("div");
  userManagementContainer.id = "userManagementContainer";
  userManagementSection.appendChild(userManagementContainer);

  container.appendChild(userManagementSection);

  // Render user role manager
  await renderUserRoleManager(userManagementContainer);

  // User data management
  const userDataSeparator = document.createElement("hr");
  userDataSeparator.style.margin = "20px 0";
  container.appendChild(userDataSeparator);

  const userDataTitle = document.createElement("h3");
  userDataTitle.textContent = "User Data Management";
  userDataTitle.style.marginBottom = "15px";
  userDataTitle.style.color = "var(--fg-muted)";
  container.appendChild(userDataTitle);

  container.appendChild(createClearOnboardingButton());

  // Data Export Section
  const exportSeparator = document.createElement("hr");
  exportSeparator.style.margin = "20px 0";
  container.appendChild(exportSeparator);

  const exportTitle = document.createElement("h3");
  exportTitle.textContent = "Data Export";
  exportTitle.style.marginBottom = "15px";
  exportTitle.style.color = "var(--fg-muted)";
  container.appendChild(exportTitle);

  // "Export Data…" button — opens the full export modal with options
  const exportModalBtn = document.createElement("button");
  exportModalBtn.className = "goal-btn";
  exportModalBtn.textContent = "Export Data…";
  exportModalBtn.onclick = () => {
    createExportModal();
  };
  container.appendChild(exportModalBtn);

  // Quick-export as JSON (all data, no date filter)
  const quickJsonBtn = document.createElement("button");
  quickJsonBtn.className = "goal-btn";
  quickJsonBtn.textContent = "Quick Export All (JSON)";
  quickJsonBtn.onclick = async () => {
    quickJsonBtn.disabled = true;
    quickJsonBtn.textContent = "Exporting…";
    try {
      const exporter = new SessionExporter();
      await exporter.exportData({
        format: "json",
        includeFields: {
          sessions: true,
          dailySummary: true,
          tags: true,
          goals: true,
        },
      });
    } finally {
      quickJsonBtn.disabled = false;
      quickJsonBtn.textContent = "Quick Export All (JSON)";
    }
  };
  container.appendChild(quickJsonBtn);

  // Quick-export as CSV (all data, no date filter)
  const quickCsvBtn = document.createElement("button");
  quickCsvBtn.className = "goal-btn";
  quickCsvBtn.textContent = "Quick Export All (CSV)";
  quickCsvBtn.onclick = async () => {
    quickCsvBtn.disabled = true;
    quickCsvBtn.textContent = "Exporting…";
    try {
      const exporter = new SessionExporter();
      await exporter.exportData({
        format: "csv",
        includeFields: {
          sessions: true,
          dailySummary: true,
          tags: true,
          goals: true,
        },
      });
    } finally {
      quickCsvBtn.disabled = false;
      quickCsvBtn.textContent = "Quick Export All (CSV)";
    }
  };
  container.appendChild(quickCsvBtn);

  return container;
}
