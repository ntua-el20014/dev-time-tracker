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
import { BROWSER_CATEGORIES } from "../shared/browserCategories";
import { currencyOptionsHtml } from "./utils/currencyOptions";

type NotificationSettings = {
  enabled: boolean;
  scheduledSessions: boolean;
  dailyGoals: boolean;
  healthAlerts?: boolean;
  orgInvites?: boolean;
  syncStatus?: boolean;
};

const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  enabled: true,
  scheduledSessions: true,
  dailyGoals: true,
  healthAlerts: true,
  orgInvites: true,
  syncStatus: false,
};

/** The notification kinds under the master switch. */
const NOTIFICATION_KINDS: {
  id: string;
  key: "scheduledSessions" | "dailyGoals" | "healthAlerts" | "orgInvites";
  label: string;
  hint: string;
}[] = [
  {
    id: "notifScheduled",
    key: "scheduledSessions",
    label: "Scheduled session reminders",
    hint: "A nudge before a planned session starts.",
  },
  {
    id: "notifDailyGoals",
    key: "dailyGoals",
    label: "Daily goal reached",
    hint: "When you reach today's goal.",
  },
  {
    id: "notifHealth",
    key: "healthAlerts",
    label: "Health alerts",
    hint: "Warnings about tracking or sync problems.",
  },
  {
    id: "notifOrgInvites",
    key: "orgInvites",
    label: "Organization invites",
    hint: "Invitations from your organization.",
  },
];

const DEFAULT_ACCENTS = { dark: "#f0db4f", light: "#007acc" } as const;

