/**
 * The user's own browser categories (C5): userData/browser-categories-<uid>.json,
 * edited by hand like lang.json and custom-apps.json. Read again whenever
 * the file changes, so edits apply on the next sample.
 */
import { app } from "electron";
import fs from "fs";
import path from "path";
import {
  NO_CUSTOM_RULES,
  parseCustomBrowserRules,
  type CustomBrowserRules,
} from "../../shared/browserCategories";

export const BROWSER_RULES_TEMPLATE = `{
  "titles": {},
  "hosts": {}
}
`;

export function browserRulesPath(userId: string): string {
  return path.join(app.getPath("userData"), `browser-categories-${userId}.json`);
}

let cached: { userId: string; mtimeMs: number; rules: CustomBrowserRules } | null = null;

/** The user's rules; none while the file is missing or isn't valid JSON. */
export function customBrowserRules(userId: string): CustomBrowserRules {
  let mtimeMs: number;
  const file = browserRulesPath(userId);
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return NO_CUSTOM_RULES;
  }
  if (cached && cached.userId === userId && cached.mtimeMs === mtimeMs) {
    return cached.rules;
  }
  let rules = NO_CUSTOM_RULES;
  try {
    rules = parseCustomBrowserRules(JSON.parse(fs.readFileSync(file, "utf-8")));
  } catch {
    // Mid-edit or broken: no rules until it parses again
  }
  cached = { userId, mtimeMs, rules };
  return rules;
}
