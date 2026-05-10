import { app } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdaterState } from "../shared/types";

let initialized = false;
let stateListener: ((state: UpdaterState) => void) | null = null;

const updaterState: UpdaterState = {
  status: "disabled",
  message: "Updater has not been initialized.",
  canCheck: false,
  canDownload: false,
  canInstall: false,
  autoEnabled: false,
};

function emitState() {
  if (stateListener) {
    stateListener({ ...updaterState });
  }
}

function setState(partial: Partial<UpdaterState>) {
  Object.assign(updaterState, partial);
  emitState();
}

function isUpdaterEnabled(): boolean {
  const envEnabled = process.env.UPDATER_ENABLED === "true";
  const devAllowed = process.env.UPDATER_ALLOW_DEV === "true";
  const prodLike =
    app.isPackaged || process.env.NODE_ENV === "production" || devAllowed;
  return envEnabled && prodLike;
}

function shouldAutoCheck(): boolean {
  return process.env.UPDATER_AUTO_CHECK === "true";
}

function shouldAutoDownload(): boolean {
  return process.env.UPDATER_AUTO_DOWNLOAD === "true";
}

function configureUpdaterFeed() {
  const feedUrl = process.env.UPDATER_FEED_URL;

  if (feedUrl) {
    autoUpdater.setFeedURL(feedUrl);
    return;
  }

  // Allow passing OWNER/REPO together in UPDATER_GITHUB_REPO (owner/repo)
  let owner = process.env.UPDATER_GITHUB_OWNER || "ntua-el20014";
  let repo = process.env.UPDATER_GITHUB_REPO || "dev-time-tracker";
  if (repo.includes("/")) {
    const parts = repo.split("/");
    owner = parts[0] || owner;
    repo = parts[1] || repo;
  }

  autoUpdater.setFeedURL({
    provider: "github",
    owner,
    repo,
    private: process.env.UPDATER_GITHUB_PRIVATE === "true",
  });
}

export function setUpdaterStateSink(listener: (state: UpdaterState) => void) {
  stateListener = listener;
  emitState();
}

export function getUpdaterState(): UpdaterState {
  return { ...updaterState };
}

export async function initUpdater(): Promise<UpdaterState> {
  if (initialized) {
    return getUpdaterState();
  }

  initialized = true;

  const enabled = isUpdaterEnabled();
  const autoCheck = shouldAutoCheck();
  const autoDownload = shouldAutoDownload();

  setState({
    status: enabled ? "idle" : "disabled",
    message: enabled
      ? "Updater ready. Manual checks are available."
      : "Updater disabled (requires production + UPDATER_ENABLED=true).",
    canCheck: enabled,
    canDownload: false,
    canInstall: false,
    autoEnabled: enabled,
    progressPercent: undefined,
    availableVersion: undefined,
    downloadedVersion: undefined,
    error: undefined,
  });

  if (!enabled) {
    return getUpdaterState();
  }

  autoUpdater.forceDevUpdateConfig = process.env.UPDATER_ALLOW_DEV === "true";
  configureUpdaterFeed();
  autoUpdater.autoDownload = autoDownload;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("checking-for-update", () => {
    setState({
      status: "checking",
      message: "Checking for updates...",
      canCheck: false,
      canDownload: false,
      canInstall: false,
      progressPercent: undefined,
      error: undefined,
    });
  });

  autoUpdater.on("update-available", (info) => {
    setState({
      status: "available",
      message: `Update available: v${info.version}`,
      availableVersion: info.version,
      canCheck: true,
      canDownload: !autoDownload,
      canInstall: false,
      progressPercent: autoDownload ? 0 : undefined,
      error: undefined,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    setState({
      status: "not-available",
      message: `You're up to date (v${info.version}).`,
      availableVersion: undefined,
      downloadedVersion: undefined,
      canCheck: true,
      canDownload: false,
      canInstall: false,
      progressPercent: undefined,
      error: undefined,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    setState({
      status: "downloading",
      message: `Downloading update... ${Math.round(progress.percent)}%`,
      canCheck: false,
      canDownload: false,
      canInstall: false,
      progressPercent: progress.percent,
      error: undefined,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    setState({
      status: "downloaded",
      message: `Update downloaded: v${info.version}. Restart to install.`,
      downloadedVersion: info.version,
      canCheck: true,
      canDownload: false,
      canInstall: true,
      progressPercent: 100,
      error: undefined,
    });
  });

  autoUpdater.on("error", (err) => {
    setState({
      status: "error",
      message: "Update check failed.",
      canCheck: true,
      canDownload: false,
      canInstall: false,
      progressPercent: undefined,
      error: err?.message || String(err),
    });
  });

  if (autoCheck) {
    await autoUpdater.checkForUpdates();
  }

  return getUpdaterState();
}

export async function checkForUpdatesManually(): Promise<UpdaterState> {
  if (!isUpdaterEnabled()) {
    setState({
      status: "disabled",
      message: "Updater is disabled in this build.",
      canCheck: false,
      canDownload: false,
      canInstall: false,
    });
    return getUpdaterState();
  }

  await autoUpdater.checkForUpdates();
  return getUpdaterState();
}

export async function downloadUpdateManually(): Promise<UpdaterState> {
  if (!isUpdaterEnabled()) {
    return getUpdaterState();
  }

  await autoUpdater.downloadUpdate();
  return getUpdaterState();
}

export function installDownloadedUpdate(): UpdaterState {
  if (!isUpdaterEnabled()) {
    return getUpdaterState();
  }

  autoUpdater.quitAndInstall();
  return getUpdaterState();
}
