import { describe, it, expect, vi } from "vitest";
import {
  createUsageSampler,
  URL_GIVE_UP_AFTER,
  type ForegroundWindow,
} from "../../src/tracking/usageSampler";

function setup(win: ForegroundWindow | null) {
  const deps = {
    getForegroundWindow: vi.fn(() => win),
    matchApp: vi.fn((exec: string) => {
      if (exec === "code.exe") return { name: "VS Code", category: "editor" as const };
      if (exec === "chrome.exe") return { name: "Chrome", category: "browser" as const };
      return null;
    }),
    getLanguageFromTitle: vi.fn((title: string) =>
      title.includes(".ts") ? { language: "TypeScript", extension: ".ts" } : null,
    ),
  };
  return { sample: createUsageSampler(deps), deps };
}

const vscode = (title: string, getIconData = () => "data:icon"): ForegroundWindow => ({
  execName: "Code.exe",
  title,
  getIconData,
});

describe("usageSampler", () => {
  it("samples a known app with language from the title", () => {
    const { sample } = setup(vscode("main.ts — repo — VS Code"));
    expect(sample("u1")).toEqual({
      appName: "VS Code",
      windowTitle: "main.ts — repo — VS Code",
      language: "TypeScript",
      languageExtension: ".ts",
      icon: "data:icon",
      category: null,
    });
  });

  it("matches executables case-insensitively", () => {
    const { deps, sample } = setup(vscode("x"));
    sample("u1");
    expect(deps.matchApp).toHaveBeenCalledWith("code.exe", "u1");
  });

  it("skips unknown apps and missing windows", () => {
    expect(setup({ execName: "slack.exe", title: "", getIconData: () => "" }).sample("u1")).toBeNull();
    expect(setup(null).sample("u1")).toBeNull();
  });

  it("labels editors without a detectable language as Unknown, others as null", () => {
    expect(setup(vscode("Welcome")).sample("u1")?.language).toBe("Unknown");
    const chrome = { execName: "chrome.exe", title: "Docs", getIconData: () => "" };
    expect(setup(chrome).sample("u1")?.language).toBeNull();
  });

  it("fetches each app's icon once and survives icon errors", () => {
    const getIcon = vi.fn(() => {
      throw new Error("no icon");
    });
    const { sample } = setup(vscode("a.ts", getIcon));
    expect(sample("u1")?.icon).toBe("");
    sample("u1");
    expect(getIcon).toHaveBeenCalledTimes(1);
  });

  it("classifies browser pages, from the title before the URL", () => {
    const getUrl = vi.fn(() => "https://claude.ai/chat/1");
    const pr = { execName: "chrome.exe", title: "Fix · Pull Request #1 · o/r · GitHub - Google Chrome", getIconData: () => "", getUrl };
    expect(setup(pr).sample("u1")?.category).toBe("code-review");
    expect(getUrl).not.toHaveBeenCalled();
    const chat = { ...pr, title: "Untitled - Google Chrome" };
    expect(setup(chat).sample("u1")?.category).toBe("ai-chat");
    expect(getUrl).toHaveBeenCalledTimes(1);
  });

  it("never classifies or reads URLs for non-browsers", () => {
    const getUrl = vi.fn(() => "https://claude.ai/");
    expect(setup({ ...vscode("Claude"), getUrl }).sample("u1")?.category).toBeNull();
    expect(getUrl).not.toHaveBeenCalled();
  });

  it("stops asking a browser whose URL never comes back", () => {
    const getUrl = vi.fn(() => "");
    const { sample } = setup({ execName: "chrome.exe", title: "Untitled - Google Chrome", getIconData: () => "", getUrl });
    for (let i = 0; i < URL_GIVE_UP_AFTER + 3; i++) expect(sample("u1")?.category).toBeNull();
    expect(getUrl).toHaveBeenCalledTimes(URL_GIVE_UP_AFTER);
  });

  it("keeps asking a browser whose URL worked once, and survives errors", () => {
    let n = 0;
    const getUrl = vi.fn(() => {
      n++;
      if (n === 1) return "https://github.com/o/r";
      throw new Error("UIA failed");
    });
    const { sample } = setup({ execName: "chrome.exe", title: "Untitled - Google Chrome", getIconData: () => "", getUrl });
    expect(sample("u1")?.category).toBe("code");
    for (let i = 0; i < URL_GIVE_UP_AFTER + 3; i++) expect(sample("u1")?.category).toBeNull();
    expect(getUrl).toHaveBeenCalledTimes(URL_GIVE_UP_AFTER + 4);
  });
});

describe("usageSampler with the user's browser rules", () => {
  it("passes the user's rules to the classifier", () => {
    const { deps } = setup(null);
    const customBrowserRules = vi.fn(() => ({
      titles: [{ text: "notion", category: "docs" }],
      hosts: [],
    }));
    const sample = createUsageSampler({
      ...deps,
      getForegroundWindow: () => ({
        execName: "chrome.exe",
        title: "Roadmap - Notion - Google Chrome",
        getIconData: () => "",
      }),
      customBrowserRules,
    });
    expect(sample("u1")?.category).toBe("docs");
    expect(customBrowserRules).toHaveBeenCalledWith("u1");
  });
});
