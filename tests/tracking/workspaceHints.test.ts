import { describe, it, expect } from "vitest";
import {
  getWorkspaceHint,
  findPathInTitle,
} from "../../src/tracking/workspaceHints";

const names = (...n: Array<[string, boolean?]>) =>
  n.map(([name, isWorkspace = false]) => ({ name, isWorkspace }));

describe("getWorkspaceHint — VS Code family", () => {
  it("takes the folder from 'file - folder - Visual Studio Code'", () => {
    expect(getWorkspaceHint("Code", "main.ts - my-repo - Visual Studio Code", "editor")).toEqual({
      kind: "vscode",
      flavor: "Code",
      names: names(["my-repo"], ["main.ts"]),
    });
  });

  it("handles the macOS em dash, the dirty marker and file names with dashes", () => {
    expect(
      getWorkspaceHint("code", "● a - b.ts — my-repo — Visual Studio Code", "editor"),
    ).toEqual({ kind: "vscode", flavor: "Code", names: names(["my-repo"], ["a - b.ts"]) });
  });

  it("recognizes multi-root workspaces", () => {
    expect(
      getWorkspaceHint(
        "Code.exe",
        "Dev-time-tracker phase C - Untitled (Workspace) - Visual Studio Code",
        "editor",
      ),
    ).toEqual({
      kind: "vscode",
      flavor: "Code",
      names: names(["Untitled", true], ["Dev-time-tracker phase C"]),
    });
  });

  it("maps Insiders, Cursor and Windsurf to their own state folders", () => {
    expect(
      getWorkspaceHint("Code - Insiders", "x.ts - r - Visual Studio Code - Insiders", "editor"),
    ).toMatchObject({ flavor: "Code - Insiders", names: names(["r"], ["x.ts"]) });
    expect(getWorkspaceHint("Cursor.exe", "x.ts - r - Cursor", "editor")).toMatchObject({
      flavor: "Cursor",
    });
    expect(getWorkspaceHint("windsurf", "r - Windsurf", "editor")).toMatchObject({
      flavor: "Windsurf",
      names: names(["r"]),
    });
  });

  it("skips remote windows and non-standard titles", () => {
    expect(
      getWorkspaceHint("Code", "x.ts - repo [WSL: Ubuntu] - Visual Studio Code", "editor"),
    ).toBeNull();
    expect(getWorkspaceHint("Code", "Visual Studio Code", "editor")).toBeNull();
    expect(getWorkspaceHint("Code", "custom title", "editor")).toBeNull();
  });

  it("uses a full path when window.title shows one", () => {
    expect(
      getWorkspaceHint("Code", "x.ts - C:\\work\\repo - Visual Studio Code", "editor"),
    ).toEqual({ kind: "path", path: "C:\\work\\repo" });
  });

  it("strips the extension development host prefix", () => {
    expect(
      getWorkspaceHint("Code", "[Extension Development Host] a.ts - ext - Visual Studio Code", "editor"),
    ).toMatchObject({ names: names(["ext"], ["a.ts"]) });
  });
});

describe("getWorkspaceHint — JetBrains", () => {
  it("takes the project name before the en dash", () => {
    expect(getWorkspaceHint("idea64.exe", "shop-api – OrderService.java", "editor")).toEqual({
      kind: "jetbrains",
      name: "shop-api",
    });
    expect(getWorkspaceHint("pycharm", "ml – train.py", "editor")).toEqual({
      kind: "jetbrains",
      name: "ml",
    });
  });

  it("prefers the path in older '[path]' titles", () => {
    expect(
      getWorkspaceHint("webstorm64.exe", "site [~/code/site] – …/index.ts", "editor"),
    ).toEqual({ kind: "path", path: "~/code/site" });
  });
});

describe("getWorkspaceHint — other apps", () => {
  it("finds paths in terminal titles", () => {
    expect(getWorkspaceHint("WindowsTerminal.exe", "PS C:\\code\\repo> ", "devTool")).toEqual({
      kind: "path",
      path: "C:\\code\\repo",
    });
  });

  it("never reads browser titles", () => {
    expect(getWorkspaceHint("chrome.exe", "C:\\code\\repo - Google Chrome", "browser")).toBeNull();
  });

  it("returns null without a title", () => {
    expect(getWorkspaceHint("Code", "", "editor")).toBeNull();
  });
});

describe("findPathInTitle", () => {
  it("reads Windows, Git Bash and Unix paths", () => {
    expect(findPathInTitle("PS C:\\Users\\me\\repo> git status")).toBe("C:\\Users\\me\\repo");
    expect(findPathInTitle("MINGW64:/c/Users/me/repo")).toBe("C:\\Users\\me\\repo");
    expect(findPathInTitle("me@box: ~/code/repo")).toBe("~/code/repo");
    expect(findPathInTitle("vim /home/me/repo/main.c")).toBe("/home/me/repo/main.c");
  });

  it("returns null when there is no path", () => {
    expect(findPathInTitle("Windows PowerShell")).toBeNull();
    expect(findPathInTitle("✳ Claude Code")).toBeNull();
  });
});