const TAG_COLORS = [
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

// --- Building blocks (labels and hints are our own text, not user input) ---

/** A switch: the styled checkbox used across Settings. */
function toggleHtml(id: string, ariaLabel: string, checked = false): string {
  return `
    <label class="notification-toggle" for="${id}" aria-label="${ariaLabel}">
      <input type="checkbox" id="${id}" ${checked ? "checked" : ""} />
      <span class="notification-toggle-track" aria-hidden="true">
        <span class="notification-toggle-thumb"></span>
      </span>
    </label>`;
}

/** One setting: its name and a short explanation on the left, the control on the right. */
function settingHtml(opts: {
  label: string;
  hint?: string;
  control: string;
  forId?: string;
  className?: string;
}): string {
  const label = opts.forId
    ? `<label class="settings-item-label" for="${opts.forId}">${opts.label}</label>`
    : `<span class="settings-item-label">${opts.label}</span>`;
  return `
    <div class="settings-item${opts.className ? ` ${opts.className}` : ""}">
      <div class="settings-item-text">
        ${label}
        ${opts.hint ? `<p class="settings-item-hint">${opts.hint}</p>` : ""}
      </div>
      <div class="settings-item-control">${opts.control}</div>
    </div>`;
}

/** A titled group of settings. */
function cardHtml(title: string, body: string, note?: string): string {
  return `
    <section class="settings-card">
      <h3 class="settings-card-title">${title}</h3>
      ${body}
      ${note ? `<p class="settings-card-note">${note}</p>` : ""}
    </section>`;
}

function currentTheme(): "dark" | "light" {
  return document.body.classList.contains("light") ? "light" : "dark";
}

function formatIdleTimeout(seconds: number): string {
  return `${+(seconds / 60).toFixed(1)} min`;
}

/** A range input that shows its value while dragging and saves when let go. */
function wireRange(
  container: HTMLElement,
  inputId: string,
  valueId: string,
  format: (value: number) => string,
  save: (value: number) => Promise<unknown>,
) {
  const input = container.querySelector<HTMLInputElement>(`#${inputId}`);
  const value = container.querySelector<HTMLElement>(`#${valueId}`);
  if (!input || !value) return;
  input.addEventListener("input", () => {
    value.textContent = format(parseInt(input.value, 10));
  });
  input.addEventListener("change", () => {
    void save(parseInt(input.value, 10));
  });
}

// --- App updates (About) ---

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

function updaterFallback(message: string): UpdaterState {
  return {
    status: "error",
    message,
    canCheck: true,
    canDownload: false,
    canInstall: false,
    autoEnabled: false,
  };
}

/** Settings → General: how tracking behaves, billing defaults, notifications. */
async function renderGeneral(container: HTMLElement) {
  const [idleRaw, intervalRaw, alwaysOn, defaultCurrency, notif] =
    await Promise.all([
      safeIpcInvoke<number>("get-idle-timeout", [], { fallback: 60 }),
      safeIpcInvoke<number>("get-tracking-interval", [], { fallback: 10 }),
      safeIpcInvoke<boolean>("get-always-on", [], { fallback: false }),
      safeIpcInvoke<string>("get-default-currency", [], {
        fallback: DEFAULT_CURRENCY,
      }),
      safeIpcInvoke<NotificationSettings>("get-notification-settings", [], {
        fallback: DEFAULT_NOTIFICATIONS,
      }),
    ]);
  const idleTimeout =
    typeof idleRaw === "number" && idleRaw > 0 ? idleRaw : 60;
  const interval =
    typeof intervalRaw === "number" && intervalRaw > 0 ? intervalRaw : 10;
  const notifications = { ...DEFAULT_NOTIFICATIONS, ...(notif || {}) };

  const tracking =
    settingHtml({
      label: "Idle timeout",
      forId: "idleTimeoutRange",
      hint: "With no keyboard or mouse input for this long and no AI agent at work, a running session pauses, backdated to your last activity.",
      control: `
        <input type="range" id="idleTimeoutRange" class="settings-range" min="60" max="300" step="30" value="${idleTimeout}">
        <span id="idleTimeoutValue" class="settings-value">${formatIdleTimeout(idleTimeout)}</span>`,
    }) +
    settingHtml({
      label: "Sampling interval",
      forId: "trackingIntervalRange",
      hint: "How often the app in front is checked. Each check adds this many seconds to App activity, the language and editor charts and the daily goal. Shorter is more precise. Session time isn't affected.",
      control: `
        <input type="range" id="trackingIntervalRange" class="settings-range" min="5" max="30" step="5" value="${interval}">
        <span id="trackingIntervalValue" class="settings-value">${interval} s</span>`,
    }) +
    settingHtml({
      label: "Always-on",
      forId: "alwaysOnToggle",
      hint: "Outside sessions, record your work as drafts to review in Sessions. A draft is never billed until you confirm it. This device only.",
      control: toggleHtml("alwaysOnToggle", "Always-on tracking", alwaysOn),
    });

  const billing = settingHtml({
    label: "Default currency",
    forId: "defaultCurrencySelect",
    hint: "Used for new projects. Each project can have its own.",
    control: `<select id="defaultCurrencySelect" class="settings-select">${currencyOptionsHtml(defaultCurrency)}</select>`,
  });

  const notificationRows =
    settingHtml({
      label: "Show notifications",
      forId: "notifEnabled",
      hint: "Turn off to silence all of the below.",
      control: toggleHtml("notifEnabled", "Show notifications", notifications.enabled),
    }) +
    NOTIFICATION_KINDS.map((kind) =>
      settingHtml({
        label: kind.label,
        forId: kind.id,
        hint: kind.hint,
        className: "settings-item-sub",
        control: toggleHtml(kind.id, kind.label, !!notifications[kind.key]),
      }),
    ).join("");

  container.innerHTML = `
    <div class="settings-page">
      <h2>General</h2>
      ${cardHtml("Tracking", tracking)}
      ${cardHtml("Billing", billing)}
      ${cardHtml("Notifications", notificationRows)}
    </div>
  `;

  wireRange(
    container,
    "idleTimeoutRange",
    "idleTimeoutValue",
    formatIdleTimeout,
    (seconds) => safeIpcInvoke("set-idle-timeout", [seconds], { fallback: null }),
  );
  wireRange(
    container,
    "trackingIntervalRange",
    "trackingIntervalValue",
    (seconds) => `${seconds} s`,
    (seconds) =>
      safeIpcInvoke("set-tracking-interval", [seconds], { fallback: null }),
  );

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

  const currencySelect = container.querySelector<HTMLSelectElement>(
    "#defaultCurrencySelect",
  );
  currencySelect?.addEventListener("change", async () => {
    const ok = await safeIpcInvoke("set-default-currency", [currencySelect.value], {
      fallback: false,
    });
    if (!ok) showNotification("Couldn't save the currency", 3000);
  });

  // Notifications: the kinds are greyed out while the master switch is off
  const enabledEl = container.querySelector<HTMLInputElement>("#notifEnabled");
  const kindEls = NOTIFICATION_KINDS.map((kind) => ({
    kind,
    el: container.querySelector<HTMLInputElement>(`#${kind.id}`),
  }));
  const syncDisabled = () => {
    const on = !!enabledEl?.checked;
    for (const { el } of kindEls) {
      if (!el) continue;
      el.disabled = !on;
      el.closest(".settings-item")?.classList.toggle("is-disabled", !on);
    }
  };
  syncDisabled();

  const saveNotifications = async () => {
    const next: NotificationSettings = {
      ...notifications,
      enabled: !!enabledEl?.checked,
    };
    for (const { kind, el } of kindEls) next[kind.key] = !!el?.checked;
    const ok = await safeIpcInvoke("set-notification-settings", [next], {
      fallback: false,
    });
    if (ok) {
      Object.assign(notifications, next);
      try {
        updateCachedPreference("notification_settings", next);
      } catch {
        // The cache refreshes on its own; not worth failing the save over
      }
    } else {
      showNotification("Failed to save notification preferences", 3000);
    }
  };
  enabledEl?.addEventListener("change", () => {
    syncDisabled();
    void saveNotifications();
  });
  for (const { el } of kindEls) {
    el?.addEventListener("change", () => void saveNotifications());
  }
}

/** Keeps an open Appearance page in step when the theme changes. */
function syncAppearanceToTheme() {
  const theme = currentTheme();
  document
    .querySelectorAll<HTMLButtonElement>(".settings-segment[data-theme-choice]")
    .forEach((btn) => {
      const active = btn.dataset.themeChoice === theme;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  const input = document.getElementById("accentColorInput") as HTMLInputElement | null;
  if (!input) return;
  safeIpcInvoke<string>("get-accent-color", [theme], {
    fallback: DEFAULT_ACCENTS[theme],
  }).then((color) => setAccentPreview(input, color));
}

function setAccentPreview(input: HTMLInputElement, color: string) {
  input.value = color;
  const swatch = input.closest<HTMLElement>(".accent-color-preview");
  if (swatch) swatch.style.background = color;
  const value = document.getElementById("accentColorValue");
  if (value) value.textContent = color;
}

let themeListenerRegistered = false;

/** Settings → Appearance: theme and accent color. */
async function renderAppearance(container: HTMLElement) {
  if (!themeListenerRegistered) {
    window.addEventListener("theme-changed", syncAppearanceToTheme);
    themeListenerRegistered = true;
  }

  const theme = currentTheme();
  const accentColor = await safeIpcInvoke<string>("get-accent-color", [theme], {
    fallback: DEFAULT_ACCENTS[theme],
  });

  const body =
    settingHtml({
      label: "Theme",
      control: `
        <div class="settings-segmented" role="group" aria-label="Theme">
          <button type="button" class="settings-segment" data-theme-choice="dark">Dark</button>
          <button type="button" class="settings-segment" data-theme-choice="light">Light</button>
        </div>`,
    }) +
    settingHtml({
      label: "Accent color",
      hint: "Buttons, highlights and charts. Dark and light each keep their own; this changes the one in use.",
      control: `
        <label class="accent-color-preview" title="Pick a color">
          <input type="color" id="accentColorInput" class="accent-color-input" value="${escapeHtml(accentColor)}" />
        </label>
        <code id="accentColorValue" class="settings-value">${escapeHtml(accentColor)}</code>
        <button id="saveAccentColorBtn" class="btn btn-primary btn-sm">Save</button>
        <button id="resetAccentColorsBtn" class="btn btn-secondary btn-sm">Reset</button>`,
    });

  container.innerHTML = `
    <div class="settings-page">
      <h2>Appearance</h2>
      ${cardHtml("Theme", body)}
    </div>
  `;

  const accentInput = container.querySelector(
    "#accentColorInput",
  ) as HTMLInputElement;
  setAccentPreview(accentInput, accentColor);
  syncAppearanceToTheme();

  container
    .querySelectorAll<HTMLButtonElement>(".settings-segment[data-theme-choice]")
    .forEach((btn) => {
      btn.addEventListener("click", async () => {
        const choice = btn.dataset.themeChoice as "dark" | "light";
        if (choice === currentTheme()) return;
        document.body.classList.toggle("light", choice === "light");
        await setUserTheme(choice);
        await applyAccentColor();
        window.dispatchEvent(new Event("theme-changed"));
      });
    });

  accentInput.addEventListener("input", () => {
    setAccentPreview(accentInput, accentInput.value);
  });

  container
    .querySelector("#saveAccentColorBtn")
    ?.addEventListener("click", async () => {
      const color = accentInput.value;
      const theme = currentTheme();
      await safeIpcInvoke("set-accent-color", [color, theme], {
        fallback: null,
      });
      await applyAccentColor();
      window.dispatchEvent(new Event("theme-changed"));
      showNotification(`Accent color saved for the ${theme} theme`, 2500);
    });

  container
    .querySelector("#resetAccentColorsBtn")
    ?.addEventListener("click", () => {
      showConfirmationModal({
        title: "Reset Accent Colors",
        message: "Reset the accent colors of both themes to the defaults?",
        confirmText: "Reset",
        onConfirm: async () => {
          await safeIpcInvoke("set-accent-color", [DEFAULT_ACCENTS.dark, "dark"], {
            fallback: null,
          });
          await safeIpcInvoke(
            "set-accent-color",
            [DEFAULT_ACCENTS.light, "light"],
            { fallback: null },
          );
          await applyAccentColor();
          window.dispatchEvent(new Event("theme-changed"));
        },
      });
    });
}

/** Settings → Tags & data: your tags, and exporting your data. */
async function renderTagsAndData(container: HTMLElement) {
  const tags: Tag[] = await safeIpcInvoke("get-all-tags", [], { fallback: [] });

  const tagList =
    tags.length === 0
      ? `<p class="settings-empty">No tags yet. Tags you add to sessions show up here.</p>`
      : `<ul id="tag-list-settings" class="tag-list-settings">
          ${tags
            .map(
              (tag) => `
            <li class="tag-list-item">
              <button type="button" class="tag-color-chip" data-tag="${escapeHtml(tag.name)}"
                style="background:${escapeHtml(tag.color)};" title="Change color" aria-label="Change the color of ${escapeHtml(tag.name)}"></button>
              <span class="tag-name">${escapeHtml(tag.name)}</span>
              <button class="btn btn-secondary btn-sm delete-tag-btn" data-tag="${escapeHtml(tag.name)}">Delete</button>
            </li>`,
            )
            .join("")}
        </ul>`;

  const exportRow = settingHtml({
    label: "Export my data",
    hint: "Your sessions, daily summaries, tags and goals for a date range, as CSV, JSON or a PDF report.",
    control: `<button id="openPersonalExportBtn" class="btn btn-primary btn-sm">Export…</button>`,
  });

  container.innerHTML = `
    <div class="settings-page">
      <h2>Tags &amp; data</h2>
      ${cardHtml(
        "Tags",
        tagList,
        tags.length ? "Click a dot to change its color. Deleting a tag removes it from every session." : undefined,
      )}
      ${cardHtml("Export", exportRow)}
    </div>
  `;

  container.querySelectorAll<HTMLButtonElement>(".delete-tag-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tag = btn.dataset.tag;
      showConfirmationModal({
        title: "Delete Tag",
        message: `Delete tag "${tag}"? This will remove it from all sessions.`,
        confirmText: "Delete",
        confirmClass: "btn-delete",
        onConfirm: async () => {
          await safeIpcInvoke("delete-tag", [tag], { fallback: null });
          renderTagsAndData(container);
        },
      });
    });
  });

  container.querySelectorAll<HTMLElement>(".tag-color-chip").forEach((chip) => {
    chip.addEventListener("click", (e) => {
      const tagName = chip.dataset.tag;
      if (!tagName) return;
      showColorGridPicker({
        colors: TAG_COLORS,
        selected: chip.style.backgroundColor,
        anchorEl: chip,
        onSelect: async (color) => {
          await safeIpcInvoke("set-tag-color", [tagName, color], {
            fallback: null,
          });
          renderTagsAndData(container);
        },
      });
      e.stopPropagation();
    });
  });

  container
    .querySelector("#openPersonalExportBtn")
    ?.addEventListener("click", () => createPersonalExportModal());
}

