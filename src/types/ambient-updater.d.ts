declare module "./updater" {
  import type { UpdaterState } from "../shared/types";

  export function setUpdaterStateSink(
    listener: (state: UpdaterState) => void,
  ): void;
  export function getUpdaterState(): UpdaterState;
  export function initUpdater(): Promise<UpdaterState>;
  export function checkForUpdatesManually(): Promise<UpdaterState>;
  export function downloadUpdateManually(): Promise<UpdaterState>;
  export function installDownloadedUpdate(): UpdaterState;
}

// Provide a minimal ambient module for the side-effect IPC handler import
declare module "./ipc/updaterHandlers" {
  // No exports; this module is imported for its side effects only.
  const _default: void;
  export = _default;
}
