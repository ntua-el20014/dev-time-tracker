import { describe, expect, it, vi } from "vitest";
import {
  browserCategoryLabel,
  classifyBrowserPage,
  classifyBrowserTitle,
  classifyBrowserUrl,
  pageTitleOf,
  parseCustomBrowserRules,
} from "../shared/browserCategories";

describe("pageTitleOf", () => {
  it("strips what the browser adds", () => {
    expect(pageTitleOf("Inbox - Gmail - Google Chrome")).toBe("Inbox - Gmail");
    expect(pageTitleOf("Array - JavaScript | MDN — Mozilla Firefox")).toBe("Array - JavaScript | MDN");
    expect(pageTitleOf("New tab and 3 more pages - Microsoft​ Edge")).toBe("New tab");
    expect(pageTitleOf("Speed Dial - Opera")).toBe("Speed Dial");
    expect(pageTitleOf("No suffix here")).toBe("No suffix here");
  });
});

describe("classifyBrowserTitle", () => {
  const cases: [string, string | null][] = [
    ["Fix the tray menu by octo · Pull Request #42 · octo/app · GitHub - Google Chrome", "code-review"],
    ["Pull requests · octo/app · GitHub - Opera", "code-review"],
    ["Comparing main...feature · octo/app · GitHub - Brave", "code-review"],
    ["Draft: new parser (!17) · Merge requests · group / proj · GitLab — Mozilla Firefox", "code-review"],
    ["Crash on start · Issue #7 · octo/app · GitHub - Google Chrome", "issues"],
    ["Issues · octo/app · GitHub - Google Chrome", "issues"],
    ["[APP-12] Login fails - Jira - Google Chrome", "issues"],
    ["Actions · octo/app · GitHub - Google Chrome", "ci-deploy"],
    ["app – Deployments – Vercel - Google Chrome", "ci-deploy"],
    ["octo/app: A tracker · GitHub - Google Chrome", "code"],
    ["src/main.ts at main · octo/app · GitHub - Opera", "code"],
    ["Refactoring the batcher - Claude - Google Chrome", "ai-chat"],
    ["ChatGPT - Microsoft​ Edge", "ai-chat"],
    // Edge with a profile name, and grouped tabs
    ["Fix · Pull Request #3 · o/r · GitHub and 2 more pages - Work - Microsoft​ Edge", "code-review"],
    ["Claude - Opera", "ai-chat"],
    ["javascript - How do I X? - Stack Overflow - Google Chrome", "q-and-a"],
    ["Array.prototype.map() - JavaScript | MDN - Google Chrome", "docs"],
    ["vitest - npm - Google Chrome", "docs"],
    ["Getting Started | Electron Documentation - Google Chrome", "docs"],
    ["localhost:5173/settings - Google Chrome", "local-dev"],
    ["general (Channel) - Acme - Slack - Google Chrome", "communication"],
    ["Inbox (3) - me@example.com - Gmail - Google Chrome", "communication"],
    // Not dev work, or nothing to go on
    ["Quarterly plan - Google Docs - Google Chrome", null],
    ["YouTube - Google Chrome", null],
    ["New Tab - Google Chrome", null],
    ["", null],
  ];
  it.each(cases)("%s → %s", (title, category) => {
    expect(classifyBrowserTitle(title)).toBe(category);
  });
});

describe("classifyBrowserUrl", () => {
  const cases: [string, string | null][] = [
    ["https://github.com/octo/app/pull/42/files", "code-review"],
    ["https://github.com/pulls", "code-review"],
    ["https://github.com/octo/app/compare/main...x", "code-review"],
    ["https://github.com/octo/app/issues/7", "issues"],
    ["https://github.com/octo/app/actions/runs/1", "ci-deploy"],
    ["https://github.com/octo/app/blob/main/a.ts", "code"],
    ["https://gitlab.com/g/p/-/merge_requests/17", "code-review"],
    ["https://gitlab.com/g/p/-/pipelines", "ci-deploy"],
    ["https://bitbucket.org/t/r/pull-requests/3", "code-review"],
    ["https://dev.azure.com/org/proj/_git/repo/pullrequest/5", "code-review"],
    ["https://acme.atlassian.net/browse/APP-12", "issues"],
    ["https://linear.app/acme/issue/APP-1", "issues"],
    ["https://vercel.com/acme/app/deployments", "ci-deploy"],
    ["https://supabase.com/dashboard/project/x", "ci-deploy"],
    ["https://claude.ai/chat/abc", "ai-chat"],
    ["https://chatgpt.com/c/abc", "ai-chat"],
    ["https://stackoverflow.com/questions/1", "q-and-a"],
    ["https://unix.stackexchange.com/q/1", "q-and-a"],
    ["https://developer.mozilla.org/en-US/docs/Web", "docs"],
    ["https://docs.python.org/3/library/os.html", "docs"],
    ["https://www.electronjs.org/docs/latest/api/app", "docs"],
    ["https://example.com/docs/intro", "docs"],
    ["https://www.npmjs.com/package/vitest", "docs"],
    ["http://localhost:3000/", "local-dev"],
    ["127.0.0.1:8080/health", "local-dev"],
    ["http://192.168.1.20:5173", "local-dev"],
    ["https://app.slack.com/client/T1/C1", "communication"],
    ["https://docs.google.com/document/d/1", null],
    ["https://www.youtube.com/watch?v=1", null],
    ["chrome://newtab/", null],
    ["not a url", null],
  ];
  it.each(cases)("%s → %s", (url, category) => {
    expect(classifyBrowserUrl(url)).toBe(category);
  });
});

