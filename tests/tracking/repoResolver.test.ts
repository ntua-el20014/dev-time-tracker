import { describe, it, expect, vi } from "vitest";
import * as nodePath from "path";
import {
  createRepoResolver,
  normalizeRemote,
  parseRemoteUrl,
  parseJsonc,
  type ResolverFs,
} from "../../src/tracking/repoResolver";

const P = nodePath.win32;
const APPDATA = "C:\\Users\\me\\AppData\\Roaming";
const HOME = "C:\\Users\\me";

/** A fake Windows tree: every parent of a file or folder exists as a folder. */
function fakeFs(files: Record<string, string>, folders: string[] = []): ResolverFs & {
  readText: ReturnType<typeof vi.fn>;
} {
  const dirs = new Set<string>();
  const addDir = (d: string) => {
    for (let cur = d; ; cur = P.dirname(cur)) {
      dirs.add(cur);
      if (P.dirname(cur) === cur) break;
    }
  };
  for (const f of Object.keys(files)) addDir(P.dirname(f));
  for (const d of folders) addDir(d);
  return {
    readText: vi.fn((p: string) => files[p] ?? null),
    isDir: (p) => dirs.has(p),
    exists: (p) => dirs.has(p) || p in files,
    listDir: (p) =>
      [...new Set([...dirs, ...Object.keys(files)])]
        .filter((x) => P.dirname(x) === p && x !== p)
        .map((x) => P.basename(x)),
  };
}

