import { ipcMain } from "electron";
import * as tags from "../supabase/tags";
import { getCurrentUser } from "../supabase/api";
import { logError } from "../utils/errorHandler";

/**
 * Get all tags for the current user
 */
ipcMain.handle("get-all-tags", async (_event) => {
  try {
    // Get current authenticated user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    const allTags = await tags.getAllTags(user.id);
    return allTags;
  } catch (err) {
    logError("get-all-tags", err);
    return [];
  }
});

/**
 * Set/update the color of a tag
 */
ipcMain.handle(
  "set-tag-color",
  async (_event, tagName: string, color: string) => {
    try {
      // Get current authenticated user
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      // Find the tag by name
      const tag = await tags.getTagByName(user.id, tagName);

      if (tag) {
        // Update existing tag
        await tags.updateTag((tag as any).id, { color });
      } else {
        // Create new tag with the specified color
        await tags.createTag(user.id, tagName, color);
      }

      return true;
    } catch (err) {
      logError("set-tag-color", err);
      return false;
    }
  },
);

/**
 * Set tags for a session (replaces all existing tags)
 */
ipcMain.handle(
  "set-session-tags",
  async (_event, sessionId: string | number, tagNames: string[]) => {
    try {
      // Get current authenticated user
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      const sessionIdStr = String(sessionId);
      await tags.setSessionTagsByNames(user.id, sessionIdStr, tagNames);

      return true;
    } catch (err) {
      logError("set-session-tags", err);
      return false;
    }
  },
);

/**
 * Delete a tag (and remove it from all sessions)
 */
ipcMain.handle("delete-tag", async (_event, name: string) => {
  try {
    // Get current authenticated user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    // Find the tag by name
    const tag = await tags.getTagByName(user.id, name);

    if (tag) {
      await tags.deleteTag((tag as any).id);
    }

    return true;
  } catch (err) {
    logError("delete-tag", err);
    return false;
  }
});
