/* eslint-disable @typescript-eslint/no-explicit-any */
import { ipcRenderer } from "./ipc";
import { initSentryRenderer, setSentryUser, clearSentryUser, addBreadcrumb } from "../src/sentryRenderer";
import { renderLogs } from "./logsTab";
import { renderSettingsView } from "./settingsTab";
import { renderInsights } from "./insightsTab";
import { renderSummary } from "./summaryTab";
import { renderDashboard } from "./dashboardTab";
import { renderCalendar } from "./calendarTab";
import { renderProjects } from "./projectsTab";
import { renderBilling } from "./billingTab";
import { renderOrganizationTab } from "./organizationTab";
import { renderTeamAnalytics } from "./teamAnalyticsTab";
import { initTheme, updateRecordBtn, updatePauseBtn } from "./theme";
import {
  displayOSInfo,
  showNotification,
  showInAppNotification,
  showConfirmationModal,
} from "./components";
import { renderLandingPage } from "./components";
import { safeIpcInvoke } from "./utils";
import { isCurrentUserManagerOrAdmin, clearRoleCache } from "./utils";
import { loadTeamSignals, shouldShowTeam } from "./utils/teamVisibility";
import {
  initNavigation,
  markTabsDirty,
  navigateTo,
  navigateToIndex,
  refreshPages,
  registerPage,
  resetNavigation,
  setNavItemVisible,
  setSubViewVisible,
} from "./navigation";
import { getDailyGoalCached, invalidateDailyGoalCache } from "./utils";
import { invalidateLogsCache } from "./utils";
import {
  getCachedAccentColor,
  updateCachedPreference,
  forceRefreshPreferences,
  invalidatePreferencesCache,
} from "./utils";
import { getCachedPreferences } from "./utils/preferencesCache";
import {
  getAuthUser,
  importLegacySession,
  onAuthState,
  signOut,
  type AuthSession,
} from "./auth";
import { initializeOAuthListener } from "./utils/oauthHandler";
import {
  showOnboarding,
  shouldShowOnboarding,
  shouldShowOrgSetupWizard,
  showOrgSetupWizard,
} from "./components";
import {
  initConnectionStatus,
  destroyConnectionStatus,
} from "./components/ConnectionStatus";
import { initSyncStatus, destroySyncStatus } from "./components/SyncStatus";
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
import "./styles/auth.css";
import "./styles/organization.css";
import "./styles/connection-status.css";
import "./styles/sync-status.css";
import "./styles/org-wizard.css";
import "./styles/standup.css";
import "./styles/incognito.css";
import "./styles/team-analytics.css";
import "./styles/notification-sidebar.css";
import {
  initNotificationSidebar,
  addSidebarNotification,
} from "./components/NotificationSidebar";
import { updateAccentTextColors } from "./utils/colorUtils";
import {
  getTrackingState,
  onTrackingState,
  refreshTrackingState,
  stopTracking,
  toggleRecording,
  togglePause,
  type TrackingState,
} from "./trackingControls";
import { formatClock, onClockTick } from "./liveClock";
import { restoreLastProject } from "./sessionProject";

// ── Pages ──────────────────────────────────────────────────────────
// Each page renders on its first visit and then only when marked dirty
// (see navigation.ts). Page ids are the old tab ids.

registerPage("dashboard", renderDashboard);
registerPage("today", () => renderLogs());
registerPage("summary", () => {
  (window as any).__resetSummaryTabState = true;
  return renderSummary();
});
registerPage("calendar", renderCalendar);
registerPage("insights", renderInsights);
registerPage("projects", renderProjects);
registerPage("billing", renderBilling);
registerPage("organization", renderOrganizationTab);
registerPage("teamAnalytics", renderTeamAnalytics);
registerPage("settings", renderSettingsView);

// Expose for other renderer modules (e.g. organizationTab mutations)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).markTabsDirty = markTabsDirty;

