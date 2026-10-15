/**
 * The project chosen before Start lives in main (TrackingState.projectId).
 * This remembers the user's choice per device (localStorage is fine for a
 * convenience) and gives it back to main after sign-in.
 */
import { getTrackingState, setSessionProject } from "./trackingControls";
import { getCurrentUserIdSafe } from "./utils";

const storageKey = (uid: string) => `dtt:lastProject:${uid}`;

function read(uid: string): string | null {
  try {
    return localStorage.getItem(storageKey(uid));
  } catch {
    return null;
  }
}

function write(uid: string, projectId: string | null) {
  try {
    if (projectId) localStorage.setItem(storageKey(uid), projectId);
    else localStorage.removeItem(storageKey(uid));
  } catch {
    // Storage unavailable: the choice just isn't remembered
  }
}

/** The user picked a project (or "No project") for this/the next session. */
export async function chooseProject(projectId: string | null) {
  await setSessionProject(projectId);
  const uid = getCurrentUserIdSafe();
  if (uid) write(uid, projectId);
}

/** After sign-in: hand main the user's last project, unless it has one. */
export async function restoreLastProject() {
  const uid = getCurrentUserIdSafe();
  if (!uid || getTrackingState().projectId) return;
  const saved = read(uid);
  if (saved) await setSessionProject(saved);
}
