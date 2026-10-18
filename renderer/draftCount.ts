/**
 * How many always-on drafts wait for review (Phase D3). Shown as a badge on
 * the Sessions rail item and as a line on Home; refreshed on sign-in, when
 * main saves a draft ("drafts-changed"), on opening Sessions, on window
 * focus (at most every 30 s), and after inbox actions.
 */
import { ipcRenderer } from "./ipc";
import { safeIpcInvoke } from "./utils/ipcHelpers";
import { onNavigate } from "./navigation";

let count = 0;
const listeners = new Set<(count: number) => void>();
const savedListeners = new Set<() => void>();

export function getDraftCount(): number {
  return count;
}

/** Called now and whenever the count changes. */
export function onDraftCount(listener: (count: number) => void) {
  listeners.add(listener);
  listener(count);
}

/** Called when main saved a draft (a new one, or one that grew). */
export function onDraftSaved(listener: () => void) {
  savedListeners.add(listener);
}

export const draftsLabel = (n: number) =>
  `${n} draft${n === 1 ? "" : "s"} to review`;

function showBadge() {
  const item = document.querySelector<HTMLElement>('.nav-item[data-view="sessions"]');
  if (!item) return;
  let badge = item.querySelector<HTMLElement>(".nav-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "nav-badge";
    item.appendChild(badge);
  }
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.hidden = count === 0;
  item.title = count > 0 ? draftsLabel(count) : "";
}

export async function refreshDraftCount(): Promise<number> {
  const next = await safeIpcInvoke<number>("get-draft-count", [], {
    fallback: count,
    showNotification: false,
  });
  const changed = typeof next === "number" && next !== count;
  if (changed) count = next;
  showBadge();
  if (changed) for (const listener of listeners) listener(count);
  return count;
}

// Drafts can also arrive without an event (another device, or a sign-in
// after they were saved): check when the user is likely to look
onNavigate((view) => {
  if (view === "sessions") void refreshDraftCount();
});
let lastFocusCheck = 0;
window.addEventListener("focus", () => {
  if (Date.now() - lastFocusCheck < 30_000) return;
  lastFocusCheck = Date.now();
  void refreshDraftCount();
});

ipcRenderer.on("drafts-changed", () => {
  void refreshDraftCount();
  for (const listener of savedListeners) listener();
});
