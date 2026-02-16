/* eslint-disable @typescript-eslint/no-explicit-any */
import { ipcRenderer } from "electron";
import { renderLogs } from "./logsTab";
import { refreshProfile } from "./profileTab";
import { renderSummary } from "./summaryTab";
import { renderDashboard } from "./dashboardTab";
import { renderCalendar } from "./calendarTab";
import { renderProjects } from "./projectsTab";
import { renderOrganizationTab } from "./organizationTab";
import { initTheme, updateRecordBtn, updatePauseBtn } from "./theme";
import {
  displayOSInfo,
  showNotification,
  showInAppNotification,
  showConfirmationModal,
} from "./components";
import { renderLandingPage } from "./components";
// import { renderUserLanding } from "./components";
import { getCurrentUserId } from "./utils";
import { isCurrentUserManagerOrAdmin } from "./utils";
import {
  checkAuthStatus,
  onAuthStateChange,
  getCurrentUser,
} from "../src/supabase/api";
import { initializeOAuthListener } from "./utils/oauthHandler";
import { loadUserLangMap } from "../src/utils/extractData";
import { showOnboarding, shouldShowOnboarding } from "./components";
import "./styles/base.css";
import "./styles/accent-text.css";
import "./styles/calendar.css";
import "./styles/charts.css";
import "./styles/custom-dropdown.css";
import "./styles/dashboard.css";
import "./styles/details-modal.css";
import "./styles/goals.css";
import "./styles/layout.css";
import "./styles/modal.css";
import "./styles/onboarding.css";
import "./styles/profile.css";
import "./styles/projects.css";
import "./styles/table.css";
import "./styles/theme.css";
import "./styles/timeline.css";
import "./styles/users.css";
import "./styles/userRoleManager.css";
import "./styles/auth.css";
import "./styles/organization.css";
import { updateAccentTextColors } from "./utils/colorUtils";

function setupTabs() {
  const tabs = Array.from(
    document.querySelectorAll(".tab"),
  ) as HTMLButtonElement[];
  const tabContents = Array.from(
    document.querySelectorAll(".tab-content"),
  ) as HTMLDivElement[];

  // Remove old listeners by replacing each tab with a clone
  tabs.forEach((tab, i) => {
    const newTab = tab.cloneNode(true) as HTMLButtonElement;
    tab.parentNode?.replaceChild(newTab, tab);
    tabs[i] = newTab;
  });

  tabs.forEach((tab) => {
    tab.addEventListener("click", async () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tabContents.forEach((tc) => {
        tc.classList.remove("active");
        tc.style.display = "none";
      });

      tab.classList.add("active");
      const tabId = tab.getAttribute("data-tab");
      const content = document.getElementById(`tab-${tabId}`);
      if (content) {
        content.classList.add("active");
        content.style.display = "";
      }

      // Force re-render on tab switch to ensure fresh content
      if (tabId === "dashboard") renderDashboard();
      if (tabId === "today") renderLogs();
      if (tabId === "profile") refreshProfile();
      if (tabId === "summary") {
        // Force reset summary state to ensure fresh data
        (window as any).__resetSummaryTabState = true;
        renderSummary();
      }
      if (tabId === "calendar") renderCalendar();
      if (tabId === "projects") renderProjects();
      if (tabId === "organization") renderOrganizationTab();
    });
  });
}

async function setupRoleBasedTabVisibility() {
  const isManagerOrAdmin = await isCurrentUserManagerOrAdmin();
  const projectsTab = document.querySelector(
    '.tab[data-tab="projects"]',
  ) as HTMLButtonElement;

  if (projectsTab) {
    if (isManagerOrAdmin) {
      projectsTab.style.display = "";
    } else {
      projectsTab.style.display = "none";
    }
  }
}

