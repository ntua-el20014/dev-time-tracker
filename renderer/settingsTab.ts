import { applyAccentColor, signOutAndSave } from "./renderer";
import { escapeHtml } from "./utils/domUtils";
import { ipcRenderer } from "./ipc";
import {
  showColorGridPicker,
  showAvatarPicker,
  showConfirmationModal,
  showNotification,
  showOnboarding,
} from "./components";
import { loadHotkey, setUserTheme } from "./theme";
import {
  getCurrentUserId,
  getCustomAvatars,
  addCustomAvatar,
  removeCustomAvatar,
  safeIpcInvoke,
  withLoading,
} from "./utils";
import { createPersonalExportModal } from "./utils/sessionExporter";
import { renderAgentIntegration } from "./components/AgentIntegration";
import {
  getCurrentOrganization,
  getCurrentUserProfile,
  leaveOrganization,
} from "./utils/organizationApi";
import { updateCachedPreference } from "./utils/preferencesCache";
import { resetOrgWizardDismissed, showOrgSetupWizard } from "./components";
import { getLangIconUrl } from "../src/utils/langIconUrl";
import { isNavItemVisible, navigateTo, pinNavItem } from "./navigation";
import type { Tag, UpdaterState } from "../shared/types";
import { DEFAULT_CURRENCY } from "../shared/currency";
import { currencyOptionsHtml } from "./utils/currencyOptions";


type NotificationSettings = {
  enabled: boolean;
  scheduledSessions: boolean;
  dailyGoals: boolean;
  healthAlerts?: boolean;
  orgInvites?: boolean;
  syncStatus?: boolean;
};

let updaterListenerRegistered = false;
let updaterStatusEl: HTMLElement | null = null;
let updaterCheckBtn: HTMLButtonElement | null = null;
let updaterDownloadBtn: HTMLButtonElement | null = null;
let updaterInstallBtn: HTMLButtonElement | null = null;

