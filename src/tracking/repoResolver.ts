/**
 * Resolves a workspace hint (workspaceHints.ts) to the git repository it
 * belongs to. Everything stays on this machine: it reads the editors' own
 * state files and the repo's .git/config, never runs git, and caches results
 * because it is called every few seconds.
 *
 * Filesystem access is injected so tests can use a fake tree.
 */
import * as nodePath from "path";
import type { WorkspaceHint, VsCodeFlavor } from "./workspaceHints";

export interface RepoInfo {
  /**
   * Stable identity: the normalized origin remote ("github.com/owner/repo"),
   * so the same repo matches on every machine, or "path:<root>" without one.
   */
  key: string;
  /** Folder name of the repo root, for display */
  name: string;
  /** Absolute path of the repo root on this machine */
  root: string;
}

export interface ResolverFs {
  /** File contents, or null if it can't be read */
  readText(path: string): string | null;
  isDir(path: string): boolean;
  exists(path: string): boolean;
  /** Entry names, or [] if the folder can't be read */
  listDir(path: string): string[];
}

export interface ResolverOptions {
  fs: ResolverFs;
  /** Electron's app.getPath("appData") */
  appDataDir: string;
  homeDir: string;
  platform: NodeJS.Platform;
  now?: () => number;
}

/** How long a resolved hint (or an editor's folder list) is reused. */
const HIT_TTL_MS = 60_000;
const MISS_TTL_MS = 15_000;
const INDEX_TTL_MS = 30_000;
const MAX_CACHE = 200;

type VsEntry =
  { kind: "folder"; path: string } | { kind: "workspace"; configPath: string };

interface VsIndex {
  /** Windows open now (hot-exit backups, last active window) */
  open: VsEntry[];
  /** Every folder/workspace ever opened with this profile */
  recent: VsEntry[];
}

/** Normalize a git remote URL to "host/owner/repo"; null for local remotes. */
export function normalizeRemote(url: string): string | null {
  const u = url.trim();
  let host: string;
  let path: string;
  const scp = u.match(/^[\w.-]+@([^:/\s]+):(?!\/)(.+)$/);
  if (scp) {
    host = scp[1];
    path = scp[2];
  } else {
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      return null;
    }
    if (!/^(https?|ssh|git|git\+ssh):$/.test(parsed.protocol)) return null;
    host = parsed.hostname;
    path = parsed.pathname;
  }
  path = path
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  if (!host || !path) return null;
  return `${host}/${path}`.toLowerCase();
}

