/**
 * Pure: what a window title says about the folder being worked in.
 *
 * Editors only put the folder *name* in their title, so a hint is resolved
 * to a path later (repoResolver.ts) using the editor's own list of open and
 * recent folders. Terminals often show a full path, which is used as is.
 */

/** VS Code-family editors, by their user-data folder under appData. */
export type VsCodeFlavor =
  "Code" | "Code - Insiders" | "Cursor" | "Windsurf" | "VSCodium";

export type WorkspaceHint =
  | {
      kind: "vscode";
      flavor: VsCodeFlavor;
      /**
       * Folder (or multi-root workspace) name candidates, most likely first:
       * the last title segment, then the one before it, for when a
       * non-default profile adds its name.
       */
      names: Array<{ name: string; isWorkspace: boolean }>;
    }
  | { kind: "jetbrains"; name: string }
  | { kind: "path"; path: string };

const VSCODE_FLAVORS: Array<[RegExp, VsCodeFlavor, string]> = [
  [
    /^code(?: - |-| )insiders(\.exe)?$/,
    "Code - Insiders",
    "Visual Studio Code - Insiders",
  ],
  [/^code(\.exe)?$/, "Code", "Visual Studio Code"],
  [/^cursor(\.exe)?$/, "Cursor", "Cursor"],
  [/^windsurf(\.exe)?$/, "Windsurf", "Windsurf"],
  [/^(vs)?codium(\.exe)?$/, "VSCodium", "VSCodium"],
];

const JETBRAINS_EXEC =
  /^(idea|pycharm|webstorm|phpstorm|goland|clion|rider|rubymine|rustrover|datagrip|dataspell|aqua|studio)(64)?(\.exe|\.sh)?$/;

const ABSOLUTE_PATH = /^([a-zA-Z]:[\\/]|\/|~\/)/;

/** Remote windows: the folder isn't on this machine. */
const REMOTE_SUFFIX =
  /\s*\[(WSL|SSH|Dev Container|Codespaces|Container|Tunnel)[^\]]*\]\s*$/i;

function vscodeHint(
  title: string,
  flavor: VsCodeFlavor,
  appTitle: string,
): WorkspaceHint | null {
  // Separators: " - " (Windows/Linux) or " — " (macOS)
  let rest = title.replace(/^\[Extension Development Host\]\s*/, "");
  const suffix = rest.match(
    new RegExp(`\\s([-—])\\s${appTitle.replace(/[-]/g, "\\-")}$`),
  );
  if (!suffix) return null;
  rest = rest.slice(0, suffix.index);

  // ${activeEditorShort} - ${rootName}[ - ${profileName}], split on the
  // separator this title uses, so "a - b.ts — repo" keeps the file name
  const parts = rest
    .split(` ${suffix[1]} `)
    .map((p) => p.replace(/^●\s*/, "").trim())
    .filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last || REMOTE_SUFFIX.test(last)) return null;

  // A custom window.title may show the full path
  if (ABSOLUTE_PATH.test(last)) return { kind: "path", path: last };

  const names = parts
    .slice(-2)
    .reverse()
    .map((n) => {
      const isWorkspace = / \(Workspace\)$/.test(n);
      return { name: n.replace(/ \(Workspace\)$/, ""), isWorkspace };
    });
  return { kind: "vscode", flavor, names };
}

function jetbrainsHint(title: string): WorkspaceHint | null {
  // "project – file.ts" or, older, "project [~/path] – …/file.ts"
  const first = title.split(/\s[–-]\s/)[0]?.trim();
  if (!first) return null;
  const bracket = first.match(/\[([^\]]+)\]\s*$/);
  if (bracket && ABSOLUTE_PATH.test(bracket[1])) {
    return { kind: "path", path: bracket[1] };
  }
  const name = first.replace(/\s*\[[^\]]*\]\s*$/, "");
  return name ? { kind: "jetbrains", name } : null;
}

/**
 * An absolute path somewhere in a title — "PS C:\code\repo>",
 * "MINGW64:/c/code/repo", "user@host: ~/code/repo". It may carry trailing
 * text; the resolver trims it to the longest existing folder.
 */
export function findPathInTitle(title: string): string | null {
  const mingw = title.match(/(?:^|[\s:])\/([a-zA-Z])(\/[^\s:*?"<>|]*)/);
  if (mingw && /MINGW|MSYS|CYGWIN/i.test(title)) {
    return `${mingw[1].toUpperCase()}:${mingw[2].replace(/\//g, "\\")}`;
  }
  const win = title.match(/[a-zA-Z]:\\[^:*?"<>|\r\n]*/);
  if (win) return win[0].replace(/[>\s]+$/, "");
  const unix = title.match(
    /(?:^|[\s:])((?:~|\/(?:home|Users|mnt|srv|opt|var|tmp|workspaces?))\/[^\s:*?"<>|]*)/,
  );
  if (unix) return unix[1];
  return null;
}

/**
 * Hint for the focused window. `category` is the known-app category;
 * browsers are skipped because page titles are arbitrary text.
 */
export function getWorkspaceHint(
  execName: string,
  title: string,
  category: string,
): WorkspaceHint | null {
  if (!title || category === "browser") return null;
  const exec = execName.toLowerCase();

  for (const [re, flavor, appTitle] of VSCODE_FLAVORS) {
    if (re.test(exec)) return vscodeHint(title, flavor, appTitle);
  }
  if (JETBRAINS_EXEC.test(exec)) return jetbrainsHint(title);

  const path = findPathInTitle(title);
  return path ? { kind: "path", path } : null;
}
