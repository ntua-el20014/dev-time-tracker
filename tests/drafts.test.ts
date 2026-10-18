import { describe, it, expect } from "vitest";
import { mergeDrafts, mergeCodeStats, type DraftRow } from "../shared/drafts";

const iso = (h: number, m = 0) =>
  new Date(Date.UTC(2026, 9, 18, h, m)).toISOString();

function row(over: Partial<DraftRow> & { id: string }): DraftRow {
  return {
    client_id: `c-${over.id}`,
    title: null,
    start_time: iso(9),
    end_time: iso(10),
    duration: 3600,
    project_id: null,
    supervising_seconds: 0,
    supervising_spans: [],
    code_stats: [],
    app_usage: [],
    ...over,
  };
}

describe("mergeDrafts", () => {
  it("keeps the earliest, spans to the last end and adds up the time", () => {
    const merged = mergeDrafts([
      row({ id: "b", start_time: iso(11), end_time: iso(11, 30), duration: 1500 }),
      row({
        id: "a",
        start_time: iso(9),
        end_time: iso(10),
        duration: 3000,
        supervising_seconds: 600,
        supervising_spans: [[iso(9, 20), iso(9, 30)]],
      }),
      row({ id: "c", start_time: iso(10, 15), end_time: iso(10, 45), duration: 1800 }),
    ]);
    expect(merged.keepId).toBe("a");
    expect(merged.deleteIds).toEqual(["c", "b"]);
    expect(merged.fields).toMatchObject({
      start_time: iso(9),
      end_time: iso(11, 30),
      duration: 6300, // gaps between drafts don't count
      supervising_seconds: 600,
      supervising_spans: [[iso(9, 20), iso(9, 30)]],
    });
  });

  it("takes the title and project with the most time", () => {
    const merged = mergeDrafts([
      row({ id: "a", title: "shop", project_id: "P", duration: 600 }),
      row({ id: "b", start_time: iso(10), title: "api", project_id: "Q", duration: 900, end_time: iso(11) }),
      row({ id: "c", start_time: iso(11), title: "shop", project_id: "P", duration: 600, end_time: iso(12) }),
      row({ id: "d", start_time: iso(12), title: null, project_id: null, duration: 5000, end_time: iso(13) }),
    ]);
    expect(merged.fields.title).toBe("shop");
    expect(merged.fields.project_id).toBe("P");
  });

  it("sums app usage and code stats per repo", () => {
    const stats = (added: number) => [
      {
        repo_key: "github.com/me/a",
        repo_name: "a",
        commits: 1,
        files_changed: 2,
        lines_added: added,
        lines_removed: 1,
        languages: { TypeScript: { added, removed: 1 } },
      },
    ];
    const merged = mergeDrafts([
      row({
        id: "a",
        code_stats: stats(10),
        app_usage: [{ app: "VS Code", language: "TypeScript", category: null, seconds: 600 }],
      }),
      row({
        id: "b",
        start_time: iso(10),
        end_time: iso(11),
        code_stats: stats(5),
        app_usage: [
          { app: "VS Code", language: "TypeScript", category: null, seconds: 300 },
          { app: "Chrome", language: null, category: "docs", seconds: 120 },
        ],
      }),
    ]);
    expect(merged.fields.code_stats).toEqual([
      {
        repo_key: "github.com/me/a",
        repo_name: "a",
        commits: 2,
        files_changed: 4,
        lines_added: 15,
        lines_removed: 2,
        languages: { TypeScript: { added: 15, removed: 2 } },
      },
    ]);
    expect(merged.fields.app_usage).toEqual([
      { app: "VS Code", language: "TypeScript", category: null, seconds: 900 },
      { app: "Chrome", language: null, category: "docs", seconds: 120 },
    ]);
  });

  it("needs two drafts and tolerates missing columns", () => {
    expect(() => mergeDrafts([row({ id: "a" })])).toThrow();
    const merged = mergeDrafts([
      row({ id: "a", code_stats: null, app_usage: null, supervising_spans: null, duration: null }),
      row({ id: "b", start_time: iso(10), end_time: null, duration: 60 }),
    ]);
    expect(merged.fields.duration).toBe(60);
    expect(merged.fields.end_time).toBe(iso(10));
    expect(mergeCodeStats([null, []])).toEqual([]);
  });
});
