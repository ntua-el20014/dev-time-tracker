/**
 * Repo → project links (C1). The repo is always the one main detected; the
 * renderer only chooses the project, so it can't plant arbitrary repo keys.
 */
import { ipcMain } from "electron";
import { getCurrentUser } from "../supabase/api";
import { getRepoLinks, unlinkRepo } from "../supabase/projectRepositories";
import {
  getDetectedRepo,
  linkRepo,
  reloadRepoLinks,
} from "../tracking/tracker";
import { onProjectsChanged } from "./projectHandlers";

// Archived projects stop being suggested; restored ones come back
onProjectsChanged(() => void reloadRepoLinks());

const isId = (v: unknown): v is string =>
  typeof v === "string" && /^[\w-]{1,64}$/.test(v);

/** The user's links, for the Projects page. */
ipcMain.handle("get-repo-links", async () => {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error("User not authenticated");
    return await getRepoLinks(user.id);
  } catch {
    return [];
  }
});

/** Link the currently detected repo to a project. */
ipcMain.handle("link-detected-repo", async (_event, projectId: unknown) => {
  try {
    const repo = getDetectedRepo();
    if (!repo || !isId(projectId)) return false;
    await linkRepo(repo, projectId);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("unlink-repo", async (_event, repoKey: unknown) => {
  try {
    if (typeof repoKey !== "string" || !repoKey || repoKey.length > 512) {
      return false;
    }
    const user = await getCurrentUser();
    if (!user) throw new Error("User not authenticated");
    await unlinkRepo(user.id, repoKey);
    await reloadRepoLinks();
    return true;
  } catch {
    return false;
  }
});
