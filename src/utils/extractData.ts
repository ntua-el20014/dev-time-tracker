import linguistLanguages from 'linguist-languages';

const preferredExtensionMap: Record<string, string> = {
  '.md': 'Markdown',
  '.sql': 'SQL',
  '.html': 'HTML',
  '.txt': 'Text',
};

/**
 * Extracts the programming language from a window title using known file extensions.
 * @param title The window title string (e.g. "logger.ts - dev-time-tracker - Visual Studio Code")
 * @returns { language: string } | null
 */
export function getLanguageDataFromTitle(title: string) {
  // Gather all known extensions from linguist-languages
  const allExts = new Set<string>();
  for (const lang of Object.values(linguistLanguages)) {
    if (Array.isArray(lang.extensions)) {
      lang.extensions.forEach(ext => allExts.add(ext));
    }
  }

  // Find the first extension match in the title
  let foundExt: string | null = null;
  for (const ext of allExts) {
    // Escape special regex characters in the extension
    const escapedExt = ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escapedExt}(\\W|$)`, 'i');
    if (regex.test(title)) {
      foundExt = ext;
      break;
    }
  }

  if (!foundExt) return null;

  let lang;
  if (preferredExtensionMap[foundExt]) {
    lang = Object.values(linguistLanguages).find(
      l => l.name === preferredExtensionMap[foundExt]
    );
  } else {
    lang = Object.values(linguistLanguages).find(
      l => Array.isArray(l.extensions) && l.extensions.includes(foundExt)
    );
  }

  if (!lang) return null;

  return {
    language: lang.name,
  };

}