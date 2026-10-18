import { describe, it, expect } from "vitest";
import {
  addAppUsage,
  groupAppUsage,
  MAX_APP_USAGE_ENTRIES,
  type AppUsageEntry,
} from "../shared/appUsage";

describe("addAppUsage", () => {
  it("sums samples per app, language and category", () => {
    const list: AppUsageEntry[] = [];
    addAppUsage(list, { app: "VS Code", language: "TypeScript" }, 10);
    addAppUsage(list, { app: "VS Code", language: "TypeScript" }, 10);
    addAppUsage(list, { app: "Chrome", language: null, category: "docs" }, 10);
    addAppUsage(list, { app: "Chrome", language: null, category: null }, 10);
    expect(list).toEqual([
      { app: "VS Code", language: "TypeScript", category: null, seconds: 20 },
      { app: "Chrome", language: null, category: "docs", seconds: 10 },
      { app: "Chrome", language: null, category: null, seconds: 10 },
    ]);
  });

  it("ignores empty samples", () => {
    const list: AppUsageEntry[] = [];
    addAppUsage(list, { app: "VS Code", language: null }, 0);
    expect(list).toEqual([]);
  });

  it("stops growing at the cap and folds new combinations into the app", () => {
    const list: AppUsageEntry[] = [];
    for (let i = 0; i < MAX_APP_USAGE_ENTRIES; i++) {
      addAppUsage(list, { app: "VS Code", language: `L${i}` }, 1);
    }
    addAppUsage(list, { app: "VS Code", language: "New" }, 5);
    addAppUsage(list, { app: "Unseen", language: null }, 5);
    expect(list).toHaveLength(MAX_APP_USAGE_ENTRIES);
    expect(list[0].seconds).toBe(6);
    expect(list.some((e) => e.app === "Unseen")).toBe(false);
  });
});

describe("groupAppUsage", () => {
  it("groups by app, most time first, and skips malformed rows", () => {
    const groups = groupAppUsage([
      { app: "Chrome", language: null, category: "docs", seconds: 30 },
      { app: "VS Code", language: "Go", category: null, seconds: 20 },
      { app: "VS Code", language: "TypeScript", category: null, seconds: 40 },
      { app: 3, seconds: 5 },
      null,
    ]);
    expect(groups.map((g) => [g.app, g.seconds])).toEqual([
      ["VS Code", 60],
      ["Chrome", 30],
    ]);
    expect(groups[0].parts.map((p) => p.language)).toEqual(["TypeScript", "Go"]);
  });

  it("returns nothing for a non-array", () => {
    expect(groupAppUsage(undefined)).toEqual([]);
    expect(groupAppUsage({})).toEqual([]);
  });
});