function initUI() {
  const localToday = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD format
  initTheme();

  ipcRenderer.on("os-info", (_event: any, data: { os?: string }) => {
    if (data && data.os) displayOSInfo(data.os);
  });

  ipcRenderer.on("window-tracked", () => {
    // Only refresh logs if Today tab is active
    const todayTab = document.querySelector(
      '.tab[data-tab="today"]',
    ) as HTMLButtonElement;
    const todayContent = document.getElementById("tab-today");
    if (
      todayTab?.classList.contains("active") &&
      todayContent?.classList.contains("active")
    ) {
      renderLogs(localToday);
    }
  });

  setupTabs();

  // --- Make Dashboard tab active by default ---
  const tabs = Array.from(
    document.querySelectorAll(".tab"),
  ) as HTMLButtonElement[];
  const tabContents = Array.from(
    document.querySelectorAll(".tab-content"),
  ) as HTMLDivElement[];
  tabs.forEach((t) => t.classList.remove("active"));
  tabContents.forEach((tc) => {
    tc.classList.remove("active");
    tc.style.display = "none";
  });

  const dashboardTab = document.querySelector(
    '.tab[data-tab="dashboard"]',
  ) as HTMLButtonElement;
  const dashboardContent = document.getElementById("tab-dashboard");
  if (dashboardTab && dashboardContent) {
    dashboardTab.classList.add("active");
    dashboardContent.classList.add("active");
    dashboardContent.style.display = "";
    renderDashboard();
  }
}

(window as any).isRecording = false;
(window as any).isPaused = false;

function setupRecordAndPauseBtns() {
  // Remove old listeners by replacing buttons with clones
  const recordBtnOld = document.getElementById(
    "recordBtn",
  ) as HTMLButtonElement;
  const pauseBtnOld = document.getElementById("pauseBtn") as HTMLButtonElement;

  if (!recordBtnOld || !pauseBtnOld) return;

  const recordBtn = recordBtnOld.cloneNode(true) as HTMLButtonElement;
  const pauseBtn = pauseBtnOld.cloneNode(true) as HTMLButtonElement;

  recordBtnOld.parentNode?.replaceChild(recordBtn, recordBtnOld);
  pauseBtnOld.parentNode?.replaceChild(pauseBtn, pauseBtnOld);

  const recordIcon = document.getElementById("recordIcon") as HTMLImageElement;
  const pauseIcon = document.getElementById("pauseIcon") as HTMLImageElement;

  if (!recordBtn || !recordIcon || !pauseBtn || !pauseIcon) return;

  recordBtn.addEventListener("click", async () => {
    if (!(window as any).isRecording) {
      (window as any).isRecording = true;
      (window as any).isPaused = false;
      pauseBtn.style.display = "";
      updatePauseBtn(pauseBtn, pauseIcon, (window as any).isPaused);
      await ipcRenderer.invoke("start-tracking", getCurrentUserId());
    } else {
      (window as any).isRecording = false;
      (window as any).isPaused = false;
      pauseBtn.style.display = "none";
      await ipcRenderer.invoke("stop-tracking", getCurrentUserId());
    }
    updateRecordBtn(recordBtn, recordIcon, (window as any).isRecording);
  });

  pauseBtn.addEventListener("click", async () => {
    if (!(window as any).isPaused) {
      (window as any).isPaused = true;
      await ipcRenderer.invoke("pause-tracking");
    } else {
      (window as any).isPaused = false;
      await ipcRenderer.invoke("resume-tracking", getCurrentUserId());
    }
    updatePauseBtn(pauseBtn, pauseIcon, (window as any).isPaused);
  });

  updateRecordBtn(recordBtn, recordIcon, (window as any).isRecording);
  updatePauseBtn(pauseBtn, pauseIcon, (window as any).isPaused);
  pauseBtn.style.display = "none";
}

// Expose the function globally so it can be called from other modules
(window as any).setupRecordAndPauseBtns = setupRecordAndPauseBtns;

let hotkeyListenerAdded = false;

