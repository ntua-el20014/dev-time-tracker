/**
 * Auto-updates via Electron's built-in autoUpdater (Squirrel) and the free
 * update.electronjs.org service, which serves the latest *published* GitHub
 * release of this (public) repo. No update server or extra build tooling.
 *
 * - Windows: works with the Squirrel installer that `npm run make` builds.
 *   The release must contain RELEASES, the .nupkg and the Setup.exe
 *   (.github/workflows/release.yml uploads them).
 * - macOS: needs a code-signed app, so it's off unless UPDATER_ENABLED=true.
 * - Linux: not supported by Squirrel.
 *
 * Updates download in the background; the Profile tab then offers
 * "Restart to install".
 *
 * Config (getEnv): UPDATER_ENABLED=false disables it; UPDATER_GITHUB_REPO
 * (owner/repo) or UPDATER_FEED_URL change the source; UPDATER_ALLOW_DEV=true
 * allows unpackaged builds (they will report errors: dev builds aren't
 * installed by Squirrel).
 */
import { app, autoUpdater } from "electron";
import type { UpdaterState } from "../shared/types";
import { getEnv } from "./buildEnv";

const DEFAULT_REPO = "ntua-el20014/dev-time-tracker";
/** Re-check while the app is running */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** Squirrel holds a lock right after install; wait before the first check */
const FIRST_CHECK_DELAY_MS = 30 * 1000;

let initialized = false;
let stateListener: ((state: UpdaterState) => void) | null = null;

const updaterState: UpdaterState = {
  status: "disabled",
  message: "Updater has not been initialized.",
  canCheck: false,
  canDownload: false, // downloads are automatic with Squirrel
  canInstall: false,
  autoEnabled: false,
};

function emitState() {
  stateListener?.({ ...updaterState });
}

function setState(partial: Partial<UpdaterState>) {
  Object.assign(updaterState, partial);
  emitState();
}

/** Why updates can't run here, or null if they can. */
function disabledReason(): string | null {
  if (getEnv("UPDATER_ENABLED") === "false") return "Updates are turned off.";
  if (!app.isPackaged && getEnv("UPDATER_ALLOW_DEV") !== "true") {
    return "Updates only run in the installed app.";
  }
  if (process.platform === "win32") return null;
  if (process.platform === "darwin" && getEnv("UPDATER_ENABLED") === "true") {
    return null; // only for signed macOS builds
  }
  return process.platform === "darwin"
    ? "Automatic updates on macOS need a signed build."
    : "Automatic updates aren't available on this platform.";
}

function feedUrl(): string {
  const custom = getEnv("UPDATER_FEED_URL");
  if (custom) return custom;
  const repo = getEnv("UPDATER_GITHUB_REPO") || DEFAULT_REPO;
  return `https://update.electronjs.org/${repo}/${process.platform}-${process.arch}/${app.getVersion()}`;
}

export function setUpdaterStateSink(listener: (state: UpdaterState) => void) {
  stateListener = listener;
  emitState();
}

export function getUpdaterState(): UpdaterState {
  return { ...updaterState };
}

function checkNow() {
  try {
    autoUpdater.checkForUpdates();
  } catch (err) {
    setState({
      status: "error",
      message: "Update check failed.",
      canCheck: true,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function initUpdater(): Promise<UpdaterState> {
  if (initialized) return getUpdaterState();
  initialized = true;

  const reason = disabledReason();
  if (reason) {
    setState({ status: "disabled", message: reason, canCheck: false });
    return getUpdaterState();
  }

  autoUpdater.setFeedURL({ url: feedUrl() });

  autoUpdater.on("checking-for-update", () =>
    setState({
      status: "checking",
      message: "Checking for updates...",
      canCheck: false,
      error: undefined,
    }),
  );

  // Squirrel starts downloading as soon as an update is found
  autoUpdater.on("update-available", () =>
    setState({
      status: "downloading",
      message: "Downloading update...",
      canCheck: false,
      error: undefined,
    }),
  );

  autoUpdater.on("update-not-available", () =>
    setState({
      status: "not-available",
      message: `You're up to date (v${app.getVersion()}).`,
      canCheck: true,
      error: undefined,
    }),
  );

  autoUpdater.on("update-downloaded", (_event, _notes, releaseName) => {
    const version = (releaseName || "").replace(/^.*?v?(\d+\.\d+\.\d+.*)$/, "$1");
    setState({
      status: "downloaded",
      message: `Update ${version ? `v${version} ` : ""}downloaded. Restart to install.`,
      downloadedVersion: version || undefined,
      canCheck: false,
      canInstall: true,
      error: undefined,
    });
  });

  autoUpdater.on("error", (err) =>
    setState({
      status: "error",
      message: "Update check failed.",
      canCheck: true,
      error: err?.message || String(err),
    }),
  );

  setState({
    status: "idle",
    message: "Updates are checked automatically.",
    canCheck: true,
    autoEnabled: true,
  });

  // Right after a fresh install Squirrel is still busy; skip that run's check
  if (!process.argv.includes("--squirrel-firstrun")) {
    setTimeout(checkNow, FIRST_CHECK_DELAY_MS);
  }
  setInterval(() => {
    if (updaterState.status !== "downloaded") checkNow();
  }, CHECK_INTERVAL_MS);

  return getUpdaterState();
}

export async function checkForUpdatesManually(): Promise<UpdaterState> {
  if (disabledReason()) return getUpdaterState();
  checkNow();
  return getUpdaterState();
}

/** Kept for the IPC contract: Squirrel downloads automatically. */
export async function downloadUpdateManually(): Promise<UpdaterState> {
  return getUpdaterState();
}

export function installDownloadedUpdate(): UpdaterState {
  if (updaterState.canInstall) {
    // before-quit still runs, so an active session is saved first
    autoUpdater.quitAndInstall();
  }
  return getUpdaterState();
}
