import {
  showInAppNotification,
  showNotification,
  showConfirmationModal,
} from "./components";
import { clearAllOnboardingData } from "./onboarding";
import { renderUserRoleManager } from "./components/UserRoleManager";
import { isCurrentUserAdmin } from "./utils/userUtils";

export function createExportDbButton(
  type: "db" | "json" | "csv"
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "goal-btn";
  if (type === "db") {
    btn.textContent = "Export Database (.db)";
  } else if (type === "json") {
    btn.textContent = "Export as JSON";
  } else if (type === "csv") {
    btn.textContent = "Export as CSV";
  }

  btn.onclick = async () => {
    const { ipcRenderer } = window.require("electron");
    let channel = "";
    if (type === "db") channel = "export-database";
    else if (type === "json") channel = "export-database-json";
    else if (type === "csv") channel = "export-database-csv";

    const result = await ipcRenderer.invoke(channel);
    if (result && result.status === "success") {
      showNotification(
        type === "db"
          ? "Database exported successfully!"
          : type === "json"
          ? "Exported as JSON successfully!"
          : "Exported as CSV successfully!"
      );
    } else if (result && result.status === "cancelled") {
      showInAppNotification("Export cancelled.");
    } else {
      showInAppNotification(
        "Export failed." +
          (result && result.message ? ` (${result.message})` : "")
      );
    }
  };
  return btn;
}

export function createImportDbButton(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "goal-btn";
  btn.textContent = "Import Database";

  btn.onclick = async () => {
    const { ipcRenderer } = window.require("electron");
    // Use dialog from main process via IPC
    const result = await ipcRenderer.invoke("show-import-dialog");
    if (!result || !result.filePath) {
      showInAppNotification("Import cancelled.");
      return;
    }
    const filePath = result.filePath;
    const ext = filePath.split(".").pop()?.toLowerCase();
    let channel = "";
    if (ext === "db") channel = "import-database";
    else if (ext === "json") channel = "import-database-json";
    else if (ext === "zip") channel = "import-database-csv";
    else {
      showInAppNotification("Unsupported file type for import.");
      return;
    }
    const importResult = await ipcRenderer.invoke(channel, filePath);
    if (importResult && importResult.status === "success") {
      showNotification("Database imported successfully!");
    } else if (importResult && importResult.status === "cancelled") {
      showInAppNotification("Import cancelled.");
    } else {
      showInAppNotification(
        "Import failed." +
          (importResult && importResult.message
            ? ` (${importResult.message})`
            : "")
      );
    }
  };
  return btn;
}

export function createRollbackDbButton(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "goal-btn";
  btn.textContent = "Rollback to Latest Backup";
  btn.onclick = async () => {
    const { ipcRenderer } = window.require("electron");
    showConfirmationModal({
      title: "Rollback Database",
      message:
        "Are you sure you want to rollback to the latest backup? This will overwrite your current database.",
      confirmText: "Rollback",
      confirmClass: "btn-delete",
      onConfirm: async () => {
        const result = await ipcRenderer.invoke("rollback-database");
        if (result && result.status === "success") {
          showNotification("Database rolled back to latest backup!");
        } else {
          showInAppNotification(
            "Rollback failed." +
              (result && result.message ? ` (${result.message})` : "")
          );
        }
      },
    });
  };
  return btn;
}

export function createBackupDbButton(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "goal-btn";
  btn.textContent = "Create Backup";
  btn.onclick = async () => {
    const { ipcRenderer } = window.require("electron");
    const result = await ipcRenderer.invoke("backup-database");
    if (result && result.status === "success") {
      showNotification("Backup created successfully!");
    } else {
      showInAppNotification(
        "Backup failed." +
          (result && result.message ? ` (${result.message})` : "")
      );
    }
  };
  return btn;
}

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
            "All onboarding data cleared successfully! Users will see the onboarding tour on their next login."
          );
        } catch (error) {
          showInAppNotification(
            "Failed to clear onboarding data: " +
              (error instanceof Error ? error.message : "Unknown error")
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

  // Database operations
  const dbSeparator = document.createElement("hr");
  dbSeparator.style.margin = "30px 0";
  container.appendChild(dbSeparator);

  const dbTitle = document.createElement("h3");
  dbTitle.textContent = "Database Operations";
  dbTitle.style.marginBottom = "15px";
  dbTitle.style.color = "var(--fg-muted)";
  container.appendChild(dbTitle);

  container.appendChild(createExportDbButton("db"));
  container.appendChild(createExportDbButton("json"));
  container.appendChild(createExportDbButton("csv"));
  container.appendChild(document.createElement("hr"));
  container.appendChild(createImportDbButton());
  container.appendChild(createBackupDbButton());
  container.appendChild(createRollbackDbButton());

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

  return container;
}