/** Remotes from a git config file: origin if present, else the first one. */
export function parseRemoteUrl(config: string): string | null {
  const remotes: Array<[string, string]> = [];
  let current: string | null = null;
  for (const line of config.split(/\r?\n/)) {
    const section = line.match(/^\s*\[\s*remote\s+"([^"]+)"\s*\]/);
    if (section) {
      current = section[1];
      continue;
    }
    if (/^\s*\[/.test(line)) {
      current = null;
      continue;
    }
    const url = current && line.match(/^\s*url\s*=\s*(.+?)\s*$/);
    if (url) remotes.push([current as string, url[1]]);
  }
  return (
    (remotes.find(([name]) => name === "origin") ?? remotes[0])?.[1] ?? null
  );
}

/** JSON with comments and trailing commas (.code-workspace files). */
export function parseJsonc(text: string): unknown {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) {
        if (text[i] === "\\") i++;
      }
      out += text.slice(start, i + 1);
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      if (i < 0) break;
      i++;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

export function createRepoResolver(opts: ResolverOptions) {
  const { fs, platform } = opts;
  const P = platform === "win32" ? nodePath.win32 : nodePath.posix;
  const now = opts.now ?? Date.now;
  const caseInsensitive = platform === "win32" || platform === "darwin";
  const sameName = (a: string, b: string) =>
    caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b;

  const hintCache = new Map<
    string,
    { value: RepoInfo | null; until: number }
  >();
  const rootCache = new Map<
    string,
    { value: RepoInfo | null; until: number }
  >();
  const vsIndexCache = new Map<string, { value: VsIndex; until: number }>();
  let jbCache: { value: string[]; until: number } | null = null;

  function remember<T>(
    cache: Map<string, { value: T; until: number }>,
    key: string,
    value: T,
    ttl: number,
  ): T {
    if (cache.size >= MAX_CACHE) cache.clear();
    cache.set(key, { value, until: now() + ttl });
    return value;
  }

  function fileUriToPath(uri: unknown): string | null {
    if (typeof uri !== "string" || !uri.startsWith("file:///")) return null;
    let p: string;
    try {
      p = decodeURIComponent(uri.slice("file://".length));
    } catch {
      return null;
    }
    if (platform === "win32") {
      if (!/^\/[a-zA-Z]:/.test(p)) return null;
      // VS Code writes "c:"; Windows itself says "C:"
      return p[1].toUpperCase() + p.slice(2).replace(/\//g, "\\");
    }
    return p;
  }

  // ── Git ────────────────────────────────────────────────────────────

  function repoAt(root: string): RepoInfo {
    let gitDir = P.join(root, ".git");
    if (!fs.isDir(gitDir)) {
      // Worktree or submodule: ".git" is a file pointing at the real one
      const pointer = fs.readText(gitDir)?.match(/^gitdir:\s*(.+?)\s*$/m);
      if (pointer) gitDir = P.resolve(root, pointer[1]);
      const common = fs.readText(P.join(gitDir, "commondir"))?.trim();
      if (common) gitDir = P.resolve(gitDir, common);
    }
    const config = fs.readText(P.join(gitDir, "config"));
    const remote = config ? parseRemoteUrl(config) : null;
    const normalized = remote ? normalizeRemote(remote) : null;
    const pathKey =
      platform === "win32" ? root.replace(/\\/g, "/").toLowerCase() : root;
    return {
      key: normalized ?? `path:${pathKey}`,
      name: P.basename(root),
      root,
    };
  }

  /** The repo containing `dir` (walking up to the nearest ".git"). */
  function repoForDir(dir: string): RepoInfo | null {
    const cached = rootCache.get(dir);
    if (cached && cached.until > now()) return cached.value;

    let current = P.resolve(dir);
    for (let depth = 0; depth < 64; depth++) {
      if (fs.exists(P.join(current, ".git"))) {
        return remember(rootCache, dir, repoAt(current), HIT_TTL_MS);
      }
      const parent = P.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return remember(rootCache, dir, null, MISS_TTL_MS);
  }

  // ── VS Code family ─────────────────────────────────────────────────

  function vsIndex(flavor: VsCodeFlavor): VsIndex {
    const cached = vsIndexCache.get(flavor);
    if (cached && cached.until > now()) return cached.value;

    const index: VsIndex = { open: [], recent: [] };
    const file = P.join(
      opts.appDataDir,
      flavor,
      "User",
      "globalStorage",
      "storage.json",
    );
    const text = fs.readText(file);
    let storage: any = null;
    try {
      storage = text ? JSON.parse(text) : null;
    } catch {
      storage = null;
    }

    const entry = (folderUri: unknown, configUri: unknown): VsEntry | null => {
      const folder = fileUriToPath(folderUri);
      if (folder) return { kind: "folder", path: folder };
      const config = fileUriToPath(configUri);
      return config ? { kind: "workspace", configPath: config } : null;
    };
    const push = (list: VsEntry[], e: VsEntry | null) => {
      if (e) list.push(e);
    };

    if (storage && typeof storage === "object") {
      const windows = storage.windowsState ?? {};
      for (const w of [
        windows.lastActiveWindow,
        ...(windows.openedWindows ?? []),
      ]) {
        if (w)
          push(
            index.open,
            entry(w.folder, w.workspaceIdentifier?.configURIPath),
          );
      }
      const backups = storage.backupWorkspaces ?? {};
      for (const f of backups.folders ?? [])
        push(index.open, entry(f?.folderUri, null));
      for (const w of backups.workspaces ?? [])
        push(index.open, entry(null, w?.configURIPath));
      for (const uri of Object.keys(
        storage.profileAssociations?.workspaces ?? {},
      )) {
        push(
          index.recent,
          uri.endsWith(".code-workspace") || uri.endsWith("/workspace.json")
            ? entry(null, uri)
            : entry(uri, null),
        );
      }
    }
    return remember(vsIndexCache, flavor, index, INDEX_TTL_MS);
  }

  /** "Untitled" for VS Code's own Workspaces/<id>/workspace.json. */
  function workspaceName(configPath: string): string {
    const base = P.basename(configPath);
    if (base === "workspace.json") return "Untitled";
    return base.replace(/\.code-workspace$/, "");
  }

  function workspaceFolders(configPath: string): string[] {
    const text = fs.readText(configPath);
    if (!text) return [];
    let data: any;
    try {
      data = parseJsonc(text);
    } catch {
      return [];
    }
    const dir = P.dirname(configPath);
    const folders: string[] = [];
    for (const f of Array.isArray(data?.folders) ? data.folders : []) {
      if (typeof f?.path === "string") folders.push(P.resolve(dir, f.path));
      else {
        const p = fileUriToPath(f?.uri);
        if (p) folders.push(p);
      }
    }
    return folders;
  }

  function entryMatches(
    e: VsEntry,
    name: string,
    isWorkspace: boolean,
  ): boolean {
    return e.kind === "workspace"
      ? isWorkspace && sameName(workspaceName(e.configPath), name)
      : !isWorkspace && sameName(P.basename(e.path), name);
  }

  /** First folder of the entry that is inside a git repo. */
  function repoForEntry(e: VsEntry): RepoInfo | null {
    const dirs =
      e.kind === "folder" ? [e.path] : workspaceFolders(e.configPath);
    for (const d of dirs) {
      const repo = repoForDir(d);
      if (repo) return repo;
    }
    return null;
  }

  function resolveVsCode(
    hint: Extract<WorkspaceHint, { kind: "vscode" }>,
  ): RepoInfo | null {
    const index = vsIndex(hint.flavor);
    for (const { name, isWorkspace } of hint.names) {
      for (const e of index.open) {
        if (!entryMatches(e, name, isWorkspace)) continue;
        const repo = repoForEntry(e);
        if (repo) return repo;
      }
      // History only: give up if two different repos share the name
      const found = new Map<string, RepoInfo>();
      for (const e of index.recent) {
        if (!entryMatches(e, name, isWorkspace)) continue;
        const repo = repoForEntry(e);
        if (repo) found.set(repo.key, repo);
      }
      if (found.size === 1) return [...found.values()][0];
      if (found.size > 1) return null;
    }
    return null;
  }

  // ── JetBrains ──────────────────────────────────────────────────────

  function jetbrainsProjects(): string[] {
    if (jbCache && jbCache.until > now()) return jbCache.value;
    const paths: string[] = [];
    for (const vendor of ["JetBrains", "Google"]) {
      const base = P.join(opts.appDataDir, vendor);
      for (const product of fs.listDir(base)) {
        const xml = fs.readText(
          P.join(base, product, "options", "recentProjects.xml"),
        );
        if (!xml) continue;
        for (const m of xml.matchAll(/<entry key="([^"]+)"/g)) {
          paths.push(P.normalize(m[1].replace("$USER_HOME$", opts.homeDir)));
        }
      }
    }
    jbCache = { value: paths, until: now() + INDEX_TTL_MS };
    return paths;
  }

  function resolveJetBrains(name: string): RepoInfo | null {
    const found = new Map<string, RepoInfo>();
    for (const p of jetbrainsProjects()) {
      if (!sameName(P.basename(p), name)) continue;
      const repo = repoForDir(p);
      if (repo) found.set(repo.key, repo);
    }
    return found.size === 1 ? [...found.values()][0] : null;
  }

  // ── Paths from titles ──────────────────────────────────────────────

  /** Trim trailing title text until what's left is an existing folder. */
  function existingDir(raw: string): string | null {
    let p = raw.trim();
    if (p.startsWith("~")) p = P.join(opts.homeDir, p.slice(1));
    for (let i = 0; i < 32 && p; i++) {
      if (fs.isDir(p)) return p;
      const cut = Math.max(
        p.lastIndexOf(" "),
        p.lastIndexOf(P.sep),
        p.lastIndexOf("/"),
      );
      if (cut <= 0) return null;
      p = p.slice(0, cut).trimEnd();
    }
    return null;
  }

  function resolveUncached(hint: WorkspaceHint): RepoInfo | null {
    switch (hint.kind) {
      case "vscode":
        return resolveVsCode(hint);
      case "jetbrains":
        return resolveJetBrains(hint.name);
      case "path": {
        const dir = existingDir(hint.path);
        return dir ? repoForDir(dir) : null;
      }
    }
  }

  return function resolve(hint: WorkspaceHint | null): RepoInfo | null {
    if (!hint) return null;
    const key = JSON.stringify(hint);
    const cached = hintCache.get(key);
    if (cached && cached.until > now()) return cached.value;
    let value: RepoInfo | null = null;
    try {
      value = resolveUncached(hint);
    } catch {
      value = null;
    }
    return remember(hintCache, key, value, value ? HIT_TTL_MS : MISS_TTL_MS);
  };
}
