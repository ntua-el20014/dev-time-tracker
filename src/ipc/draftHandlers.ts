/**
 * The drafts review inbox (Phase D3): always-on segments saved as drafts
 * are listed, confirmed (title, project, billable), merged or discarded.
 *
 * A draft may belong to the segment being recorded right now, or have a
 * save still in flight; settleDraft() (tracker) deals with that first, so
 * a later save can't undo what the user did here.
 */
import { ipcMain } from "electron";
import * as timeTracking from "../supabase/timeTracking";
import { getCurrentUser } from "../supabase/api";
import {
  getOrganizationProjects,
  getPersonalProjects,
} from "../supabase/cloudProjects";
import { logError } from "../utils/errorHandler";
import { mergeDrafts } from "../../shared/drafts";
import { openDraftClientId, settleDraft } from "../tracking/tracker";
import { enrichSessions } from "./sessionHandlers";

const MAX_IDS = 200;

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("User not authenticated");
  return user;
}

/** Ids from the renderer: strings of a sane shape, at most MAX_IDS. */
function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map(String)
        .filter((id) => /^[\w-]{1,64}$/.test(id)),
    ),
  ].slice(0, MAX_IDS);
}

const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** A project the user can assign sessions to (active, personal or org). */
async function visibleProjectId(
  userId: string,
  projectId: unknown,
): Promise<string | null> {
  if (typeof projectId !== "string" || projectId === "") return null;
  const [org, personal] = await Promise.all([
    getOrganizationProjects(userId),
    getPersonalProjects(userId),
  ]);
  if (![...org, ...personal].some((p) => p.id === projectId)) {
    throw new Error("Unknown project");
  }
  return projectId;
}

/** Settle every listed draft, then read them again (the last save may have changed them). */
async function settled(
  userId: string,
  ids: string[],
  mode: "keep" | "forget",
) {
  const rows = await timeTracking.getDraftSessionsByIds(userId, ids);
  for (const row of rows) {
    if (row.client_id) await settleDraft(userId, row.client_id, mode);
  }
  return mode === "keep"
    ? await timeTracking.getDraftSessionsByIds(userId, ids)
    : rows;
}

ipcMain.handle("get-draft-sessions", async () => {
  try {
    const user = await requireUser();
    const rows = await enrichSessions(
      await timeTracking.getDraftSessions(user.id),
    );
    const open = openDraftClientId();
    return rows.map((row) => ({
      ...row,
      in_progress: open !== null && row.client_id === open,
    }));
  } catch (err) {
    logError("get-draft-sessions", err);
    return [];
  }
});

ipcMain.handle("get-draft-count", async () => {
  try {
    const user = await requireUser();
    return await timeTracking.countDraftSessions(user.id);
  } catch (err) {
    logError("get-draft-count", err);
    return 0;
  }
});

ipcMain.handle("confirm-draft-session", async (_event, input: unknown) => {
  try {
    const user = await requireUser();
    const i = (input ?? {}) as Record<string, unknown>;
    const [id] = normalizeIds([i.id]);
    const title = text(i.title, 200);
    if (!id || !title) throw new Error("A draft and a title are needed");
    const projectId = await visibleProjectId(user.id, i.projectId);
    await settled(user.id, [id], "keep");
    return await timeTracking.confirmDraftSession(user.id, id, {
      title,
      description: text(i.description, 2000) || null,
      projectId,
      isBillable: i.isBillable === true,
    });
  } catch (err) {
    logError("confirm-draft-session", err);
    return false;
  }
});

ipcMain.handle("merge-draft-sessions", async (_event, ids: unknown) => {
  try {
    const user = await requireUser();
    const rows = await settled(user.id, normalizeIds(ids), "keep");
    if (rows.length < 2) return null;
    const merged = mergeDrafts(rows);
    if (!(await timeTracking.updateDraftSession(user.id, merged.keepId, merged.fields))) {
      return null;
    }
    // The merged drafts' segments have ended: forgetting them only drops
    // anything still queued, so it can't come back
    for (const row of rows) {
      if (row.id !== merged.keepId && row.client_id) {
        await settleDraft(user.id, row.client_id, "forget");
      }
    }
    await timeTracking.deleteDraftSessions(user.id, merged.deleteIds);
    return merged.keepId;
  } catch (err) {
    logError("merge-draft-sessions", err);
    return null;
  }
});

ipcMain.handle("discard-draft-sessions", async (_event, ids: unknown) => {
  try {
    const user = await requireUser();
    const rows = await settled(user.id, normalizeIds(ids), "forget");
    await timeTracking.deleteDraftSessions(
      user.id,
      rows.map((r) => r.id),
    );
    return rows.length;
  } catch (err) {
    logError("discard-draft-sessions", err);
    return 0;
  }
});