/** Settings → About: app updates and the welcome tour. */
async function renderAbout(container: HTMLElement) {
  const updates = `
    <div class="settings-item">
      <div class="settings-item-text">
        <span class="settings-item-label">App updates</span>
        <p id="updaterStatusText" class="settings-item-hint">Loading updater state…</p>
      </div>
      <div class="settings-item-control">
        <button id="checkUpdatesBtn" class="btn btn-secondary btn-sm">Check for updates</button>
        <button id="downloadUpdateBtn" class="btn btn-primary btn-sm" style="display:none;">Download</button>
        <button id="installUpdateBtn" class="btn btn-primary btn-sm" style="display:none;">Restart to install</button>
      </div>
    </div>`;

  const help = settingHtml({
    label: "Welcome tour",
    hint: "A short walk through the main pages.",
    control: `<button id="showOnboardingBtn" class="btn btn-secondary btn-sm">Show tour</button>`,
  });

  container.innerHTML = `
    <div class="settings-page">
      <h2>About</h2>
      ${cardHtml("Updates", updates)}
      ${cardHtml("Help", help)}
    </div>
  `;

  updaterStatusEl = container.querySelector("#updaterStatusText");
  updaterCheckBtn = container.querySelector("#checkUpdatesBtn");
  updaterDownloadBtn = container.querySelector("#downloadUpdateBtn");
  updaterInstallBtn = container.querySelector("#installUpdateBtn");
  ensureUpdaterListener();

  updaterCheckBtn?.addEventListener("click", async () => {
    applyUpdaterState(
      await safeIpcInvoke<UpdaterState>("updater:check", [], {
        fallback: updaterFallback("Failed to check for updates."),
      }),
    );
  });
  updaterDownloadBtn?.addEventListener("click", async () => {
    applyUpdaterState(
      await safeIpcInvoke<UpdaterState>("updater:download", [], {
        fallback: updaterFallback("Failed to download update."),
      }),
    );
  });
  updaterInstallBtn?.addEventListener("click", async () => {
    await safeIpcInvoke("updater:install", [], { fallback: null });
  });

  container
    .querySelector("#showOnboardingBtn")
    ?.addEventListener("click", () => showOnboarding());

  applyUpdaterState(
    await safeIpcInvoke<UpdaterState>("updater:get-state", [], {
      fallback: {
        status: "disabled",
        message: "Updater unavailable.",
        canCheck: false,
        canDownload: false,
        canInstall: false,
        autoEnabled: false,
      },
    }),
  );
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
  <div class="language-pie-info" style="margin-top: 16px;">
    <b>Name what your browser time was for:</b><br>
    Edit the file <code>browser-categories.json</code> in your app data folder:<br>
    <div class="centered-btn">
      <button id="openBrowserCategoriesBtn" class="open-lang-json-btn">
        Open browser-categories.json
      </button>
    </div>
    Example content:
    <pre>
{
  "titles": {
    "- Notion": "docs",
    "Figma": "Design"
  },
  "hosts": {
    "grafana.mycorp.com": "ci-deploy",
    "github.com/mycorp/handbook": "docs",
    "youtube.com": "other"
  }
}</pre>
    <div class="info-note">
      <b>titles</b>: text the page title contains. <b>hosts</b>: a site (and its subdomains), optionally with a path.
      Your rules go before the built-in ones; the first match wins.<br>
      Categories: ${(Object.keys(BROWSER_CATEGORIES) as (keyof typeof BROWSER_CATEGORIES)[])
        .map((key) => `<code>${escapeHtml(key)}</code> (${escapeHtml(BROWSER_CATEGORIES[key])})`)
        .join(", ")}, <code>other</code> (Other browsing), or a name of your own (up to 40 characters).<br>
      Only the category is saved, never the title or address. A host rule applies only when the title isn't recognised
      (some browsers don't report addresses); to change a recognised page, use a title rule. Changes apply on the next sample.
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
  container
    .querySelector("#openBrowserCategoriesBtn")
    ?.addEventListener("click", () => {
      safeIpcInvoke("open-browser-categories-json", [], { fallback: null });
    });

  const agents = container.querySelector<HTMLElement>("#agentIntegration");
  if (agents) await renderAgentIntegration(agents);
}

/** Settings → Account & team: who you are, your avatar, your org, and the way into Team. */
async function renderAccountSection(container: HTMLElement) {
  const userId = getCurrentUserId();
  const [profile, org, user, editors, langs] = await Promise.all([
    getCurrentUserProfile(),
    getCurrentOrganization(),
    safeIpcInvoke<{ avatar?: string } | null>("get-user-info", [userId], {
      fallback: null,
    }),
    safeIpcInvoke<{ app: string; icon: string }[]>("get-user-editors", [], {
      fallback: [],
    }),
    safeIpcInvoke<{ lang_ext: string | null }[]>("get-user-lang-exts", [], {
      fallback: [],
    }),
  ]);

  if (!profile) {
    container.innerHTML = `<h2>Account &amp; team</h2><p>Could not load your profile.</p>`;
    return;
  }

  const avatar = user?.avatar || "";
  // The avatar picker offers the icons of the editors and languages you use
  const pickerIcons = Array.from(
    new Set([
      ...editors.map((e) => e.icon),
      ...langs
        .map((l) => (l.lang_ext ? getLangIconUrl(l.lang_ext) : ""))
        .filter((icon): icon is string => !!icon),
    ]),
  );
  const customAvatars = getCustomAvatars(userId);

  const teamVisible = isNavItemVisible("team");

  const roleBadgeClass = `role-badge role-${profile.role || "employee"}`;
  const roleLabel = profile.role
    ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1)
    : "Employee";

  container.innerHTML = `
    <div class="settings-page">
    <h2>Account &amp; team</h2>
    <div class="org-profile-section">
      <div class="org-profile-card">
        <div class="org-profile-row account-avatar-row">
          <label>Avatar:</label>
          <span class="avatar-preview">
            ${
              avatar
                ? `<img src="${escapeHtml(avatar)}" alt="Avatar" class="account-avatar-img">`
                : '<span class="avatar-placeholder"></span>'
            }
          </span>
          <button id="openAvatarPickerBtn" class="btn btn-secondary btn-sm">Choose…</button>
          ${avatar ? `<button id="removeAvatarBtn" class="btn btn-secondary btn-sm">Remove</button>` : ""}
          <input type="file" id="avatarInput" accept="image/*" hidden>
        </div>
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
    </div>
  `;

  // --- Avatar ---
  const openPickerBtn = container.querySelector(
    "#openAvatarPickerBtn",
  ) as HTMLButtonElement;
  const avatarInput = container.querySelector(
    "#avatarInput",
  ) as HTMLInputElement;

  openPickerBtn.addEventListener("click", () => {
    showAvatarPicker({
      anchorEl: openPickerBtn,
      icons: pickerIcons,
      customAvatars,
      onSelect: async (icon) => {
        await safeIpcInvoke("set-user-avatar", [icon], { fallback: null });
        renderAccountSection(container);
      },
      onUpload: () => avatarInput.click(),
      onDeleteCustom: async (icon) => {
        removeCustomAvatar(userId, icon);
        renderAccountSection(container);
      },
    });
  });

  avatarInput.addEventListener("change", () => {
    const file = avatarInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      addCustomAvatar(userId, dataUrl);
      await safeIpcInvoke("set-user-avatar", [dataUrl], { fallback: null });
      renderAccountSection(container);
    };
    reader.readAsDataURL(file);
  });

  container
    .querySelector("#removeAvatarBtn")
    ?.addEventListener("click", async () => {
      await safeIpcInvoke("set-user-avatar", [""], { fallback: null });
      renderAccountSection(container);
    });

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