/**
 * Team shows only when there is a team (see utils/teamVisibility.ts);
 * its Analytics view only for admins and managers.
 */
let lastTeamCheck = 0;

async function updateTeamVisibility() {
  lastTeamCheck = Date.now();
  const [signals, isManagerOrAdmin] = await Promise.all([
    loadTeamSignals(),
    isCurrentUserManagerOrAdmin(),
  ]);
  setNavItemVisible("team", shouldShowTeam(signals));
  setSubViewVisible("team", "analytics", isManagerOrAdmin);
}

// Others join and leave from their own machines, which sends no event here:
// re-check when the window regains focus (at most every 30 s).
window.addEventListener("focus", () => {
  const signedIn = document.getElementById("mainUI")?.style.display !== "none";
  if (!signedIn || Date.now() - lastTeamCheck < 30_000) return;
  void updateTeamVisibility();
});

window.addEventListener("organization:changed", () => {
  clearRoleCache();
  void updateTeamVisibility();
  refreshPages("teamAnalytics", "projects", "billing", "settings");
});

// A session was saved: everything that lists or sums sessions is stale
ipcRenderer.on("session-saved", () => {
  refreshPages("dashboard", "summary", "projects", "billing", "teamAnalytics");
});

// New AI agent sessions were uploaded (about once a minute while an agent
// works): re-render Projects on its next visit rather than under the user
ipcRenderer.on("agent-sessions-synced", () => markTabsDirty("projects"));

function initUI() {
  initTheme();

  ipcRenderer.on("os-info", (_event: any, data: { os?: string }) => {
    if (data && data.os) displayOSInfo(data.os);
  });

  ipcRenderer.on("window-tracked", () => {
    // New usage data arrived: usage-based pages are stale. Refresh the App
    // activity table right away if it is open; the rest wait for a visit.
    invalidateLogsCache();
    markTabsDirty("dashboard", "summary", "insights");
    refreshPages("today");
  });

  initNavigation();
  navigateTo("home");
}

/** Rail timer: status text and the live active-time clock. */
onClockTick((seconds, state) => {
  const box = document.getElementById("navTimer");
  const status = document.getElementById("navTimerStatus");
  const clockEl = document.getElementById("navTimerClock");
  if (!box || !status || !clockEl) return;
  box.classList.toggle("recording", state.isRecording && !state.isPaused);
  box.classList.toggle("paused", state.isRecording && state.isPaused);
  status.textContent = !state.isRecording
    ? "Not recording"
    : state.isPaused
      ? state.autoPaused
        ? "Paused (idle)"
        : "Paused"
      : state.activity === "supervising"
        ? "Supervising agent"
        : "Recording";
  status.title =
    state.isRecording && !state.isPaused && state.activity === "supervising"
      ? "No input, but an AI agent is working — this counts as work"
      : "";
  clockEl.textContent = formatClock(seconds);
});

/** Render the record/pause buttons and the rail timer from main's state. */
function renderTrackingButtons(state: TrackingState) {
  const recordBtn = document.getElementById("recordBtn") as HTMLButtonElement;
  const recordIcon = document.getElementById("recordIcon") as HTMLImageElement;
  const pauseBtn = document.getElementById("pauseBtn") as HTMLButtonElement;
  const pauseIcon = document.getElementById("pauseIcon") as HTMLImageElement;
  if (recordBtn && recordIcon) {
    updateRecordBtn(recordBtn, recordIcon, state.isRecording);
  }
  if (pauseBtn && pauseIcon) {
    pauseBtn.style.display = state.isRecording ? "" : "none";
    updatePauseBtn(pauseBtn, pauseIcon, state.isPaused);
  }
}

