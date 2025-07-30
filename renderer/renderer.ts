/* eslint-disable @typescript-eslint/no-explicit-any */
import { ipcRenderer } from "electron";
import { renderLogs } from "./logsTab";
import { refreshProfile } from "./profileTab";
import { renderSummary } from "./summaryTab";
import { renderDashboard } from "./dashboardTab";
import { renderCalendar } from "./calendarTab";
import { initTheme, updateRecordBtn, updatePauseBtn } from "./theme";
import {
  displayOSInfo,
  showModal,
  showNotification,
  showInAppNotification,
  showConfirmationModal,
} from "./components";
import { renderUserLanding } from "./userLanding";
import { getCurrentUserId } from "./utils";
import { loadUserLangMap } from "../src/utils/extractData";
import { showOnboarding, shouldShowOnboarding } from "./onboarding";
import "./styles/base.css";
import "./styles/accent-text.css";
import "./styles/calendar.css";
import "./styles/charts.css";
import "./styles/dashboard.css";
import "./styles/goals.css";
import "./styles/layout.css";
import "./styles/modal.css";
import "./styles/onboarding.css";
import "./styles/profile.css";
import "./styles/table.css";
import "./styles/theme.css";
import "./styles/timeline.css";
import "./styles/users.css";
import { updateAccentTextColors } from "./utils/colorUtils";

function setupTabs() {
  const tabs = Array.from(
    document.querySelectorAll(".tab")
  ) as HTMLButtonElement[];
  const tabContents = Array.from(
    document.querySelectorAll(".tab-content")
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
    });
  });
}

function initUI() {
  const localToday = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD format
  initTheme();

  ipcRenderer.on("os-info", (_event, data) => {
    if (data && data.os) displayOSInfo(data.os);
  });

  ipcRenderer.on("window-tracked", () => {
    // Only refresh logs if Today tab is active
    const todayTab = document.querySelector(
      '.tab[data-tab="today"]'
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
    document.querySelectorAll(".tab")
  ) as HTMLButtonElement[];
  const tabContents = Array.from(
    document.querySelectorAll(".tab-content")
  ) as HTMLDivElement[];
  tabs.forEach((t) => t.classList.remove("active"));
  tabContents.forEach((tc) => {
    tc.classList.remove("active");
    tc.style.display = "none";
  });

  const dashboardTab = document.querySelector(
    '.tab[data-tab="dashboard"]'
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
    "recordBtn"
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
        "recordBtn"
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
    // Ctrl+4: Profile tab
    if (e.ctrlKey && e.key === "5") {
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

ipcRenderer.on("get-session-info", () => {
  // Add a small delay to ensure any previous modals are fully closed
  setTimeout(() => {
    showModal({
      title: "Session Info",
      fields: [
        { name: "title", label: "Title:", type: "text", required: true },
        {
          name: "description",
          label: "Description (optional):",
          type: "textarea",
        },
      ],
      submitText: "Save",
      cancelText: "Discard",
      onSubmit: (values) => {
        ipcRenderer.send("session-info-reply", {
          title: values.title || "Coding Session",
          description: values.description,
        });
      },
      onCancel: () => {
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
      },
    });
  }, 100); // Reduced delay since cleanup is simpler now
});

ipcRenderer.on("notify", (_event, data) => {
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

ipcRenderer.on("scheduled-session-notification", (_event, data) => {
  if (data && data.message) {
    showNotification(`${data.title} - ${data.message}`);

    // For "time to start" notifications, offer to switch to calendar
    if (data.type === "time_to_start") {
      setTimeout(() => {
        showConfirmationModal({
          title: "Start Session",
          message: "Would you like to open the calendar to start the session?",
          confirmText: "Open Calendar",
          onConfirm: () => {
            const calendarTab = document.querySelector(
              '.tab[data-tab="calendar"]'
            ) as HTMLButtonElement;
            if (calendarTab) {
              calendarTab.click();
            }
          },
        });
      }, 2000);
    }
  }
});

export async function applyAccentColor() {
  const theme = document.body.classList.contains("light") ? "light" : "dark";
  const accentColor = await ipcRenderer.invoke(
    "get-accent-color",
    theme,
    getCurrentUserId()
  );

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
  const userId = getCurrentUserId();
  const savedTheme = (await ipcRenderer.invoke("get-user-theme", userId)) as
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

document.addEventListener("DOMContentLoaded", () => {
  localStorage.removeItem("currentUserId");
  const landing = document.getElementById("userLanding");
  const mainUI = document.getElementById("mainUI");
  const storedUserId = localStorage.getItem("currentUserId");

  // Initialize automatic text color updates for accent backgrounds

  function showMainUIForUser(userId: number) {
    localStorage.setItem("currentUserId", String(userId));
    if (mainUI) {
      mainUI.style.display = "";
      renderMainUI();
      setupRecordAndPauseBtns();
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).showMainUIForUser = showMainUIForUser;
  }

  if (storedUserId) {
    // Stored user ID found, show main UI
    showMainUIForUser(Number(storedUserId));
  } else if (landing) {
    // No stored user ID, rendering user landing
    renderUserLanding(landing, (userId) => {
      showMainUIForUser(userId);
    });
  }
});

function renderMainUI() {
  initUI();
  applyAccentColor();
  setupHotkeys();
}

let dailyGoalCheckInterval: NodeJS.Timeout | null = null;

async function checkDailyGoalProgress() {
  const userId = getCurrentUserId();
  const today = new Date().toLocaleDateString("en-CA");
  const dailyGoal = await ipcRenderer.invoke("get-daily-goal", userId, today);
  if (!dailyGoal) return;

  const totalMins = await ipcRenderer.invoke(
    "get-total-time-for-day",
    userId,
    today
  );

  if (!dailyGoal.isCompleted && totalMins >= dailyGoal.time) {
    await ipcRenderer.invoke("complete-daily-goal", userId, today);
    showNotification("🎉 Daily goal achieved!");
    // Optionally, re-render dashboard/logs
    renderDashboard();
    renderLogs(today);
  }
}

function startDailyGoalChecker() {
  if (dailyGoalCheckInterval) clearInterval(dailyGoalCheckInterval);
  checkDailyGoalProgress();
  dailyGoalCheckInterval = setInterval(checkDailyGoalProgress, 60 * 1000);
}

document.addEventListener("DOMContentLoaded", () => {
  // ...existing code...
  startDailyGoalChecker();
});