const CHAPTERS: {
  id: string;
  label: string;
  render: (el: HTMLElement) => void | Promise<void>;
}[] = [
  { id: "general", label: "General", render: renderGeneral },
  { id: "appearance", label: "Appearance", render: renderAppearance },
  { id: "data", label: "Tags &amp; data", render: renderTagsAndData },
  { id: "integrations", label: "Integrations", render: renderIntegrations },
  { id: "shortcuts", label: "Shortcuts", render: renderHotkeys },
  { id: "account", label: "Account &amp; team", render: renderAccountSection },
  { id: "about", label: "About", render: renderAbout },
];

/** The open chapter, kept when Settings re-renders (e.g. after an org change). */
let openChapter = "general";

export async function renderSettingsView() {
  const settingsDiv = document.getElementById("settingsContent");
  if (!settingsDiv) return;

  settingsDiv.innerHTML = `
  <div class="profile-main-flex">
    <nav class="profile-sidebar" aria-label="Settings sections">
      <ul class="profile-chapter-list">
        ${CHAPTERS.map(
          (c) =>
            `<li><button class="profile-chapter-btn" data-chapter="${c.id}">${c.label}</button></li>`,
        ).join("")}
      </ul>
      <button id="logoutBtn" class="logout-btn">Log out</button>
    </nav>
    <div id="settingsChapterContent" class="profile-chapter-content"></div>
  </div>
  `;

  const contentDiv = settingsDiv.querySelector(
    "#settingsChapterContent",
  ) as HTMLElement;
  const buttons = settingsDiv.querySelectorAll(".profile-chapter-btn");

  async function showChapter(chapter: string) {
    const entry = CHAPTERS.find((c) => c.id === chapter);
    if (!entry) return;
    openChapter = chapter;
    buttons.forEach((btn) => {
      btn.classList.toggle(
        "active",
        (btn as HTMLButtonElement).dataset.chapter === chapter,
      );
    });
    // Each chapter renders into its own pane: a slower render that is still
    // running (e.g. General when the user clicks on) fills a pane that's
    // no longer on screen instead of replacing the chapter they opened
    const pane = document.createElement("div");
    contentDiv.replaceChildren(pane);
    await withLoading(pane, "Loading…", async () => {
      await entry.render(pane);
    });
  }

  showChapter(openChapter);
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const chapter = (btn as HTMLButtonElement).dataset.chapter;
      if (chapter) showChapter(chapter);
    });
  });

  const logoutBtn = settingsDiv.querySelector("#logoutBtn") as HTMLButtonElement;
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