const gitConfig = (url?: string) =>
  `[core]\n\tbare = false\n${url ? `[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n` : ""}[branch "main"]\n\tremote = origin\n`;

const storage = (data: object) => ({
  [P.join(APPDATA, "Code", "User", "globalStorage", "storage.json")]: JSON.stringify(data),
});

const uri = (p: string) => "file:///" + p.replace(/\\/g, "/").replace(/^C:/, "c%3A");

function resolver(fs: ResolverFs, now = () => 0) {
  return createRepoResolver({ fs, appDataDir: APPDATA, homeDir: HOME, platform: "win32", now });
}

describe("normalizeRemote", () => {
  it("normalizes ssh, scp-style and https remotes to host/owner/repo", () => {
    expect(normalizeRemote("git@github.com:Owner/Repo.git")).toBe("github.com/owner/repo");
    expect(normalizeRemote("https://user@github.com/Owner/Repo.git")).toBe("github.com/owner/repo");
    expect(normalizeRemote("https://github.com/owner/repo/")).toBe("github.com/owner/repo");
    expect(normalizeRemote("ssh://git@gitlab.com:2222/group/sub/repo.git")).toBe(
      "gitlab.com/group/sub/repo",
    );
  });

  it("ignores local remotes", () => {
    expect(normalizeRemote("C:/repos/x")).toBeNull();
    expect(normalizeRemote("/srv/git/x.git")).toBeNull();
    expect(normalizeRemote("file:///srv/git/x.git")).toBeNull();
  });
});

describe("parseRemoteUrl", () => {
  it("prefers origin, else the first remote", () => {
    expect(parseRemoteUrl(gitConfig("git@github.com:a/b.git"))).toBe("git@github.com:a/b.git");
    const two = `[remote "upstream"]\n\turl = https://x.com/u/r\n[remote "origin"]\n\turl = https://x.com/o/r\n`;
    expect(parseRemoteUrl(two)).toBe("https://x.com/o/r");
    expect(parseRemoteUrl(`[remote "fork"]\n url = https://x.com/f/r\n`)).toBe("https://x.com/f/r");
    expect(parseRemoteUrl(gitConfig())).toBeNull();
  });
});

describe("parseJsonc", () => {
  it("allows comments and trailing commas but keeps // inside strings", () => {
    const text = `{
      // folders
      "folders": [{ "path": "../repo" }, /* second */ { "uri": "file:///c%3A/x" },],
    }`;
    expect(parseJsonc(text)).toEqual({ folders: [{ path: "../repo" }, { uri: "file:///c%3A/x" }] });
  });
});

describe("createRepoResolver", () => {
  const REPO = "C:\\code\\shop";

  it("resolves a VS Code folder name through the open windows", () => {
    const fs = fakeFs({
      ...storage({ backupWorkspaces: { folders: [{ folderUri: uri(REPO) }] } }),
      [P.join(REPO, ".git", "config")]: gitConfig("git@github.com:acme/shop.git"),
    }, [P.join(REPO, ".git")]);
    const resolve = resolver(fs);
    expect(
      resolve({ kind: "vscode", flavor: "Code", names: [{ name: "shop", isWorkspace: false }] }),
    ).toEqual({ key: "github.com/acme/shop", name: "shop", root: REPO });
  });

  it("walks up from a subfolder to the repo root", () => {
    const sub = P.join(REPO, "packages", "web");
    const fs = fakeFs({
      ...storage({ windowsState: { lastActiveWindow: { folder: uri(sub) } } }),
      [P.join(REPO, ".git", "config")]: gitConfig(),
    }, [sub, P.join(REPO, ".git")]);
    expect(
      resolver(fs)({ kind: "vscode", flavor: "Code", names: [{ name: "web", isWorkspace: false }] }),
    ).toEqual({ key: "path:c:/code/shop", name: "shop", root: REPO });
  });

  it("resolves an untitled multi-root workspace via its workspace.json", () => {
    const ws = P.join(APPDATA, "Code", "Workspaces", "123", "workspace.json");
    const fs = fakeFs({
      ...storage({ backupWorkspaces: { workspaces: [{ configURIPath: uri(ws) }] } }),
      [ws]: `{ "folders": [ { "path": "../../../../../../../code/notes" }, { "path": "../../../../../../../code/shop" } ], }`,
      [P.join(REPO, ".git", "config")]: gitConfig("https://github.com/acme/shop"),
    }, ["C:\\code\\notes", P.join(REPO, ".git")]);
    expect(
      resolver(fs)({
        kind: "vscode",
        flavor: "Code",
        names: [
          { name: "Untitled", isWorkspace: true },
          { name: "notes.md", isWorkspace: false },
        ],
      }),
    ).toMatchObject({ key: "github.com/acme/shop", root: REPO });
  });

  it("uses history only when the name is unambiguous", () => {
    const a = "C:\\clients\\a\\api";
    const b = "C:\\clients\\b\\api";
    const files = {
      [P.join(a, ".git", "config")]: gitConfig("git@github.com:a/api.git"),
      [P.join(b, ".git", "config")]: gitConfig("git@github.com:b/api.git"),
    };
    const hint = { kind: "vscode" as const, flavor: "Code" as const, names: [{ name: "api", isWorkspace: false }] };
    const both = fakeFs({
      ...files,
      ...storage({ profileAssociations: { workspaces: { [uri(a)]: "x", [uri(b)]: "x" } } }),
    }, [P.join(a, ".git"), P.join(b, ".git")]);
    expect(resolver(both)(hint)).toBeNull();

    const openB = fakeFs({
      ...files,
      ...storage({
        profileAssociations: { workspaces: { [uri(a)]: "x", [uri(b)]: "x" } },
        backupWorkspaces: { folders: [{ folderUri: uri(b) }] },
      }),
    }, [P.join(a, ".git"), P.join(b, ".git")]);
    expect(resolver(openB)(hint)?.key).toBe("github.com/b/api");
  });

  it("follows worktree .git files to the main repo's config", () => {
    const wt = "C:\\code\\shop-feature";
    const fs = fakeFs({
      ...storage({ backupWorkspaces: { folders: [{ folderUri: uri(wt) }] } }),
      [P.join(wt, ".git")]: "gitdir: C:\\code\\shop\\.git\\worktrees\\feature\n",
      [P.join(REPO, ".git", "worktrees", "feature", "commondir")]: "../..\n",
      [P.join(REPO, ".git", "config")]: gitConfig("git@github.com:acme/shop.git"),
    });
    expect(
      resolver(fs)({ kind: "vscode", flavor: "Code", names: [{ name: "shop-feature", isWorkspace: false }] }),
    ).toEqual({ key: "github.com/acme/shop", name: "shop-feature", root: wt });
  });

  it("trims trailing title text off a path", () => {
    const fs = fakeFs({ [P.join(REPO, ".git", "config")]: gitConfig() }, [
      P.join(REPO, "src"),
      P.join(REPO, ".git"),
    ]);
    expect(resolver(fs)({ kind: "path", path: "C:\\code\\shop\\src - PowerShell 7" })?.root).toBe(REPO);
  });

  it("expands ~ in paths", () => {
    const repo = P.join(HOME, "code", "dots");
    const fs = fakeFs({ [P.join(repo, ".git", "config")]: gitConfig() }, [P.join(repo, ".git")]);
    expect(resolver(fs)({ kind: "path", path: "~\\code\\dots" })?.root).toBe(repo);
  });

  it("finds JetBrains projects in recentProjects.xml", () => {
    const xml = `<application><component name="RecentProjectsManager"><option name="additionalInfo"><map>
      <entry key="$USER_HOME$/IdeaProjects/shop-api"><value/></entry>
    </map></option></component></application>`;
    const repo = P.join(HOME, "IdeaProjects", "shop-api");
    const fs = fakeFs({
      [P.join(APPDATA, "JetBrains", "IntelliJIdea2024.2", "options", "recentProjects.xml")]: xml,
      [P.join(repo, ".git", "config")]: gitConfig("git@github.com:acme/shop-api.git"),
    }, [P.join(repo, ".git")]);
    expect(resolver(fs)({ kind: "jetbrains", name: "shop-api" })?.key).toBe("github.com/acme/shop-api");
  });

  it("returns null outside a repo and caches lookups", () => {
    let t = 0;
    const fs = fakeFs({}, ["C:\\tmp\\scratch"]);
    const resolve = resolver(fs, () => t);
    const hint = { kind: "path" as const, path: "C:\\tmp\\scratch" };
    expect(resolve(hint)).toBeNull();
    expect(resolve(null)).toBeNull();

    const fsRepo = fakeFs({
      ...storage({ backupWorkspaces: { folders: [{ folderUri: uri(REPO) }] } }),
      [P.join(REPO, ".git", "config")]: gitConfig(),
    }, [P.join(REPO, ".git")]);
    const cached = resolver(fsRepo, () => t);
    const vs = { kind: "vscode" as const, flavor: "Code" as const, names: [{ name: "shop", isWorkspace: false }] };
    cached(vs);
    const reads = fsRepo.readText.mock.calls.length;
    cached(vs);
    expect(fsRepo.readText.mock.calls.length).toBe(reads);
    t += 120_000;
    cached(vs);
    expect(fsRepo.readText.mock.calls.length).toBeGreaterThan(reads);
  });

  it("survives a corrupt storage.json", () => {
    const fs = fakeFs({ [P.join(APPDATA, "Code", "User", "globalStorage", "storage.json")]: "{nope" });
    expect(
      resolver(fs)({ kind: "vscode", flavor: "Code", names: [{ name: "x", isWorkspace: false }] }),
    ).toBeNull();
  });
});
