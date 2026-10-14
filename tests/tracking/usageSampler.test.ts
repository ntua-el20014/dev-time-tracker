import { describe, it, expect, vi } from "vitest";
import {
  createUsageSampler,
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
});
