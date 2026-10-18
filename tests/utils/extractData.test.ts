import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/nonexistent" } }));

import { getLanguageDataFromTitle } from "../../src/utils/extractData";

describe("getLanguageDataFromTitle", () => {
  it("finds the language of the file in an editor title", () => {
    expect(getLanguageDataFromTitle("index.ts - repo - Visual Studio Code")).toEqual({
      language: "TypeScript",
      extension: ".ts",
    });
    expect(getLanguageDataFromTitle(String.raw`C:\src\main.cpp`)).toEqual({
      language: "C++",
      extension: ".cpp",
    });
  });

  it("prefers the longest matching extension", () => {
    expect(getLanguageDataFromTitle("welcome.blade.php — app")?.extension).toBe(".blade.php");
  });

  it("is case-insensitive and keeps the known extension's spelling", () => {
    expect(getLanguageDataFromTitle("NOTES.MD")).toEqual({
      language: "Markdown",
      extension: ".md",
    });
  });

  it("uses the preferred language for ambiguous extensions", () => {
    expect(getLanguageDataFromTitle("schema.sql")?.language).toBe("SQL");
    expect(getLanguageDataFromTitle("todo.txt")?.language).toBe("Text");
  });

  it("ignores numbers and extensions glued to other words", () => {
    expect(getLanguageDataFromTitle("Build: 3.14 errors")).toBeNull();
    expect(getLanguageDataFromTitle("see .tsx-like things")).toBeNull();
    expect(getLanguageDataFromTitle("untitled")).toBeNull();
    expect(getLanguageDataFromTitle("")).toBeNull();
  });

  it("accepts an extension right after a path separator", () => {
    expect(getLanguageDataFromTitle("~/proj/.json")?.extension).toBe(".json");
  });
});
