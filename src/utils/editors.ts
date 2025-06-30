import * as fs from "fs";
import * as path from "path";
import { app } from "electron";

type Editor = {
  name: string;
  execNames: string[];
};

let cachedEditors: Editor[] | null = null;

export function loadKnownEditors(): Editor[] {
  if (cachedEditors) return cachedEditors;

  const jsonPath = path.join(app.getAppPath(), "assets", "known_editors.json");
  try {
    const raw = fs.readFileSync(jsonPath, "utf-8");
    cachedEditors = JSON.parse(raw);
    return cachedEditors || [];
  } catch (err) {
    // Silently handle error and return empty array as fallback
    // In production, we don't want to pollute logs with file read errors
    cachedEditors = [];
    return [];
  }
}

/**
 * Returns the matching editor object if execName matches, otherwise undefined.
 */
export function getEditorByExecutable(execName: string): Editor | undefined {
  const editors = loadKnownEditors();
  return editors.find((editor) =>
    editor.execNames.some((name) => execName.toLowerCase().includes(name))
  );
}
