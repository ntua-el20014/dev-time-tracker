import type { UpdaterState } from "../shared/types";

export function setUpdaterStateSink(
  listener: (state: UpdaterState) => void,
): void;
export function getUpdaterState(): UpdaterState;
export function initUpdater(): Promise<UpdaterState>;
export function checkForUpdatesManually(): Promise<UpdaterState>;
export function downloadUpdateManually(): Promise<UpdaterState>;
export function installDownloadedUpdate(): UpdaterState;
