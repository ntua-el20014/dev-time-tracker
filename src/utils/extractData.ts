import * as linguistLanguages from "linguist-languages";
import { getIconForFile } from "vscode-icons-js";
import { ipcRenderer } from "electron";
import { getCurrentUserId } from "../../renderer/utils/userUtils";

const preferredExtensionMap: Record<string, string> = {
  ".md": "Markdown",
  ".sql": "SQL",
  ".html": "HTML",
  ".txt": "Text",
};

let userLangMap: Record<string, string> = {};

export async function loadUserLangMap() {
  userLangMap = await ipcRenderer.invoke(
    "get-user-lang-map",
    getCurrentUserId(),
  );
}

export function getLanguageDataFromTitle(title: string) {
  // Gather all known extensions from linguist-languages
  const allExts = new Set<string>();
  for (const lang of Object.values(linguistLanguages)) {
    if (Array.isArray(lang.extensions)) {
      lang.extensions.forEach((ext) => allExts.add(ext));
    }
  }

  // Find the first extension match in the title
  let foundExt: string | null = null;
  for (const ext of allExts) {
    const escapedExt = ext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`${escapedExt}(\\W|$)`, "i");
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

export function getLangIconUrl(ext?: string): string | null {
  if (!ext) return null;
  const icon = getIconForFile(ext);
  if (!icon) return null;

  // development
  if (process.env.NODE_ENV === "development") {
    return `/main_window/icons/${icon}`;
  }
  // production
  return `icons/${icon}`;
}