function applyUpdaterState(state: UpdaterState) {
  if (updaterStatusEl) {
    const statusPrefix = state.status
      .replace(/-/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
    updaterStatusEl.textContent = `${statusPrefix}: ${state.message}`;
  }

  if (updaterCheckBtn) updaterCheckBtn.disabled = !state.canCheck;

  if (updaterDownloadBtn) {
    updaterDownloadBtn.style.display = state.canDownload ? "" : "none";
    updaterDownloadBtn.disabled = !state.canDownload;
  }

  if (updaterInstallBtn) {
    updaterInstallBtn.style.display = state.canInstall ? "" : "none";
    updaterInstallBtn.disabled = !state.canInstall;
  }
}

function ensureUpdaterListener() {
  if (updaterListenerRegistered) return;

  ipcRenderer.on("updater:state-changed", (_event, state: UpdaterState) =>
    applyUpdaterState(state),
  );
  updaterListenerRegistered = true;
}

async function renderSettings(container: HTMLElement) {
  let idleTimeout = await safeIpcInvoke("get-idle-timeout", [], {
    fallback: 60,
  });
  if (!idleTimeout || typeof idleTimeout !== "number") idleTimeout = 60;

  let trackingInterval = await safeIpcInvoke("get-tracking-interval", [], {
    fallback: 10,
  });
  if (!trackingInterval || typeof trackingInterval !== "number")
    trackingInterval = 10;

  const alwaysOn = await safeIpcInvoke<boolean>("get-always-on", [], {
    fallback: false,
  });

  const defaultCurrency = await safeIpcInvoke<string>("get-default-currency", [], {
    fallback: DEFAULT_CURRENCY,
  });

  // Get current theme
  const currentTheme = document.body.classList.contains("light")
    ? "light"
    : "dark";

  // Get current user info
  const userId = getCurrentUserId();
  const user: any = await safeIpcInvoke("get-user-info", [userId], {
    fallback: null,
  });
  const avatar = user?.avatar || "";

  // --- Avatar Picker Logic ---
  const editors: { app: string; icon: string }[] = await safeIpcInvoke(
    "get-user-editors",
    [],
    { fallback: [] },
  );
  const langs: { lang_ext: string | null }[] = await safeIpcInvoke(
    "get-user-lang-exts",
    [],
    { fallback: [] },
  );
  const langIcons: string[] = [];
  for (const l of langs) {
    if (l.lang_ext) {
      const icon = getLangIconUrl(l.lang_ext);
      if (icon) langIcons.push(icon);
    }
  }
  // Remove duplicates
  const editorIcons = Array.from(new Set(editors.map((e) => e.icon)));
  const customAvatars = getCustomAvatars(userId);

  // --- Tag management ---
  const tags: Tag[] = await safeIpcInvoke("get-all-tags", [], { fallback: [] });

  // --- Accent color management ---
  const theme: "dark" | "light" = document.body.classList.contains("light")
    ? "light"
    : "dark";
  const accentColor: string = await safeIpcInvoke("get-accent-color", [theme], {
    fallback: "#f0db4f",
  });

  // Build the complete HTML first, then set it all at once
  container.innerHTML = `
    <h2>Preferences</h2>
    <div class="settings-row">
      <label for="idleTimeoutRange" class="settings-label">Idle Timeout:</label>
      <input type="range" id="idleTimeoutRange" min="60" max="300" step="30" value="${idleTimeout}" class="settings-range">
      <span id="idleTimeoutValue" class="settings-range-value">${(
        idleTimeout / 60
      ).toFixed(1)} min</span>
    </div>
    <div class="settings-row">
      <label for="trackingIntervalRange" class="settings-label">Tracking Interval:</label>
      <input type="range" id="trackingIntervalRange" min="5" max="30" step="5" value="${trackingInterval}" class="settings-range">
      <span id="trackingIntervalValue" class="settings-range-value">${trackingInterval}s</span>
    </div>
    <div class="settings-row">
      <span class="settings-label">Always-on:</span>
      <label class="notification-toggle" for="alwaysOnToggle" aria-label="Always-on tracking">
        <input type="checkbox" id="alwaysOnToggle" ${alwaysOn ? "checked" : ""} />
        <span class="notification-toggle-track" aria-hidden="true">
          <span class="notification-toggle-thumb"></span>
        </span>
      </label>
      <span class="settings-range-value">Outside sessions, record work as drafts to review (never billed until confirmed). On this device.</span>
    </div>
    <div class="settings-row">
      <label for="defaultCurrencySelect" class="settings-label">Currency:</label>
      <select id="defaultCurrencySelect" class="settings-select" title="Used for new projects; each project can have its own">
        ${currencyOptionsHtml(defaultCurrency)}
      </select>
      <span class="settings-range-value">for new projects</span>
    </div>
    <div class="settings-row">
      <label class="settings-label">Theme:</label>
      <button id="themeToggleBtn" class="theme-toggle-btn">
        Switch to ${currentTheme === "dark" ? "Light" : "Dark"} Mode
      </button>
    </div>

    <h2>App Updates</h2>
    <div class="notification-preferences-panel">
      <p id="updaterStatusText" class="notification-preferences-note">
        Loading updater state...
      </p>
      <div class="settings-row">
        <button id="checkUpdatesBtn" class="help-button">Check for Updates</button>
        <button id="downloadUpdateBtn" class="help-button" style="display:none;">Download Update</button>
        <button id="installUpdateBtn" class="help-button" style="display:none;">Restart to Install</button>
      </div>
    </div>
    
    <h2>Notifications</h2>
    <div class="notification-preferences-panel">
      <p class="notification-preferences-note">
        Choose which events should surface as notifications.
      </p>
      <div class="notification-preferences-table-wrap">
        <table class="notification-preferences-table">
          <thead>
            <tr>
              <th>Preference</th>
              <th>Description</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="notification-pref-name">Enable notifications</td>
              <td class="notification-pref-description">Master switch for all notification delivery.</td>
              <td>
                <label class="notification-toggle" for="notifEnabled" aria-label="Enable notifications">
                  <input type="checkbox" id="notifEnabled" />
                  <span class="notification-toggle-track" aria-hidden="true">
                    <span class="notification-toggle-thumb"></span>
                  </span>
                </label>
              </td>
            </tr>
            <tr>
              <td class="notification-pref-name">Scheduled session reminders</td>
              <td class="notification-pref-description">Get nudges before a planned session starts.</td>
              <td>
                <label class="notification-toggle" for="notifScheduled" aria-label="Scheduled session reminders">
                  <input type="checkbox" id="notifScheduled" />
                  <span class="notification-toggle-track" aria-hidden="true">
                    <span class="notification-toggle-thumb"></span>
                  </span>
                </label>
              </td>
            </tr>
            <tr>
              <td class="notification-pref-name">Daily goal completions</td>
              <td class="notification-pref-description">Celebrate when you finish your daily target.</td>
              <td>
                <label class="notification-toggle" for="notifDailyGoals" aria-label="Daily goal completions">
                  <input type="checkbox" id="notifDailyGoals" />
                  <span class="notification-toggle-track" aria-hidden="true">
                    <span class="notification-toggle-thumb"></span>
                  </span>
                </label>
              </td>
            </tr>
            <tr>
              <td class="notification-pref-name">Health alerts</td>
              <td class="notification-pref-description">Receive warnings about tracking health or sync issues.</td>
              <td>
                <label class="notification-toggle" for="notifHealth" aria-label="Health alerts">
                  <input type="checkbox" id="notifHealth" />
                  <span class="notification-toggle-track" aria-hidden="true">
                    <span class="notification-toggle-thumb"></span>
                  </span>
                </label>
              </td>
            </tr>
            <tr>
              <td class="notification-pref-name">Org invites</td>
              <td class="notification-pref-description">Stay on top of invitations from your organization.</td>
              <td>
                <label class="notification-toggle" for="notifOrgInvites" aria-label="Org invites">
                  <input type="checkbox" id="notifOrgInvites" />
                  <span class="notification-toggle-track" aria-hidden="true">
                    <span class="notification-toggle-thumb"></span>
                  </span>
                </label>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    
    <div class="avatar-settings-row" style="margin-top:16px;">
      <label class="settings-label">Avatar:</label>
      <div class="avatar-preview" id="avatarPreview">
        ${
          avatar
            ? `<img src="${avatar}" alt="Avatar" id="avatarImg" style="width:48px;height:48px;border-radius:50%;">`
            : '<div id="avatarImg" class="avatar-placeholder"></div>'
        }
      </div>
      <button id="openAvatarPickerBtn" class="choose-avatar-btn">Choose</button>
      <input type="file" id="avatarInput" accept="image/*" style="display:none;">
    </div>

    <h2 class="settings-tags-title">Manage Tags</h2>
    ${
      tags.length === 0
        ? `<p>No tags added yet.</p>`
        : `<ul id="tag-list-settings" class="tag-list-settings">
            ${tags
              .map(
                (tag) => `
              <li class="tag-list-item">
                <span class="tag-label" style="background:${escapeHtml(tag.color)};">
                  ${escapeHtml(tag.name)}
                  <span class="tag-color-chip" data-tag="${escapeHtml(
                    tag.name,
                  )}" style="background:${escapeHtml(tag.color)};"></span>
                </span>
                <button class="btn-delete btn-small delete-tag-btn" data-tag="${escapeHtml(
                  tag.name,
                )}">Delete</button>
              </li>
            `,
              )
              .join("")}
          </ul>`
    }

    <div class="accent-color-header">
      <h2 class="accent-color-title">Accent Color</h2>
      <button id="resetAccentColorsBtn" class="reset-accent-btn">Reset</button>
    </div>
    <div class="accent-color-row">
      <div class="accent-color-preview" style="background:${accentColor};">
        <input type="color" id="accentColorInput" value="${accentColor}" class="accent-color-input" />
      </div>
      <button id="saveAccentColorBtn" class="save-accent-btn">Save</button>
    </div>
    <div class="info-note">
      Change the accent color for the current theme and <b>Save</b>.<br>
    </div>

    <div>
      <h2>My Data Export</h2>
      <p class="info-note" style="margin-bottom: 12px;">
        Export your own time tracking data, summaries, and PDF reports with a date range.
      </p>
      <button id="openPersonalExportBtn" class="help-button">Export My Data</button>
    </div>

    <div class="help-section">
      <h2>Need Help?</h2>
      <button id="showOnboardingBtn" class="help-button">🎯 Show Welcome Tour</button>
    </div>
  `;

  const range = container.querySelector(
    "#idleTimeoutRange",
  ) as HTMLInputElement;
  const valueSpan = container.querySelector(
    "#idleTimeoutValue",
  ) as HTMLSpanElement;

  const accentInput = container.querySelector(
    "#accentColorInput",
  ) as HTMLInputElement;
  const saveAccentBtn = container.querySelector(
    "#saveAccentColorBtn",
  ) as HTMLButtonElement;
  const resetAccentBtn = container.querySelector(
    "#resetAccentColorsBtn",
  ) as HTMLButtonElement;

  // Attach all event listeners

  const themeToggleBtn = container.querySelector(
    "#themeToggleBtn",
  ) as HTMLButtonElement;
  updaterStatusEl = container.querySelector("#updaterStatusText");
  updaterCheckBtn = container.querySelector(
    "#checkUpdatesBtn",
  ) as HTMLButtonElement;
  updaterDownloadBtn = container.querySelector(
    "#downloadUpdateBtn",
  ) as HTMLButtonElement;
  updaterInstallBtn = container.querySelector(
    "#installUpdateBtn",
  ) as HTMLButtonElement;

  ensureUpdaterListener();

  updaterCheckBtn.addEventListener("click", async () => {
    const state = await safeIpcInvoke<UpdaterState>("updater:check", [], {
      fallback: {
        status: "error",
        message: "Failed to check for updates.",
        canCheck: true,
        canDownload: false,
        canInstall: false,
        autoEnabled: false,
      },
    });
    applyUpdaterState(state);
  });

  updaterDownloadBtn.addEventListener("click", async () => {
    const state = await safeIpcInvoke<UpdaterState>("updater:download", [], {
      fallback: {
        status: "error",
        message: "Failed to download update.",
        canCheck: true,
        canDownload: false,
        canInstall: false,
        autoEnabled: false,
      },
    });
    applyUpdaterState(state);
  });

  updaterInstallBtn.addEventListener("click", async () => {
    await safeIpcInvoke("updater:install", [], { fallback: null });
  });

  const initialUpdaterState = await safeIpcInvoke<UpdaterState>(
    "updater:get-state",
    [],
    {
      fallback: {
        status: "disabled",
        message: "Updater unavailable.",
        canCheck: false,
        canDownload: false,
        canInstall: false,
        autoEnabled: false,
      },
    },
  );
  applyUpdaterState(initialUpdaterState);

  themeToggleBtn.addEventListener("click", async () => {
    document.body.classList.toggle("light");
    const newTheme = document.body.classList.contains("light")
      ? "light"
      : "dark";
    await setUserTheme(newTheme);
    await applyAccentColor();
    window.dispatchEvent(new Event("theme-changed"));
    themeToggleBtn.textContent = `Switch to ${
      newTheme === "dark" ? "Light" : "Dark"
    } Mode`;
  });

  if (range && valueSpan) {
    range.addEventListener("input", async () => {
      const seconds = parseInt(range.value, 10);
      valueSpan.textContent = (seconds / 60).toFixed(1) + " min";
      await safeIpcInvoke("set-idle-timeout", [seconds], { fallback: null });
    });
  } else {
    // Idle timeout elements not found - skip event listener setup
  }

  const alwaysOnToggle =
    container.querySelector<HTMLInputElement>("#alwaysOnToggle");
  alwaysOnToggle?.addEventListener("change", async () => {
    const enabled = await safeIpcInvoke<boolean>(
      "set-always-on",
      [alwaysOnToggle.checked],
      { fallback: !alwaysOnToggle.checked },
    );
    alwaysOnToggle.checked = enabled;
  });

  const intervalRange = container.querySelector(
    "#trackingIntervalRange",
  ) as HTMLInputElement;
  const intervalValueSpan = container.querySelector(
    "#trackingIntervalValue",
  ) as HTMLSpanElement;
  if (intervalRange && intervalValueSpan) {
    intervalRange.addEventListener("input", async () => {
      const secs = parseInt(intervalRange.value, 10);
      intervalValueSpan.textContent = secs + "s";
      await safeIpcInvoke("set-tracking-interval", [secs], {
        fallback: null,
      });
    });
  }

  const currencySelect = container.querySelector<HTMLSelectElement>(
    "#defaultCurrencySelect",
  );
  currencySelect?.addEventListener("change", async () => {
    const ok = await safeIpcInvoke("set-default-currency", [currencySelect.value], {
      fallback: false,
    });
    if (!ok) showNotification("Couldn't save the currency", 3000);
  });

  // --- Notification preferences wiring ---
  (async () => {
    try {
      const notifSettings = await safeIpcInvoke<NotificationSettings>(
        "get-notification-settings",
        [],
        {
          fallback: {
            enabled: true,
            scheduledSessions: true,
            dailyGoals: true,
            healthAlerts: true,
            orgInvites: true,
            syncStatus: false,
          },
        },
      );

      const enabledEl = container.querySelector(
        "#notifEnabled",
      ) as HTMLInputElement | null;
      const scheduledEl = container.querySelector(
        "#notifScheduled",
      ) as HTMLInputElement | null;
      const dailyEl = container.querySelector(
        "#notifDailyGoals",
      ) as HTMLInputElement | null;
      const healthEl = container.querySelector(
        "#notifHealth",
      ) as HTMLInputElement | null;
      const orgEl = container.querySelector(
        "#notifOrgInvites",
      ) as HTMLInputElement | null;

      if (enabledEl) enabledEl.checked = !!notifSettings.enabled;
      if (scheduledEl) scheduledEl.checked = !!notifSettings.scheduledSessions;
      if (dailyEl) dailyEl.checked = !!notifSettings.dailyGoals;
      if (healthEl) healthEl.checked = !!notifSettings.healthAlerts;
      if (orgEl) orgEl.checked = !!notifSettings.orgInvites;

      const saveSettings = async () => {
        const newSettings: any = {
          enabled: !!enabledEl?.checked,
          scheduledSessions: !!scheduledEl?.checked,
          dailyGoals: !!dailyEl?.checked,
          healthAlerts: !!healthEl?.checked,
          orgInvites: !!orgEl?.checked,
        };

        const ok = await safeIpcInvoke(
          "set-notification-settings",
          [newSettings],
          {
            fallback: false,
          },
        );
        if (ok) {
          // Update local cache for immediate use
          try {
            updateCachedPreference("notification_settings", newSettings);
          } catch {
            // ignore cache update errors, not critical to show updated settings on next load
          }
          // Silent success - preferences saved
        } else {
          showNotification("Failed to save notification preferences", 3000);
        }
      };

      [enabledEl, scheduledEl, dailyEl, healthEl, orgEl].forEach((el) => {
        if (el) el.addEventListener("change", () => void saveSettings());
      });
    } catch (err) {
      // ignore — leave defaults
    }
  })();

  container.querySelectorAll(".delete-tag-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tag = (btn as HTMLButtonElement).dataset.tag;
      showConfirmationModal({
        title: "Delete Tag",
        message: `Delete tag "${tag}"? This will remove it from all sessions.`,
        confirmText: "Delete",
        confirmClass: "btn-delete",
        onConfirm: async () => {
          await safeIpcInvoke("delete-tag", [tag], { fallback: null });
          renderSettings(container); // Refresh the list
        },
      });
    });
  });

  accentInput.addEventListener("input", () => {
    if (accentInput.parentElement) {
      accentInput.parentElement.style.background = accentInput.value; // Update preview
    }
  });

  saveAccentBtn.addEventListener("click", async () => {
    const currentTheme: "dark" | "light" = document.body.classList.contains(
      "light",
    )
      ? "light"
      : "dark";
    const colorToSave = accentInput.value;
    showConfirmationModal({
      title: "Apply Accent Color",
      message: `Apply new accent color ${colorToSave} for ${currentTheme} theme?`,
      confirmText: "Apply",
      onConfirm: async () => {
        await safeIpcInvoke("set-accent-color", [colorToSave, currentTheme], {
          fallback: null,
        });
        await applyAccentColor();
        window.dispatchEvent(new Event("theme-changed"));
        accentInput.value = colorToSave;
      },
    });
  });

  resetAccentBtn.addEventListener("click", async () => {
    showConfirmationModal({
      title: "Reset Accent Colors",
      message: "Reset both accent colors to default values?",
      confirmText: "Reset",
      onConfirm: async () => {
        await safeIpcInvoke("set-accent-color", ["#f0db4f", "dark"], {
          fallback: null,
        });
        await safeIpcInvoke("set-accent-color", ["#007acc", "light"], {
          fallback: null,
        });
        await applyAccentColor();

        // Always get the current theme at the moment of reset
        const currentTheme: "dark" | "light" = document.body.classList.contains(
          "light",
        )
          ? "light"
          : "dark";
        const newAccent = await safeIpcInvoke(
          "get-accent-color",
          [currentTheme],
          { fallback: "#f0db4f" },
        );
        accentInput.value = newAccent;
        if (accentInput.parentElement) {
          accentInput.parentElement.style.background = newAccent;
        }
      },
    });
  });

  function updateAccentPickerForTheme() {
    const theme: "dark" | "light" = document.body.classList.contains("light")
      ? "light"
      : "dark";
    safeIpcInvoke("get-accent-color", [theme], { fallback: "#f0db4f" }).then(
      (color: string) => {
        accentInput.value = color;
        if (accentInput.parentElement) {
          accentInput.parentElement.style.background = color;
        }
      },
    );
  }

  window.addEventListener("theme-changed", updateAccentPickerForTheme);

  const tagColors = [
    "#f0db4f",
    "#ff6961",
    "#7ed957",
    "#4f8cff",
    "#ffb347",
    "#b19cd9",
    "#f67280",
    "#355c7d",
    "#ffb6b9",
    "#c1c8e4",
    "#ffe156",
    "#6a0572",
    "#ff6f3c",
    "#00b8a9",
    "#f6416c",
    "#43dde6",
    "#e7e6e1",
    "#f9f871",
    "#a28089",
    "#f7b32b",
    "#2d4059",
    "#ea5455",
    "#ffd460",
    "#40514e",
    "#11999e",
  ];
  container.querySelectorAll(".tag-color-chip").forEach((chip) => {
    chip.addEventListener("click", (e) => {
      const tagName = (chip as HTMLElement).dataset.tag;
      if (!tagName) {
        return; // Skip if tag name not found
      }
      showColorGridPicker({
        colors: tagColors,
        selected: (chip as HTMLElement).style.backgroundColor,
        anchorEl: chip as HTMLElement,
        onSelect: async (color) => {
          await safeIpcInvoke("set-tag-color", [tagName, color], {
            fallback: null,
          });
          renderSettings(container); // or rerender tag list
        },
      });
      e.stopPropagation();
    });
  });

  // --- Avatar Picker Logic ---
  const openPickerBtn = container.querySelector(
    "#openAvatarPickerBtn",
  ) as HTMLButtonElement;
  const avatarInput = container.querySelector(
    "#avatarInput",
  ) as HTMLInputElement;

  openPickerBtn.onclick = () => {
    showAvatarPicker({
      anchorEl: openPickerBtn,
      icons: Array.from(new Set([...editorIcons, ...langIcons])),
      customAvatars: customAvatars,
      onSelect: async (icon) => {
        await safeIpcInvoke("set-user-avatar", [icon], { fallback: null });
        renderSettings(container);
      },
      onUpload: () => avatarInput.click(),
      onDeleteCustom: async (icon) => {
        removeCustomAvatar(userId, icon);
        renderSettings(container);
      },
    });
  };

  // Avatar upload logic
  avatarInput.onchange = async () => {
    if (avatarInput.files && avatarInput.files[0]) {
      const file = avatarInput.files[0];
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        // Add to custom avatars collection
        addCustomAvatar(userId, dataUrl);
        // Set as current user avatar
        await safeIpcInvoke("set-user-avatar", [dataUrl], { fallback: null });
        renderSettings(container);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeAvatarBtn = container.querySelector(
    "#removeAvatarBtn",
  ) as HTMLButtonElement;
  if (removeAvatarBtn) {
    removeAvatarBtn.onclick = async () => {
      await safeIpcInvoke("set-user-avatar", [""], { fallback: null });
      renderSettings(container);
    };
  }

  // --- Help Section Event Handlers ---
  const showOnboardingBtn = container.querySelector(
    "#showOnboardingBtn",
  ) as HTMLButtonElement;

  const openPersonalExportBtn = container.querySelector(
    "#openPersonalExportBtn",
  ) as HTMLButtonElement;

  if (showOnboardingBtn) {
    showOnboardingBtn.onclick = () => {
      showOnboarding();
    };
  }

  if (openPersonalExportBtn) {
    openPersonalExportBtn.onclick = () => {
      createPersonalExportModal();
    };
  }
}

/**
 * Settings → Integrations: AI coding agents, and files that teach the
 * tracker about apps and languages.
 */
async function renderIntegrations(container: HTMLElement) {
  container.innerHTML = `
  <h2>Integrations</h2>
  <div id="agentIntegration"></div>
  <div class="language-pie-info" style="margin-top: 16px;">
    <b>Track more apps:</b><br>
    Edit the file <code>custom-apps.json</code> in your app data folder:<br>
    <div class="centered-btn">
      <button id="openCustomAppsBtn" class="open-lang-json-btn">
        Open custom-apps.json
      </button>
    </div>
    Example content:
    <pre>
{
  "editors": [
    { "name": "My IDE", "execNames": ["myide", "myide.exe"] }
  ],
  "devTools": [],
  "browsers": []
}</pre>
    <div class="info-note">
      Add any app under <b>editors</b>, <b>devTools</b>, or <b>browsers</b>.<br>
      Use the exact executable name (without path). Changes apply on next tracking tick.
    </div>
  </div>
  <div class="language-pie-info" style="margin-top: 16px;">
    <b>Map unknown file extensions to languages:</b><br>
    Edit the file <code>lang.json</code> in your app data folder:<br>
    <div class="centered-btn">
      <button id="openLangJsonBtn" class="open-lang-json-btn">
        Open lang.json
      </button>
    </div>
    Example content:
    <pre>
{
  ".foo": "My Custom Language",
  ".bar": "AnotherLang"
}</pre>
    <div class="info-note">
      After saving, your changes will be applied automatically.
    </div>
  </div>
  `;

  container.querySelector("#openLangJsonBtn")?.addEventListener("click", () => {
    safeIpcInvoke("open-lang-json", [], { fallback: null });
  });
  container
    .querySelector("#openCustomAppsBtn")
    ?.addEventListener("click", () => {
      safeIpcInvoke("open-custom-apps-json", [], { fallback: null });
    });

  const agents = container.querySelector<HTMLElement>("#agentIntegration");
  if (agents) await renderAgentIntegration(agents);
}

/** Settings → Account & team: who you are, your org, and the way into Team. */
async function renderAccountSection(container: HTMLElement) {
  const profile = await getCurrentUserProfile();
  const org = await getCurrentOrganization();

  if (!profile) {
    container.innerHTML = `<h2>Account &amp; team</h2><p>Could not load your profile.</p>`;
    return;
  }

  const teamVisible = isNavItemVisible("team");

  const roleBadgeClass = `role-badge role-${profile.role || "employee"}`;
  const roleLabel = profile.role
    ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1)
    : "Employee";

  container.innerHTML = `
    <h2>Account &amp; team</h2>
    <div class="org-profile-section">
      <div class="org-profile-card">
        <div class="org-profile-row">
          <label>Username:</label>
          <span>${escapeHtml(profile.username)}</span>
        </div>
        <div class="org-profile-row">
          <label>Email:</label>
          <span>${escapeHtml(profile.email || "N/A")}</span>
        </div>
        <div class="org-profile-row">
          <label>Role:</label>
          <span class="${roleBadgeClass}">${roleLabel}</span>
        </div>
        <div class="org-profile-row">
          <label>Organization:</label>
          <span>${org ? escapeHtml(org.name) : '<span style="color:var(--text-secondary);">None</span>'}</span>
        </div>
        ${
          org && profile?.role === "admin"
            ? `
        <div class="org-profile-row">
          <label>Org ID:</label>
          <span class="org-uuid" title="${escapeHtml(org.id)}" style="font-size:0.85em;opacity:0.7;">${escapeHtml(org.id)}</span>
        </div>
        `
            : ""
        }
      </div>
      <div class="team-entry" style="margin-top: 1.5rem;">
        ${
          teamVisible
            ? `<p>Members, invites and team analytics are in the <b>Team</b> section.</p>
               <button id="openTeamBtn" class="btn btn-primary">Open Team</button>`
            : `<h3>Working with others?</h3>
               <p class="info-note">
                 Create a team organization, or join one with an invite code.
                 The Team section stays in the sidebar once your organization
                 has other members.
               </p>
               <button id="openTeamBtn" class="btn btn-primary">Set up a team</button>`
        }
      </div>
      ${
        org
          ? `
      <div style="margin-top: 1.5rem;">
        <button id="leaveOrgBtn" class="btn btn-danger">Leave Organization</button>
      </div>
      <div class="info-note" style="margin-top:0.75rem;">
        Leaving will remove you from this organization. You can create a new one or join another afterwards.
      </div>
      `
          : ""
      }
    </div>
  `;

  container.querySelector("#openTeamBtn")?.addEventListener("click", () => {
    pinNavItem("team");
    navigateTo("team", "organization");
  });

  // Leave org handler
  const leaveBtn = container.querySelector("#leaveOrgBtn") as HTMLButtonElement;
  if (leaveBtn && org) {
    leaveBtn.addEventListener("click", () => {
      showConfirmationModal({
        title: "Leave Organization",
        message: `Are you sure you want to leave "${org.name}"? This cannot be undone.`,
        confirmText: "Leave",
        confirmClass: "btn-delete",
        onConfirm: async () => {
          try {
            await leaveOrganization();
            showNotification("You have left the organization.");
            resetOrgWizardDismissed();
            (window as any).markTabsDirty("organization");
            window.dispatchEvent(new Event("organization:changed"));
            renderAccountSection(container);
            setTimeout(() => showOrgSetupWizard(), 800);
          } catch (error) {
            showNotification(
              `Failed to leave: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
          }
        },
      });
    });
  }
}

const CHAPTERS: Record<string, (el: HTMLElement) => void | Promise<void>> = {
  preferences: renderSettings,
  integrations: renderIntegrations,
  shortcuts: renderHotkeys,
  account: renderAccountSection,
};

/** The open chapter, kept when Settings re-renders (e.g. after an org change). */
let openChapter = "preferences";

export async function renderSettingsView() {
  const settingsDiv = document.getElementById("settingsContent");
  if (!settingsDiv) return;

  settingsDiv.innerHTML = `
  <div class="profile-main-flex">
    <nav class="profile-sidebar" aria-label="Settings sections">
      <ul class="profile-chapter-list">
        <li><button class="profile-chapter-btn" data-chapter="preferences">Preferences</button></li>
        <li><button class="profile-chapter-btn" data-chapter="integrations">Integrations</button></li>
        <li><button class="profile-chapter-btn" data-chapter="shortcuts">Shortcuts</button></li>
        <li><button class="profile-chapter-btn" data-chapter="account">Account &amp; team</button></li>
      </ul>
      <button id="logoutBtn" class="logout-btn">Log Out</button>
    </nav>
    <div id="settingsChapterContent" class="profile-chapter-content"></div>
  </div>
  `;

  const contentDiv = settingsDiv.querySelector(
    "#settingsChapterContent",
  ) as HTMLElement;
  const buttons = settingsDiv.querySelectorAll(".profile-chapter-btn");

  async function showChapter(chapter: string) {
    const render = CHAPTERS[chapter];
    if (!render) return;
    openChapter = chapter;
    // Each chapter renders into its own pane: a slower render that is still
    // running (e.g. Preferences when the user clicks on) fills a pane that's
    // no longer on screen instead of replacing the chapter they opened
    const pane = document.createElement("div");
    contentDiv.replaceChildren(pane);
    await withLoading(pane, "Loading…", async () => {
      await render(pane);
    });
    if (pane.parentElement !== contentDiv) return;
    buttons.forEach((btn) => {
      btn.classList.toggle(
        "active",
        (btn as HTMLButtonElement).dataset.chapter === chapter,
      );
    });
  }

  showChapter(openChapter);
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const chapter = (btn as HTMLButtonElement).dataset.chapter;
      if (chapter) showChapter(chapter);
    });
  });

  // Logout button logic
  const logoutBtn = settingsDiv.querySelector("#logoutBtn") as HTMLButtonElement;
  logoutBtn.onmouseenter = () => {
    logoutBtn.style.background =
      "linear-gradient(90deg, #f09819 0%, #ff5858 100%)";
    logoutBtn.style.boxShadow = "0 4px 16px #0003";
  };
  logoutBtn.onmouseleave = () => {
    logoutBtn.style.background =
      "linear-gradient(90deg, #ff5858 0%, #f09819 100%)";
    logoutBtn.style.boxShadow = "0 2px 8px #0002";
  };
  logoutBtn.onclick = async () => {
    // Save a running session, then main signs out (and tells the UI)
    try {
      await signOutAndSave();
    } catch (error) {
      // Continue with local logout even if the sign-out call fails
    }

    localStorage.removeItem("currentUserId");
    document.body.classList.remove("light");
    document.documentElement.style.setProperty("--accent", "#f0db4f");
    document.body.style.setProperty("--accent", "#f0db4f");
    const mainUI = document.getElementById("mainUI");
    if (mainUI) mainUI.style.display = "none";

    // Reset summaryTab state
    const summaryDiv = document.getElementById("summaryContent");
    if (summaryDiv) summaryDiv.innerHTML = "";
    if (window) {
      (window as any).__resetSummaryTabState = true;
    }
  };
}

function renderHotkeys(container: HTMLElement) {
  function keyImg(key: string) {
    const isLight = document.body.classList.contains("light");
    const suffix = isLight ? "" : "-w";
    try {
      return `<img src="${loadHotkey(
        key + "-key" + suffix,
      )}" alt="${key}" style="height:1.5em;vertical-align:middle;margin:0 2px;">`;
    } catch {
      return `<img src="${loadHotkey(
        key + "-key",
      )}" alt="${key}" style="height:1.5em;vertical-align:middle;margin:0 2px;">`;
    }
  }

  container.innerHTML = `
    <h2>Keyboard Shortcuts</h2>
    <ul style="list-style:none;padding:0;margin:0;line-height:2;">
      <li><span style="min-width:180px;display:inline-block;">${keyImg(
        "ctrl",
      )} + ${keyImg("r")}</span> Start/Stop recording</li>
      <li><span style="min-width:180px;display:inline-block;">${keyImg(
        "ctrl",
      )} + ${keyImg("p")}</span> Pause/Resume recording</li>
      <li><span style="min-width:180px;display:inline-block;">${keyImg(
        "ctrl",
      )} + ${keyImg("hashtag")}</span> Go to sidebar item # (1 = Home, counting down)</li>
      <li><span style="min-width:180px;display:inline-block;">Ctrl + Alt + Shift + I</span> Toggle incognito (works from any app)</li>
    </ul>
    <div class="info-note" style="margin-top:16px;">
      Shortcuts work while this window is focused, except when typing in an
      input or textarea. Incognito works system-wide. Start/Stop and
      Pause/Resume are also available from the tray icon.
    </div>
  `;
}
