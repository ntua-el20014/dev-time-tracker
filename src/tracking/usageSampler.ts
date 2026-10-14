/**
 * Turns the current foreground window into a usage sample.
 * Dependencies are injected so this runs in tests without x-win or Electron.
 */
import type { AppMatch } from "../utils/editors";

export interface ForegroundWindow {
  /** Executable name, e.g. "code.exe" */
  execName: string;
  title: string;
  /** Icon as a data URL; may throw */
  getIconData(): string;
}

export interface UsageSample {
  appName: string;
  windowTitle: string;
  language: string | null;
  languageExtension: string | null;
  /** App icon data URL ("" if unavailable) */
  icon: string;
}

export interface SamplerDeps {
  getForegroundWindow(): ForegroundWindow | null;
  matchApp(execName: string, userId: string): AppMatch | null;
  getLanguageFromTitle(
    title: string,
  ): { language: string; extension: string } | null;
}

export function createUsageSampler(deps: SamplerDeps) {
  /** Icons don't change at runtime — fetch once per executable. */
  const iconCache = new Map<string, string>();

  return function sample(userId: string): UsageSample | null {
    const win = deps.getForegroundWindow();
    const execName = win?.execName?.toLowerCase() || "";
    if (!win || !execName) return null;

    // Only editors, dev tools and browsers are tracked
    const app = deps.matchApp(execName, userId);
    if (!app) return null;

    let icon = iconCache.get(execName);
    if (icon === undefined) {
      try {
        icon = win.getIconData() || "";
      } catch {
        icon = "";
      }
      iconCache.set(execName, icon);
    }

    const title = win.title || "";
    const lang = deps.getLanguageFromTitle(title);
    return {
      appName: app.name,
      windowTitle: title,
      language: lang?.language || (app.category === "editor" ? "Unknown" : null),
      languageExtension: lang?.extension || null,
      icon,
    };
  };
}