function setupHotkeys() {
  // Prevent duplicate listeners
  if (hotkeyListenerAdded) return;

  const hotkeyHandler = (e: KeyboardEvent): void => {
    // Ignore if typing in an input or textarea
    if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName))
      return;

    // Ctrl+R: Start/Stop recording
    if (e.ctrlKey && e.key.toLowerCase() === "r") {
      e.preventDefault();
      e.stopPropagation();
      const recordBtn = document.getElementById(
        "recordBtn",
      ) as HTMLButtonElement;
      if (recordBtn) recordBtn.click();
      return;
    }

    // Ctrl+1: Dashboard tab
    if (e.ctrlKey && e.key === "1") {
      e.preventDefault();
      document
        .querySelector('.tab[data-tab="dashboard"]')
        ?.dispatchEvent(new Event("click"));
    }
    // Ctrl+2: Today tab
    if (e.ctrlKey && e.key === "2") {
      e.preventDefault();
      document
        .querySelector('.tab[data-tab="today"]')
        ?.dispatchEvent(new Event("click"));
    }
    // Ctrl+3: Summary tab
    if (e.ctrlKey && e.key === "3") {
      e.preventDefault();
      document
        .querySelector('.tab[data-tab="summary"]')
        ?.dispatchEvent(new Event("click"));
    }
    // Ctrl+4: Calendar tab
    if (e.ctrlKey && e.key === "4") {
      e.preventDefault();
      document
        .querySelector('.tab[data-tab="calendar"]')
        ?.dispatchEvent(new Event("click"));
    }
    // Ctrl+5: Projects tab (only if user has access)
    if (e.ctrlKey && e.key === "5") {
      e.preventDefault();
      const projectsTab = document.querySelector(
        '.tab[data-tab="projects"]',
      ) as HTMLButtonElement;
      // Only trigger if the tab is visible (user has access)
      if (projectsTab && projectsTab.style.display !== "none") {
        projectsTab.dispatchEvent(new Event("click"));
      }
    }
    // Ctrl+6: Profile tab
    if (e.ctrlKey && e.key === "6") {
      e.preventDefault();
      document
        .querySelector('.tab[data-tab="profile"]')
        ?.dispatchEvent(new Event("click"));
    }
    // Ctrl+P: Pause/Resume
    if (e.ctrlKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      const pauseBtn = document.getElementById("pauseBtn") as HTMLButtonElement;
      if (pauseBtn && pauseBtn.style.display !== "none") pauseBtn.click();
    }
  };

  document.addEventListener("keydown", hotkeyHandler);
  hotkeyListenerAdded = true;
}

