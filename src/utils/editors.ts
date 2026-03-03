import * as fs from "fs";
import * as path from "path";
import { app } from "electron";

export type AppEntry = {
  name: string;
  execNames: string[];
};

export type AppCategory = "editor" | "devTool" | "browser" | "other";

export type AppMatch = {
  name: string;
  category: AppCategory;
};

export type KnownAppsData = {
  editors: AppEntry[];
  devTools: AppEntry[];
  browsers: AppEntry[];
};

let cachedData: KnownAppsData | null = null;
/** Pre-built lookup: lowercased execName → { name, category } */
let execLookup: Map<string, AppMatch> | null = null;
/** Currently loaded user ID (so we rebuild when it changes) */
let loadedUserId: string | null = null;

// ── Per-user custom apps ──────────────────────────────────────────────

function getCustomAppsPath(userId: string): string {
  return path.join(app.getPath("userData"), `custom-apps-${userId}.json`);
}

function ensureCustomAppsFile(userId: string): string {
  const p = getCustomAppsPath(userId);
  if (!fs.existsSync(p)) {
    const defaultContent: KnownAppsData = {
      editors: [],
      devTools: [],
      browsers: [],
    };
    fs.writeFileSync(p, JSON.stringify(defaultContent, null, 2), "utf-8");
  }
  return p;
}

function loadCustomApps(userId: string): KnownAppsData {
  ensureCustomAppsFile(userId);
  try {
    const raw = fs.readFileSync(getCustomAppsPath(userId), "utf-8");
    const data = JSON.parse(raw);
    return {
      editors: Array.isArray(data.editors) ? data.editors : [],
      devTools: Array.isArray(data.devTools) ? data.devTools : [],
      browsers: Array.isArray(data.browsers) ? data.browsers : [],
    };
  } catch {
    return { editors: [], devTools: [], browsers: [] };
  }
}

/**
 * Public helper — returns the custom apps JSON for a user.
 */
export function getCustomAppsForUser(userId: string): KnownAppsData {
  return loadCustomApps(userId);
}

/**
 * Save custom apps JSON for a user.
 */
export function saveCustomAppsForUser(
  userId: string,
  data: KnownAppsData,
): void {
  ensureCustomAppsFile(userId);
  fs.writeFileSync(
    getCustomAppsPath(userId),
    JSON.stringify(data, null, 2),
    "utf-8",
  );
  // Rebuild the exec lookup so the new entries take effect immediately
  resetEditorCache();
}

/**
 * Open the user's custom-apps JSON in the system editor.
 */
export function getCustomAppsFilePath(userId: string): string {
  return ensureCustomAppsFile(userId);
}

// ── Built-in known apps ────────────────────────────────────────────────

function loadKnownAppsData(): KnownAppsData {
  if (cachedData) return cachedData;

  const jsonPath = path.join(app.getAppPath(), "assets", "known_editors.json");
  try {
    const raw = fs.readFileSync(jsonPath, "utf-8");
    cachedData = JSON.parse(raw);
    return cachedData!;
  } catch {
    cachedData = { editors: [], devTools: [], browsers: [] };
    return cachedData;
  }
}

function buildExecLookup(userId?: string): Map<string, AppMatch> {
  if (execLookup && userId === loadedUserId) return execLookup;

  const data = loadKnownAppsData();
  execLookup = new Map();

  const addEntries = (entries: AppEntry[], category: AppCategory) => {
    for (const entry of entries) {
      for (const exec of entry.execNames) {
        // Store lowercased for fast exact-match lookup
        execLookup!.set(exec.toLowerCase(), {
          name: entry.name,
          category,
        });
      }
    }
  };

  // Built-in entries first
  addEntries(data.editors, "editor");
  addEntries(data.devTools, "devTool");
  addEntries(data.browsers, "browser");

  // Merge per-user custom entries (these override built-ins on conflict)
  if (userId) {
    const custom = loadCustomApps(userId);
    addEntries(custom.editors, "editor");
    addEntries(custom.devTools, "devTool");
    addEntries(custom.browsers, "browser");
    loadedUserId = userId;
  }

  return execLookup;
}

/** Set / update the user whose custom apps are merged into the lookup. */
export function setCustomAppsUser(userId: string | null): void {
  if (userId !== loadedUserId) {
    resetEditorCache();
    loadedUserId = userId;
  }
}

/**
 * Look up an application by its executable name (exact match).
 * Returns the app info and its category, or null if unrecognized.
 */
export function matchApp(execName: string, userId?: string): AppMatch | null {
  if (!execName) return null;
  const lookup = buildExecLookup(userId);
  return lookup.get(execName.toLowerCase()) || null;
}

/**
 * Legacy compatibility wrapper.
 * Returns an Editor-like object if the execName matches an editor.
 */
export function getEditorByExecutable(
  execName: string,
): { name: string } | undefined {
  const match = matchApp(execName);
  if (!match) return undefined;
  // For backward compat, only return editors (other categories handled by trackActiveWindow)
  if (match.category === "editor") {
    return { name: match.name };
  }
  return undefined;
}

/**
 * Reset cached data — useful if the user edits known_editors.json at runtime
 * or when custom apps change.
 */
export function resetEditorCache() {
  cachedData = null;
  execLookup = null;
}
