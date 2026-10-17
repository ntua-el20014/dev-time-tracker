/**
 * Turns the current foreground window into a usage sample.
 * Dependencies are injected so this runs in tests without x-win or Electron.
 */
import type { AppMatch } from "../utils/editors";
import { classifyBrowserPage, type BrowserCategory } from "../../shared/browserCategories";

/**
 * A browser whose URL came back empty this many times in a row, never
 * non-empty, isn't asked again this run (x-win doesn't read every browser,
 * and each try blocks for tens of milliseconds).
 */
export const URL_GIVE_UP_AFTER = 5;

export interface ForegroundWindow {
  /** Executable name, e.g. "code.exe" */
  execName: string;
  title: string;
  /** Icon as a data URL; may throw */
  getIconData(): string;
  /** Browser URL ("" if unknown); slow-ish, may throw */
  getUrl?(): string;
}

export interface UsageSample {
  appName: string;
  windowTitle: string;
  language: string | null;
  languageExtension: string | null;
  /** App icon data URL ("" if unavailable) */
  icon: string;
  /** Browsers: what the page was for (C5), null if unknown */
  category: BrowserCategory | null;
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
  /** Per browser executable: empty URL reads so far, or -1 once one worked */
  const urlMisses = new Map<string, number>();

  function readUrl(win: ForegroundWindow, execName: string): string | null {
    const misses = urlMisses.get(execName) ?? 0;
    if (!win.getUrl || misses >= URL_GIVE_UP_AFTER) return null;
    let url = "";
    try {
      url = win.getUrl() || "";
    } catch {
      url = "";
    }
    if (url) urlMisses.set(execName, -1);
    else if (misses >= 0) urlMisses.set(execName, misses + 1);
    return url || null;
  }

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
      category:
        app.category === "browser"
          ? classifyBrowserPage(title, () => readUrl(win, execName))
          : null,
    };
  };
}