onTrackingState(renderTrackingButtons);

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

  // The buttons only ask main for a change; renderTrackingButtons draws the
  // result when main broadcasts the new state.
  recordBtn.addEventListener("click", async () => {
    const wasRecording = getTrackingState().isRecording;
    try {
      addBreadcrumb(wasRecording ? "Session stopped" : "Session started");
      await toggleRecording();
    } catch (err) {
      addBreadcrumb("Tracking toggle failed", { error: String(err) }, "warning");
      showInAppNotification(
        "Failed to toggle tracking. Please try again.",
        3500,
        "error",
      );
    }
  });

  pauseBtn.addEventListener("click", async () => {
    try {
      addBreadcrumb(
        getTrackingState().isPaused ? "Session resumed" : "Session paused",
      );
      await togglePause();
    } catch (err) {
      showInAppNotification(
        "Failed to toggle pause. Please try again.",
        3500,
        "error",
      );
    }
  });

  renderTrackingButtons(getTrackingState());
}


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

    // Ctrl+1…9: sidebar items, top to bottom
    if (e.ctrlKey && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      navigateToIndex(Number(e.key));
      return;
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

ipcRenderer.on(
  "get-session-info",
  async (
    _event: any,
    request?: {
      projectId?: string | null;
      /** Repo worked in longest this session (detected by main) */
      repo?: { name: string; projectId: string | null } | null;
    },
  ) => {
  const preselectedProjectId = request?.projectId ?? "";
  const sessionRepo = request?.repo ?? null;
  // Add a small delay to ensure any previous modals are fully closed
  setTimeout(async () => {
    // Load available projects for selection
    let projects: any[] = [];
    try {
      projects = await safeIpcInvoke("get-projects-for-user", [], {
        fallback: [],
        showNotification: false,
      });
    } catch (error) {
      // Failed to load projects, continue without them
    }

    // Add project selection if there are active projects
    const activeProjects = projects.filter((p: any) => p.is_active);
    const preselected = activeProjects.find(
      (p: any) => String(p.id) === String(preselectedProjectId),
    );
    // A project with a rate is usually billed: preselect Billable
    const defaultBillable = preselected
      ? preselected.hourly_rate != null
        ? "true"
        : "false"
      : "";
    // Clean up any existing modals first
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
          <div id="session-project-container"></div>
          ${
            sessionRepo
              ? `<label class="session-remember-repo" id="session-remember-repo-row" hidden>
            <input type="checkbox" id="session-remember-repo">
            <span id="session-remember-repo-text"></span>
          </label>`
              : ""
          }<br>
          `
              : ""
          }

          <label for="session-billable-status">Billing:</label><br>
          <select id="session-billable-status" name="billableStatus" required>
            <option value="" disabled ${defaultBillable ? "" : "selected"}>Select billing status</option>
            <option value="false" ${defaultBillable === "false" ? "selected" : ""}>Non-billable</option>
            <option value="true" ${defaultBillable === "true" ? "selected" : ""}>Billable</option>
          </select><br>
          
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
    let onProjectChange = (_value: string) => {};
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
          value: preselected ? String(preselected.id) : "",
          onChange: (value: string) => onProjectChange(value),
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

    // Offer to link the session's repo to the chosen project, when that
    // would change something
    const rememberRow = document.getElementById("session-remember-repo-row");
    const rememberBox = document.getElementById(
      "session-remember-repo",
    ) as HTMLInputElement | null;
    const rememberText = document.getElementById("session-remember-repo-text");
    const updateRememberRepo = (projectId: string) => {
      if (!sessionRepo || !rememberRow || !rememberBox || !rememberText) return;
      const show = !!projectId && projectId !== sessionRepo.projectId;
      rememberRow.hidden = !show;
      if (!show) return;
      rememberText.textContent = sessionRepo.projectId
        ? `Link repo ${sessionRepo.name} to this project instead`
        : `Always use this project for repo ${sessionRepo.name}`;
      // Replacing an existing link is opt-in; a first link is the default
      rememberBox.checked = !sessionRepo.projectId;
    };
    if (projectDropdown) {
      updateRememberRepo(projectDropdown.getValue());
      onProjectChange = updateRememberRepo;
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
      const billableStatus = formData.get("billableStatus") as string | null;

      if (billableStatus !== "true" && billableStatus !== "false") {
        return;
      }

      const isBillable = billableStatus === "true";

      ipcRenderer.send("session-info-reply", {
        title: (formData.get("title") as string) || "Coding Session",
        description: formData.get("description") as string,
        projectId: projectId || undefined,
        isBillable: isBillable,
        rememberRepo:
          !!rememberBox && !rememberRow?.hidden && rememberBox.checked,
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
  },
);

// Main gave up waiting for the session-info modal (timeout, newer stop, or
// quit) and saved the session with a default title — close the stale modal.
ipcRenderer.on("session-info-timeout", () => {
  document.getElementById("customModal")?.remove();
  document.getElementById("customModalOverlay")?.remove();
  document.getElementById("confirmationModal")?.remove();
  showInAppNotification(
    'Session auto-saved as "Untitled Session" — you can rename it in Summary.',
    6000,
  );
});

ipcRenderer.on("notify", (_event: any, data: { message?: string }) => {
  if (data && data.message) showInAppNotification(data.message);
});

// ── Incognito Mode ───────────────────────────────────────────────────
(window as any).isIncognito = false;

function updateIncognitoUI(active: boolean) {
  (window as any).isIncognito = active;
  const banner = document.getElementById("incognitoBanner");
  const btn = document.getElementById("incognitoBtn");
  if (banner) banner.style.display = active ? "flex" : "none";
  if (btn) btn.classList.toggle("incognito-active", active);
}

ipcRenderer.on("incognito-toggled", (_event: any, active: boolean) => {
  updateIncognitoUI(active);
});

// Set up incognito button click
document.addEventListener("DOMContentLoaded", () => {
  const incognitoBtn = document.getElementById("incognitoBtn");
  if (incognitoBtn) {
    incognitoBtn.addEventListener("click", async () => {
      try {
        const newState = await ipcRenderer.invoke("toggle-incognito");
        updateIncognitoUI(newState);
      } catch {
        showInAppNotification(
          "Failed to toggle incognito mode.",
          3000,
          "error",
        );
      }
    });
  }
});

ipcRenderer.on(
  "scheduled-session-notification",
  async (
    _event: any,
    data: {
      title?: string;
      message?: string;
      sessionId?: number;
      type?: string;
    },
  ) => {
    if (data && data.message) {
      // Prefer sidebar for produced scheduled-session notifications when enabled
      try {
        const prefs = await getCachedPreferences();
        const enabled = !!(
          prefs?.notification_settings?.enabled &&
          prefs?.notification_settings?.scheduledSessions
        );
        if (enabled) {
          addSidebarNotification({ title: data.title, message: data.message });
        } else {
          showNotification(`${data.title} - ${data.message}`);
        }
      } catch (err) {
        // Fallback to ephemeral toast on error
        showNotification(`${data.title} - ${data.message}`);
      }

      // For "time to start" notifications, offer to switch to calendar
      if (data.type === "time_to_start") {
        setTimeout(() => {
          showConfirmationModal({
            title: "Start Session",
            message:
              "Would you like to open the calendar to start the session?",
            confirmText: "Open Calendar",
            onConfirm: () => navigateTo("sessions", "calendar"),
          });
        }, 2000);
      }
    }
  },
);

export async function applyAccentColor() {
  const theme = document.body.classList.contains("light") ? "light" : "dark";

  // Apply cached accent instantly (no round-trip)
  const cachedAccent = getCachedAccentColor(theme);
  applyAccentToDOM(theme, cachedAccent);

  // Background refresh from Supabase
  const serverAccent = await safeIpcInvoke<string>(
    "get-accent-color",
    [theme],
    { fallback: cachedAccent, showNotification: false },
  );

  if (serverAccent !== cachedAccent) {
    const updatedColors = {
      ...(theme === "light"
        ? { light: serverAccent, dark: getCachedAccentColor("dark") }
        : { light: getCachedAccentColor("light"), dark: serverAccent }),
    };
    updateCachedPreference("accent_color", updatedColors);
    applyAccentToDOM(theme, serverAccent);
  }

  await updateAccentTextColors();
}

function applyAccentToDOM(theme: "light" | "dark", accentColor: string): void {
  if (theme === "light") {
    document.body.style.setProperty("--accent", accentColor);
    document.documentElement.style.removeProperty("--accent");
  } else {
    document.documentElement.style.setProperty("--accent", accentColor);
    document.body.style.removeProperty("--accent");
  }
}

async function applyUserTheme() {
  // Apply cached theme instantly, then verify with server
  const { getCachedTheme } = await import("./utils/preferencesCache");
  const cachedTheme = getCachedTheme() as "light" | "dark";
  document.body.classList.toggle("light", cachedTheme === "light");
  await applyAccentColor();
  window.dispatchEvent(new Event("theme-changed"));

  // Verify server agrees (non-blocking)
  const serverTheme = await safeIpcInvoke<"light" | "dark">(
    "get-user-theme",
    [],
    { fallback: cachedTheme, showNotification: false },
  );
  if (serverTheme !== cachedTheme) {
    updateCachedPreference("theme", serverTheme);
    document.body.classList.toggle("light", serverTheme === "light");
    await applyAccentColor();
    window.dispatchEvent(new Event("theme-changed"));
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  // Initialize error logging first (before anything else)
  initSentryRenderer();
  addBreadcrumb("App initialized", { timestamp: new Date().toISOString() });

  const landing = document.getElementById("userLanding") as HTMLDivElement;
  const mainUI = document.getElementById("mainUI");

  // Notices and the password-reset form for links finished by main
  initializeOAuthListener();

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
    
    // Update Sentry user context for error tracking
    setSentryUser(String(userId));
    addBreadcrumb("User logged in", { userId });

    if (mainUI) {
      mainUI.style.display = "";
      renderMainUI();
      setupRecordAndPauseBtns();
      // Main may already be recording (e.g. after a window reload)
      void refreshTrackingState().then(restoreLastProject);
      void updateTeamVisibility();
    }
    if (landing) landing.style.display = "none";

    forceRefreshPreferences();
    applyUserTheme();

    // Show onboarding for new users
    if (shouldShowOnboarding()) {
      setTimeout(() => showOnboarding(), 500);
    } else {
      // Show org setup wizard if user has no org and hasn't dismissed
      shouldShowOrgSetupWizard().then((show) => {
        if (show) setTimeout(() => showOrgSetupWizard(), 1000);
      });
    }

    // Check for scheduled session notifications 5 seconds after user logs in
    setTimeout(() => {
      ipcRenderer.invoke("check-notifications").catch(() => {});
    }, 5000);

    // Start daily goal checker after user is authenticated
    startDailyGoalChecker();

    // Start periodic session health check
    startSessionHealthCheck();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).showMainUIForUser = showMainUIForUser;
  }

  /** Show the landing page; signing in there opens the main UI. */
  function showLanding() {
    if (mainUI) mainUI.style.display = "none";
    if (!landing) return;
    landing.style.display = "";
    renderLandingPage(landing, (session: AuthSession) => {
      showMainUIForUser(session.user.id);
      landing.style.display = "none";
    });
  }

  /** Signed out, or the session expired: reset everything for the next user. */
  async function handleSignedOut() {
    if (!isMainUIInitialized && landing?.style.display !== "none") return;
    isMainUIInitialized = false;
    destroyConnectionStatus();
    destroySyncStatus();
    stopSessionHealthCheck();
    clearSentryUser(); // Clear user context from error logging
    if (dailyGoalCheckInterval) {
      clearInterval(dailyGoalCheckInterval);
      dailyGoalCheckInterval = null;
    }
    localStorage.removeItem("currentUserId");
    clearRoleCache();
    invalidateDailyGoalCache();
    invalidatePreferencesCache();
    invalidateLogsCache();
    // Every page re-renders for the next user
    resetNavigation();
    setNavItemVisible("team", false);
    showLanding();
  }

  // Main owns the session (it signs in, refreshes and stores it); ask it
  // who is signed in, after handing over a login kept by older versions
  try {
    await importLegacySession();
    const user = await getAuthUser();
    if (user) showMainUIForUser(user.id);
    else showLanding();
  } catch (error) {
    // Main didn't answer: fall back to the last user, if any
    addBreadcrumb("Auth check failed, using fallback", { error: String(error) });
    const storedUserId = localStorage.getItem("currentUserId");
    if (storedUserId) showMainUIForUser(storedUserId);
    else showLanding();
  }

  // Sign-in (password, GitHub, email link) and sign-out / expiry, from main
  onAuthState((session) => {
    if (session) {
      showMainUIForUser(session.user.id);
    } else {
      void handleSignedOut();
    }
  });
});

function renderMainUI() {
  initUI();
  applyAccentColor();
  setupHotkeys();
  initConnectionStatus();
  initNotificationSidebar();
  initSyncStatus();
}

let dailyGoalCheckInterval: NodeJS.Timeout | null = null;

async function checkDailyGoalProgress() {
  try {
    const today = new Date().toLocaleDateString("en-CA");
    const { goal: dailyGoal, totalMins } = await getDailyGoalCached(today);
    if (!dailyGoal) return;

    if (!dailyGoal.isCompleted && totalMins >= dailyGoal.time) {
      await safeIpcInvoke("complete-daily-goal", [today], {
        showNotification: false,
      });
      invalidateDailyGoalCache(today);
      showNotification("🎉 Daily goal achieved!");
      // Also add to notification sidebar if user prefs allow
      try {
        const prefs = await getCachedPreferences();
        const enabled = !!(
          prefs?.notification_settings?.enabled &&
          prefs?.notification_settings?.dailyGoals
        );
        if (enabled)
          addSidebarNotification({ message: "Daily goal achieved!" });
      } catch (err) {
        void err;
      }
      // The goal box on Home shows completion
      refreshPages("dashboard");
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

// ── Session Health Check ──────────────────────────────────────────
// Periodically verify the auth session is still valid.
// If the session has expired and auto-refresh failed, redirect to login.
let sessionHealthInterval: NodeJS.Timeout | null = null;
const SESSION_HEALTH_CHECK_MS = 15 * 60 * 1000; // Every 15 minutes

async function checkSessionHealth() {
  try {
    // Main refreshes the session; if that failed for good, it is gone and
    // main has already announced the sign-out. This catches a missed event.
    if (!(await getAuthUser())) {
      showInAppNotification(
        "Your session has expired. Please sign in again.",
        5000,
        "warning",
      );
      await signOutAndSave();
    }
  } catch {
    // Main not answering — try again next interval
  }
}

function startSessionHealthCheck() {
  stopSessionHealthCheck();
  sessionHealthInterval = setInterval(
    checkSessionHealth,
    SESSION_HEALTH_CHECK_MS,
  );
}

function stopSessionHealthCheck() {
  if (sessionHealthInterval) {
    clearInterval(sessionHealthInterval);
    sessionHealthInterval = null;
  }
}

/**
 * If the user is actively recording, auto-save the session via the main process
 * before signing out / session expiry clears the auth state.
 * Uses stop-tracking which will prompt for session info (with a 30s timeout fallback).
 */
async function autoSaveRecordingOnTimeout() {
  if (!getTrackingState().isRecording) return;
  try {
    // Main saves the session (if >= 10s) after the session-info prompt;
    // the buttons update from the state broadcast.
    await stopTracking();
  } catch (err) {
    void err;
  }
}

/**
 * Sign out: save a running session first (it needs the signed-in user),
 * then main ends the session and announces it on "auth-state".
 */
export async function signOutAndSave() {
  await autoSaveRecordingOnTimeout();
  await signOut();
}
