import * as linguistLanguages from "linguist-languages";
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";

const preferredExtensionMap: Record<string, string> = {
  ".md": "Markdown",
  ".sql": "SQL",
  ".html": "HTML",
  ".txt": "Text",
};

let userLangMap: Record<string, string> = {};

/**
 * Load the user's custom language map from disk (main-process safe).
 * Call this whenever the authenticated user changes, or periodically.
 */
export function loadUserLangMapFromDisk(userId: string) {
  if (!userId) return;
  const langPath = path.join(app.getPath("userData"), `lang-${userId}.json`);
  try {
    if (fs.existsSync(langPath)) {
      const raw = fs.readFileSync(langPath, "utf-8");
      userLangMap = JSON.parse(raw) || {};
    }
  } catch {
    userLangMap = {};
  }
}

/**
 * Build a sorted array of all known file extensions from linguist-languages.
 * Sorted longest-first so ".config.ts" beats ".ts" or ".fig".
 * Cached after first call.
 */
let sortedExtsCache: string[] | null = null;
function getSortedExtensions(): string[] {
  if (sortedExtsCache) return sortedExtsCache;
  const allExts = new Set<string>();
  for (const lang of Object.values(linguistLanguages)) {
    if (Array.isArray(lang.extensions)) {
      lang.extensions.forEach((ext) => allExts.add(ext));
    }
  }
  // Sort longest-first so multi-part extensions match before shorter ones
  sortedExtsCache = [...allExts].sort((a, b) => b.length - a.length);
  return sortedExtsCache;
}

export function getLanguageDataFromTitle(title: string) {
  const sortedExts = getSortedExtensions();

  // Find the first (longest) extension that appears in the title.
  // Require the extension to be preceded by a word char, path separator, or SOL,
  // and followed by a non-word char or EOL — avoids false positives like ".14" in
  // "Build: 3.14 errors".
  let foundExt: string | null = null;
  for (const ext of sortedExts) {
    const escapedExt = ext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?:^|[\\w/\\\\])${escapedExt}(?:\\W|$)`, "i");
    if (regex.test(title)) {
      foundExt = ext;
      break;
    }
  }

  if (!foundExt) return null;

  if (userLangMap[foundExt]) {
    return {
      language: userLangMap[foundExt],
      extension: foundExt,
    };
  }

  let lang;
  if (preferredExtensionMap[foundExt]) {
    lang = Object.values(linguistLanguages).find(
      (l) => l.name === preferredExtensionMap[foundExt],
    );
  } else {
    lang = Object.values(linguistLanguages).find(
      (l) => Array.isArray(l.extensions) && l.extensions.includes(foundExt),
    );
  }

  if (!lang) {
    // Instead of returning 'Unknown', return the extension itself as the language
    return {
      language: foundExt, // e.g. '.foo'
      extension: foundExt,
    };
  }

  return {
    language: lang.name,
    extension: foundExt,
  };
}

// getLangIconUrl moved to src/utils/langIconUrl.ts (renderer-safe)
export { getLangIconUrl } from "./langIconUrl";