describe("classifyBrowserPage", () => {
  it("reads the URL only when the title says nothing", () => {
    const readUrl = vi.fn(() => "https://claude.ai/chat/1");
    expect(classifyBrowserPage("Fix · Pull Request #1 · o/r · GitHub - Google Chrome", readUrl)).toBe("code-review");
    expect(readUrl).not.toHaveBeenCalled();
    expect(classifyBrowserPage("Refactor plan - Google Chrome", readUrl)).toBe("ai-chat");
    expect(readUrl).toHaveBeenCalledTimes(1);
    expect(classifyBrowserPage("Something - Google Chrome", () => null)).toBeNull();
  });
});

describe("browserCategoryLabel", () => {
  it("labels built-in categories, keeps the user's own names, calls none other browsing", () => {
    expect(browserCategoryLabel("code-review")).toBe("Code review");
    expect(browserCategoryLabel(null)).toBe("Other browsing");
    expect(browserCategoryLabel("Design")).toBe("Design");
  });
});

describe("custom browser rules", () => {
  const rules = parseCustomBrowserRules({
    titles: {
      "- Notion": "docs",
      Figma: "Design",
      "Pull Request #1": "other",
      "  ": "docs",
      broken: 42,
    },
    hosts: {
      "grafana.mycorp.com": "CI, cloud & monitoring",
      "https://www.github.com/mycorp/handbook/": "Docs",
      "*.youtube.com": "other",
      "intranet": "Company stuff that has a name far longer than forty characters",
    },
  });

  it("reads titles and hosts, skipping what isn't a rule", () => {
    expect(rules.titles).toEqual([
      { text: "- notion", category: "docs" },
      { text: "figma", category: "Design" },
      { text: "pull request #1", category: null },
    ]);
    expect(rules.hosts).toEqual([
      { host: "grafana.mycorp.com", path: "", category: "ci-deploy" },
      { host: "github.com", path: "/mycorp/handbook", category: "docs" },
      { host: "youtube.com", path: "", category: null },
      { host: "intranet", path: "", category: "Company stuff that has a name far longer" },
    ]);
  });

  it("never throws on a broken file", () => {
    for (const data of [null, 3, "x", [], { titles: [1, 2], hosts: "a" }]) {
      expect(parseCustomBrowserRules(data)).toEqual({ titles: [], hosts: [] });
    }
  });

  it("goes before the built-in title rules, without reading the URL", () => {
    const readUrl = vi.fn(() => "https://example.com");
    expect(classifyBrowserPage("Roadmap - Notion - Google Chrome", readUrl, rules)).toBe("docs");
    expect(classifyBrowserPage("Logo v2 – Figma - Google Chrome", readUrl, rules)).toBe("Design");
    // Overrides a page the built-in rules know
    expect(classifyBrowserPage("Fix bug by me · Pull Request #23 · o/r · GitHub - Google Chrome", readUrl, rules)).toBe("code-review");
    expect(classifyBrowserPage("Fix · Pull Request #1 · o/r · GitHub - Google Chrome", readUrl, rules)).toBeNull();
    expect(readUrl).not.toHaveBeenCalled();
  });

  it("matches hosts with subdomains and paths when the title says nothing", () => {
    const page = (url: string) => classifyBrowserPage("Dashboard - Google Chrome", () => url, rules);
    expect(page("https://grafana.mycorp.com/d/abc")).toBe("ci-deploy");
    expect(page("https://github.com/mycorp/handbook/blob/main/README.md")).toBe("docs");
    expect(page("https://github.com/mycorp/handbook-old")).toBe("code");
    expect(page("https://m.youtube.com/watch?v=1")).toBeNull();
    // Unmatched: the built-in URL rules still apply
    expect(page("https://stackoverflow.com/questions/1")).toBe("q-and-a");
  });
});
