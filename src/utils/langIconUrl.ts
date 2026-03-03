import { getIconForFile } from "vscode-icons-js";

/**
 * Get a VS Code-style icon URL for a given file extension.
 * Safe to use from both main and renderer processes.
 */
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