ipcRenderer.on("get-session-info", async () => {
  // Add a small delay to ensure any previous modals are fully closed
  setTimeout(async () => {
    // Load available projects for selection
    let projects = [];
    try {
      const userId = await ipcRenderer.invoke("get-current-user-id");
      projects = await ipcRenderer.invoke("get-user-projects", userId);
    } catch (error) {
      // Failed to load projects, continue without them
    }

    // Add project selection if there are active projects
    const activeProjects = projects.filter((p: any) => p.is_active); // Clean up any existing modals first
    const existingModal = document.getElementById("customModal");
    const existingOverlay = document.getElementById("customModalOverlay");
    if (existingModal) existingModal.remove();
    if (existingOverlay) existingOverlay.remove();

    // Create the modal overlay
    const overlay = document.createElement("div");
    overlay.id = "customModalOverlay";
    overlay.className = "custom-modal-overlay";
    overlay.style.display = "block";
    document.body.appendChild(overlay);

    // Create the modal
    const modal = document.createElement("div");
    modal.id = "customModal";
    modal.className = "active";

    modal.innerHTML = `
      <div class="session-modal-content">
        <button class="modal-close-btn">&times;</button>
        <h2>Session Info</h2>
        <form id="sessionInfoForm">
          <label for="session-title">Title:</label><br>
          <input id="session-title" name="title" type="text" required><br>
          
          <label for="session-description">Description (optional):</label><br>
          <textarea id="session-description" name="description"></textarea><br>
          
          ${
            activeProjects.length > 0
              ? `
          <label for="session-project">Project (optional):</label><br>
          <div id="session-project-container"></div><br>
          
          <label>
            <input type="checkbox" id="session-billable" name="billable"> Billable
          </label><br>
          `
              : ""
          }
          
          <div class="session-modal-actions">
            <button type="button" id="sessionCancelBtn" class="btn-cancel">Discard</button>
            <button type="submit" class="btn-confirm">Save</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    // Create custom dropdown for project selection
    let projectDropdown: any = null;
    if (activeProjects.length > 0) {
      const projectContainer = document.getElementById(
        "session-project-container",
      );
      if (projectContainer) {
        const { createCustomDropdown } =
          await import("./components/CustomDropdown");
        projectDropdown = createCustomDropdown({
          id: "session-project",
          name: "project",
          placeholder: "No project",
          options: [
            { value: "", label: "No project" },
            ...activeProjects.map((p: any) => ({
              value: p.id.toString(),
              label: p.name,
            })),
          ],
        });
        projectContainer.appendChild(projectDropdown.getElement());
      }
    }

    const form = document.getElementById("sessionInfoForm") as HTMLFormElement;
    const titleInput = document.getElementById(
      "session-title",
    ) as HTMLInputElement;
    const cancelBtn = document.getElementById(
      "sessionCancelBtn",
    ) as HTMLButtonElement;
    const closeBtn = modal.querySelector(
      ".modal-close-btn",
    ) as HTMLButtonElement;

    // Focus the title input
    setTimeout(() => titleInput.focus(), 50);

    // Handle form submission
    form.onsubmit = (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const projectId = projectDropdown ? projectDropdown.getValue() : "";
      const isBillable = (formData.get("billable") as string) === "on";

      ipcRenderer.send("session-info-reply", {
        title: (formData.get("title") as string) || "Coding Session",
        description: formData.get("description") as string,
        projectId: projectId ? parseInt(projectId) : undefined,
        isBillable: isBillable,
      });

      modal.remove();
      overlay.remove();
    };

    // Handle cancel and close
    const closeModal = () => {
      modal.remove();
      overlay.remove();
      showConfirmationModal({
        title: "Discard Session",
        message: "Session will be discarded. Are you sure?",
        confirmText: "Discard",
        confirmClass: "btn-delete",
        onConfirm: () => {
          ipcRenderer.send("session-info-reply", {
            title: "",
            description: "",
          });
        },
      });
    };

    cancelBtn.onclick = closeModal;
    closeBtn.onclick = closeModal;

    // Handle overlay click to close
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        closeModal();
      }
    };

    // Prevent modal content clicks from closing modal
    modal
      .querySelector(".session-modal-content")
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
      });
  }, 100);
});

ipcRenderer.on("notify", (_event: any, data: { message?: string }) => {
  if (data && data.message) showInAppNotification(data.message);
});

ipcRenderer.on("auto-paused", () => {
  (window as any).isPaused = true;
  const pauseBtn = document.getElementById("pauseBtn") as HTMLButtonElement;
  const pauseIcon = document.getElementById("pauseIcon") as HTMLImageElement;
  if (pauseBtn && pauseIcon) {
    updatePauseBtn(pauseBtn, pauseIcon, (window as any).isPaused);
  }
});

ipcRenderer.on("auto-resumed", () => {
  (window as any).isPaused = false;
  const pauseBtn = document.getElementById("pauseBtn") as HTMLButtonElement;
  const pauseIcon = document.getElementById("pauseIcon") as HTMLImageElement;
  if (pauseBtn && pauseIcon) {
    updatePauseBtn(pauseBtn, pauseIcon, (window as any).isPaused);
  }
});

ipcRenderer.on(
  "scheduled-session-notification",
  (
    _event: any,
    data: {
      title?: string;
      message?: string;
      sessionId?: number;
      type?: string;
    },
  ) => {
    if (data && data.message) {
      showNotification(`${data.title} - ${data.message}`);

      // For "time to start" notifications, offer to switch to calendar
      if (data.type === "time_to_start") {
        setTimeout(() => {
          showConfirmationModal({
            title: "Start Session",
            message:
              "Would you like to open the calendar to start the session?",
            confirmText: "Open Calendar",
            onConfirm: () => {
              const calendarTab = document.querySelector(
                '.tab[data-tab="calendar"]',
              ) as HTMLButtonElement;
              if (calendarTab) {
                calendarTab.click();
              }
            },
          });
        }, 2000);
      }
    }
  },
);

export async function applyAccentColor() {
  const theme = document.body.classList.contains("light") ? "light" : "dark";
  const accentColor = await ipcRenderer.invoke("get-accent-color", theme);

  if (theme === "light") {
    document.body.style.setProperty("--accent", accentColor);
    document.documentElement.style.removeProperty("--accent");
  } else {
    document.documentElement.style.setProperty("--accent", accentColor);
    document.body.style.removeProperty("--accent");
  }

  // Update text colors based on the new accent color
  await updateAccentTextColors();
}

async function applyUserTheme() {
  const savedTheme = (await ipcRenderer.invoke("get-user-theme")) as
    | "light"
    | "dark";
  if (savedTheme === "light") {
    document.body.classList.add("light");
  } else {
    document.body.classList.remove("light");
  }
  // Optionally update theme icon if you use one
  // updateThemeIcon(document.getElementById('themeIcon') as HTMLImageElement);
  await applyAccentColor();
  window.dispatchEvent(new Event("theme-changed"));
}

document.addEventListener("DOMContentLoaded", async () => {
  const landing = document.getElementById("userLanding") as HTMLDivElement;
  const mainUI = document.getElementById("mainUI");

  // Initialize OAuth listener globally to handle password resets and email confirmations
  initializeOAuthListener((session: any) => {
    // This callback will be triggered when auth events (password reset, email confirmation, etc.) occur
    if (session?.user?.id) {
      showMainUIForUser(session.user.id);
      if (landing) landing.style.display = "none";
      if (mainUI) mainUI.style.display = "";
    }
  });

  // Initialize automatic text color updates for accent backgrounds

  // Flag to prevent double initialization
  let isMainUIInitialized = false;

  function showMainUIForUser(userId: string | number) {
    // Prevent duplicate initialization
    if (isMainUIInitialized) {
      return;
    }
    isMainUIInitialized = true;

    localStorage.setItem("currentUserId", String(userId));
    if (mainUI) {
      mainUI.style.display = "";
      renderMainUI();
      setupRecordAndPauseBtns();
      setupRoleBasedTabVisibility();
    }
    if (landing) landing.style.display = "none";

    loadUserLangMap();
    applyUserTheme();

    // Show onboarding for new users
    if (shouldShowOnboarding()) {
      setTimeout(() => showOnboarding(), 500);
    }

    // Check for scheduled session notifications 5 seconds after user logs in
    setTimeout(() => {
      ipcRenderer.invoke("check-notifications");
    }, 5000);

    // Start daily goal checker after user is authenticated
    startDailyGoalChecker();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).showMainUIForUser = showMainUIForUser;
  }

  // Check if user is authenticated with Supabase
  try {
    const isAuthenticated = await checkAuthStatus();

    if (isAuthenticated) {
      // User is authenticated, show main UI
      if (landing) landing.style.display = "none";
      if (mainUI) mainUI.style.display = "";

      // Get the current user and initialize main UI
      const user = await getCurrentUser();
      if (user) {
        showMainUIForUser(user.id);
      } else {
        throw new Error("No authenticated user found");
      }
    } else {
      // No authenticated user, show auth landing
      if (landing) {
        if (mainUI) mainUI.style.display = "none";
        landing.style.display = "";
        renderLandingPage(landing, (session: any) => {
          showMainUIForUser(session.user.id);
          if (landing) landing.style.display = "none";
        });
      }
    }
  } catch (error) {
    // If there's an error checking auth, fall back to stored user ID
    const storedUserId = localStorage.getItem("currentUserId");

    if (storedUserId) {
      // If we have a stored user, go straight to main UI
      if (landing) landing.style.display = "none";
      if (mainUI) mainUI.style.display = "";
      showMainUIForUser(storedUserId);
    } else {
      // No stored user, show auth landing
      if (landing) {
        if (mainUI) mainUI.style.display = "none";
        landing.style.display = "";
        renderLandingPage(landing, (session: any) => {
          showMainUIForUser(session.user.id);
          landing.style.display = "none";
        });
      }
    }
  }

  // Listen for auth state changes
  onAuthStateChange((session: any) => {
    if (session) {
      // User signed in
      showMainUIForUser(session.user.id);
      if (landing) landing.style.display = "none";
    } else {
      // User signed out - reset the initialization flag
      isMainUIInitialized = false;
      localStorage.removeItem("currentUserId");
      if (mainUI) mainUI.style.display = "none";
      if (landing) {
        landing.style.display = "";
        renderLandingPage(landing, (newSession: any) => {
          showMainUIForUser(newSession.user.id);
          landing.style.display = "none";
        });
      }
    }
  });
});

function renderMainUI() {
  initUI();
  applyAccentColor();
  setupHotkeys();
}

let dailyGoalCheckInterval: NodeJS.Timeout | null = null;

async function checkDailyGoalProgress() {
  try {
    const userId = getCurrentUserId();
    const today = new Date().toLocaleDateString("en-CA");
    const dailyGoal = await ipcRenderer.invoke("get-daily-goal", userId, today);
    if (!dailyGoal) return;

    const totalMins = await ipcRenderer.invoke(
      "get-total-time-for-day",
      userId,
      today,
    );

    if (!dailyGoal.isCompleted && totalMins >= dailyGoal.time) {
      await ipcRenderer.invoke("complete-daily-goal", userId, today);
      showNotification("🎉 Daily goal achieved!");
      // Optionally, re-render dashboard/logs
      renderDashboard();
      renderLogs(today);
    }
  } catch (error) {
    // No user logged in yet, skip daily goal check
    return;
  }
}

function startDailyGoalChecker() {
  if (dailyGoalCheckInterval) clearInterval(dailyGoalCheckInterval);
  checkDailyGoalProgress();
  dailyGoalCheckInterval = setInterval(checkDailyGoalProgress, 60 * 1000);
}
