/**
 * Preload: the renderer's only bridge to the main process.
 *
 * The renderer runs with contextIsolation and without Node integration, so it
 * can't require("electron"). This exposes a minimal IPC API as
 * window.electronAPI (see renderer/ipc.ts for the typed wrapper). The
 * IpcRendererEvent is never passed through — it carries the sender object.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
// Lets @sentry/electron/renderer report through main under contextIsolation
import "@sentry/electron/preload";

type Listener = (...args: unknown[]) => void;

const electronAPI = {
  invoke: (channel: string, ...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args),

  send: (channel: string, ...args: unknown[]) =>
    ipcRenderer.send(channel, ...args),

  /** Subscribe to a channel; returns an unsubscribe function. */
  on: (channel: string, listener: Listener) => {
    const wrapped = (_event: IpcRendererEvent, ...args: unknown[]) =>
      listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },

  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
};

export type ElectronAPI = typeof electronAPI;

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
