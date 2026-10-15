/**
 * Preload: the renderer's only bridge to the main process.
 *
 * The renderer runs with contextIsolation and without Node integration, so it
 * can't require("electron"). This exposes a minimal IPC API as
 * window.electronAPI (see renderer/ipc.ts for the typed wrapper). The
 * IpcRendererEvent is never passed through — it carries the sender object.
 *
 * Only the channels in shared/ipcChannels.ts get through: a script that
 * ends up in the page can't reach handlers the UI doesn't use.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
// Lets @sentry/electron/renderer report through main under contextIsolation
import "@sentry/electron/preload";
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  SEND_CHANNELS,
} from "../shared/ipcChannels";

type Listener = (...args: unknown[]) => void;

const invokable = new Set<string>(INVOKE_CHANNELS);
const sendable = new Set<string>(SEND_CHANNELS);
const listenable = new Set<string>(EVENT_CHANNELS);

function refuse(kind: string, channel: string): Error {
  return new Error(`IPC ${kind} on channel "${channel}" is not allowed`);
}

const electronAPI = {
  invoke: (channel: string, ...args: unknown[]) =>
    invokable.has(channel)
      ? ipcRenderer.invoke(channel, ...args)
      : Promise.reject(refuse("invoke", channel)),

  send: (channel: string, ...args: unknown[]) => {
    if (!sendable.has(channel)) throw refuse("send", channel);
    ipcRenderer.send(channel, ...args);
  },

  /** Subscribe to a channel; returns an unsubscribe function. */
  on: (channel: string, listener: Listener) => {
    if (!listenable.has(channel)) throw refuse("listen", channel);
    const wrapped = (_event: IpcRendererEvent, ...args: unknown[]) =>
      listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },

  removeAllListeners: (channel: string) => {
    if (!listenable.has(channel)) throw refuse("listen", channel);
    ipcRenderer.removeAllListeners(channel);
  },
};

export type ElectronAPI = typeof electronAPI;

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
