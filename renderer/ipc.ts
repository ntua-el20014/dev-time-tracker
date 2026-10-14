/**
 * IPC for the renderer, backed by the preload bridge (window.electronAPI).
 *
 * The renderer has no Node access, so never import from "electron" here —
 * import { ipcRenderer } from this module instead. It keeps the familiar
 * ipcRenderer shape: listeners still receive an (unused) event argument
 * first, so handlers written as (_event, data) => … work unchanged.
 */
import type { ElectronAPI } from "../src/preload";

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (event: unknown, ...args: any[]) => void;

function bridge(): ElectronAPI {
  if (!window.electronAPI) {
    throw new Error("electronAPI bridge missing — is the preload script set?");
  }
  return window.electronAPI;
}

/** Unsubscribe functions per channel and listener, for removeListener(). */
const subscriptions = new Map<string, Map<Listener, () => void>>();

export const ipcRenderer = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoke<T = any>(channel: string, ...args: unknown[]): Promise<T> {
    return bridge().invoke(channel, ...args) as Promise<T>;
  },

  send(channel: string, ...args: unknown[]): void {
    bridge().send(channel, ...args);
  },

  on(channel: string, listener: Listener) {
    const unsubscribe = bridge().on(channel, (...args) =>
      listener(undefined, ...args),
    );
    if (!subscriptions.has(channel)) subscriptions.set(channel, new Map());
    subscriptions.get(channel)!.set(listener, unsubscribe);
    return ipcRenderer;
  },

  removeListener(channel: string, listener: Listener) {
    const unsubscribe = subscriptions.get(channel)?.get(listener);
    if (unsubscribe) {
      unsubscribe();
      subscriptions.get(channel)!.delete(listener);
    }
    return ipcRenderer;
  },

  removeAllListeners(channel: string) {
    bridge().removeAllListeners(channel);
    subscriptions.delete(channel);
    return ipcRenderer;
  },
};
