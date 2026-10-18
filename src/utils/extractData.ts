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

interface ExtensionIndex {
  /** Lowercased extension → the extension and its rank (longest first) */
  byLower: Map<string, { ext: string; rank: number }>;
  maxLength: number;
  /** Extension → name of the first linguist language that lists it */
  language: Map<string, string>;
}

/**
 * All linguist file extensions, indexed once (they all start with "."). The
 * rank orders them longest-first so ".config.ts" beats ".ts" or ".fig".
 */
let extensionIndex: ExtensionIndex | null = null;
function getExtensionIndex(): ExtensionIndex {
  if (extensionIndex) return extensionIndex;
  const language = new Map<string, string>();
  for (const lang of Object.values(linguistLanguages)) {
    if (
      lang &&
      typeof lang === "object" &&
      "extensions" in lang &&
      Array.isArray((lang as any).extensions)
    ) {
      for (const ext of (lang as any).extensions as string[]) {
        if (!language.has(ext)) language.set(ext, (lang as any).name);
      }
    }
  }
  const sorted = [...language.keys()].sort((a, b) => b.length - a.length);
  const byLower = new Map<string, { ext: string; rank: number }>();
  sorted.forEach((ext, rank) => {
    const key = ext.toLowerCase();
    if (!byLower.has(key)) byLower.set(key, { ext, rank });
  });
  extensionIndex = {
    byLower,
    maxLength: sorted[0]?.length ?? 0,
    language,
  };
  return extensionIndex;
}

const WORD_CHAR = /\w/;

/**
 * The longest known extension in the title (case-insensitive). It must be
 * preceded by a word char, path separator or the start, and followed by a
 * non-word char or the end — avoids false positives like ".14" in
 * "Build: 3.14 errors". Only substrings starting at a "." are looked up,
 * so this costs a few map lookups per dot instead of a regex per extension.
 */
function findExtension(title: string): string | null {
  const { byLower, maxLength } = getExtensionIndex();
  let best: { ext: string; rank: number } | null = null;
  for (let i = title.indexOf("."); i !== -1; i = title.indexOf(".", i + 1)) {
    if (i > 0 && !WORD_CHAR.test(title[i - 1]) && title[i - 1] !== "/" && title[i - 1] !== "\\") {
      continue;
    }
    const last = Math.min(title.length, i + maxLength);
    for (let j = i + 2; j <= last; j++) {
      if (j < title.length && WORD_CHAR.test(title[j])) continue;
      const hit = byLower.get(title.slice(i, j).toLowerCase());
      if (hit && (!best || hit.rank < best.rank)) best = hit;
    }
  }
  return best?.ext ?? null;
}

export function getLanguageDataFromTitle(title: string) {
  const foundExt = findExtension(title);
  if (!foundExt) return null;

  if (userLangMap[foundExt]) {
    return {
      language: userLangMap[foundExt],
      extension: foundExt,
    };
  }

  const name =
    preferredExtensionMap[foundExt] ?? getExtensionIndex().language.get(foundExt);
  return {
    // An extension with no language falls back to the extension itself
    language: name ?? foundExt,
    extension: foundExt,
  };
}

// getLangIconUrl moved to src/utils/langIconUrl.ts (renderer-safe)
export { getLangIconUrl } from "./langIconUrl";
