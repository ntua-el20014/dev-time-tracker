/**
 * What a browser tab was for (C5): code review, docs, AI chat, … Classified
 * on the device from the window title (which carries the page title), or
 * from the URL when the title says nothing. Only the category is stored
 * (usage_logs.category, daily_usage_summary.category), never the URL.
 *
 * Pure, so it runs in tests; the renderer uses the labels.
 */

export const BROWSER_CATEGORIES = {
  "code-review": "Code review",
  code: "Code hosting",
  issues: "Issues & planning",
  "ci-deploy": "CI, cloud & monitoring",
  docs: "Docs & packages",
  "ai-chat": "AI chat",
  "q-and-a": "Q&A",
  "local-dev": "Local dev",
  communication: "Chat & mail",
} as const;

export type BrowserCategory = keyof typeof BROWSER_CATEGORIES;

/** Label of a stored category; unclassified browser time is "Other browsing". */
export function browserCategoryLabel(category: string | null | undefined): string {
  return (category && BROWSER_CATEGORIES[category as BrowserCategory]) || "Other browsing";
}

// ── Titles ───────────────────────────────────────────────────────────

/** " - Google Chrome", " — Mozilla Firefox", …: added after the page title. */
const BROWSER_SUFFIX =
  /\s+[-—–]\s+(?:Google Chrome|Chromium|Mozilla Firefox|Firefox Developer Edition|Firefox|Microsoft\W{0,2}Edge|Brave|Opera GX|Opera|Vivaldi|Arc|Safari)\s*$/i;
/** Edge: "… and 3 more pages" when tabs are grouped */
const MORE_PAGES = /\s+and \d+ more pages?$/i;
/** Edge puts the profile name before its own: "… - Work - Microsoft Edge" */
const EDGE = /Microsoft\W{0,2}Edge\s*$/i;

export function pageTitleOf(windowTitle: string): string {
  return windowTitle.replace(BROWSER_SUFFIX, "").trim().replace(MORE_PAGES, "");
}

/** The page title, and for Edge also without a possible profile name. */
function pageTitleCandidates(windowTitle: string): string[] {
  const title = pageTitleOf(windowTitle);
  if (!EDGE.test(windowTitle)) return [title];
  const withoutProfile = title.replace(/\s+[-—–]\s+[^-—–]+$/, "").replace(MORE_PAGES, "");
  return withoutProfile && withoutProfile !== title ? [title, withoutProfile] : [title];
}

/** Ordered: the first match wins (a PR page also ends in "· GitHub"). */
const TITLE_RULES: [RegExp, BrowserCategory][] = [
  // Local dev servers show the address when the page has no title
  [/^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i, "local-dev"],

  [/\bPull Request #\d+\b|\bPull requests? · |^Comparing .+ · |\bMerge requests? !?\d*|\bPull Request \d+ - Repos\b/i, "code-review"],
  [/ · Issue #\d+ · | · Discussion #\d+ · |^Issues · |^(?:\[[A-Z][A-Z0-9]+-\d+\] .+ - )?Jira$| - Jira$| \| Trello$| - Linear$| \| Linear$/i, "issues"],
  [/^Actions · |^Workflow runs · | · Workflow runs? · |(?:^| [-|–·] )(?:Vercel|Netlify|Supabase|Sentry|Railway|Render|Cloudflare|AWS Management Console|Microsoft Azure|Google Cloud console)$/i, "ci-deploy"],
  [/ · GitHub$| · GitLab$| — Bitbucket$| - Bitbucket$| - Repos$/i, "code"],

  [/^(?:Claude|ChatGPT|Gemini|Google Gemini|Perplexity|Microsoft Copilot|DeepSeek|Le Chat|Grok|Google AI Studio)$|(?: [-|–] )(?:Claude|ChatGPT|Gemini|Perplexity|DeepSeek|Le Chat - Mistral AI|Grok|Google AI Studio)$/i, "ai-chat"],
  [/ - Stack Overflow$| - [^-]+ Stack Exchange$| - Super User$| - Server Fault$| - Ask Ubuntu$/i, "q-and-a"],
  [/ \| MDN(?: Web Docs)?$| - MDN Web Docs$| — Read the Docs$| \| DevDocs$|\bnpm$| · PyPI$| - Docs\.rs$| - crates\.io| - Go Packages$| \| Microsoft Learn$| - Python [\d.]+ documentation$|\b(?:Documentation|Docs|API Reference|Reference)$/i, "docs"],
  [/ - Slack$| \| Slack$| \| Discord$| - Discord$|\bMicrosoft Teams$| - Gmail$|^Gmail$| - Outlook$|^Mail - .+ - Outlook$/i, "communication"],
];

/** Things that look like a rule match but aren't dev work. */
const TITLE_EXCEPTIONS = /(?:Google (?:Docs|Sheets|Slides)|Word|Excel|PowerPoint)$/i;

export function classifyBrowserTitle(windowTitle: string): BrowserCategory | null {
  for (const title of pageTitleCandidates(windowTitle || "")) {
    if (!title || TITLE_EXCEPTIONS.test(title)) continue;
    for (const [pattern, category] of TITLE_RULES) {
      if (pattern.test(title)) return category;
    }
  }
  return null;
}

// ── URLs ─────────────────────────────────────────────────────────────

const hostIs = (host: string, ...domains: string[]) =>
  domains.some((d) => host === d || host.endsWith("." + d));

const AI_CHAT = [
  "claude.ai", "chatgpt.com", "chat.openai.com", "gemini.google.com",
  "aistudio.google.com", "perplexity.ai", "copilot.microsoft.com",
  "chat.deepseek.com", "chat.mistral.ai", "grok.com", "poe.com", "v0.dev",
];
const Q_AND_A = [
  "stackoverflow.com", "stackexchange.com", "superuser.com",
  "serverfault.com", "askubuntu.com",
];
const ISSUES = ["linear.app", "atlassian.net", "trello.com", "app.asana.com", "youtrack.cloud", "clickup.com"];
const CI_DEPLOY = [
  "vercel.com", "netlify.com", "app.netlify.com", "supabase.com", "sentry.io",
  "railway.app", "render.com", "fly.io", "console.aws.amazon.com",
  "portal.azure.com", "console.cloud.google.com", "dash.cloudflare.com",
  "app.circleci.com", "travis-ci.com", "buildkite.com", "app.datadoghq.com",
  "grafana.net", "heroku.com", "dashboard.heroku.com",
];
const DOCS = [
  "developer.mozilla.org", "devdocs.io", "readthedocs.io", "readthedocs.org",
  "learn.microsoft.com", "docs.rs", "crates.io", "pkg.go.dev",
  "doc.rust-lang.org", "npmjs.com", "pypi.org", "react.dev", "vuejs.org",
  "angular.dev", "svelte.dev", "nextjs.org", "typescriptlang.org",
  "nodejs.org", "developer.apple.com", "developer.android.com",
  "cppreference.com", "en.cppreference.com", "kotlinlang.org", "go.dev",
  "python.org", "rust-lang.org", "electronjs.org", "tailwindcss.com",
];
const COMMUNICATION = [
  "slack.com", "discord.com", "teams.microsoft.com", "teams.live.com",
  "mail.google.com", "outlook.live.com", "outlook.office.com",
  "outlook.office365.com",
];

function isLocalHost(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".test") ||
    host === "[::1]" ||
    host === "0.0.0.0" ||
    /^127\.\d+\.\d+\.\d+$/.test(host) ||
    /^10\.\d+\.\d+\.\d+$/.test(host) ||
    /^192\.168\.\d+\.\d+$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)
  );
}

/** Repository hosts: what a path on them is for. */
function classifyForge(host: string, path: string): BrowserCategory | null {
  if (hostIs(host, "github.com")) {
    if (/^\/[^/]+\/[^/]+\/(pull|pulls|compare)(\/|$)/.test(path) || /^\/pulls(\/|$)/.test(path)) return "code-review";
    if (/^\/[^/]+\/[^/]+\/(issues|discussions|projects|milestones)(\/|$)/.test(path) || /^\/(issues|orgs\/[^/]+\/projects)(\/|$)/.test(path)) return "issues";
    if (/^\/[^/]+\/[^/]+\/actions(\/|$)/.test(path)) return "ci-deploy";
    return "code";
  }
  if (hostIs(host, "gitlab.com")) {
    if (/\/-\/merge_requests(\/|$)/.test(path)) return "code-review";
    if (/\/-\/(issues|boards|milestones)(\/|$)/.test(path)) return "issues";
    if (/\/-\/(pipelines|jobs|environments)(\/|$)/.test(path)) return "ci-deploy";
    return "code";
  }
  if (hostIs(host, "bitbucket.org")) {
    if (/\/pull-requests(\/|$)/.test(path)) return "code-review";
    if (/\/(issues|jira)(\/|$)/.test(path)) return "issues";
    if (/\/(pipelines|deployments)(\/|$)/.test(path)) return "ci-deploy";
    return "code";
  }
  if (hostIs(host, "dev.azure.com", "visualstudio.com")) {
    if (/\/pullrequest/i.test(path)) return "code-review";
    if (/\/_(workitems|boards|backlogs|sprints)(\/|$)/.test(path)) return "issues";
    if (/\/_(build|release)(\/|$)/.test(path)) return "ci-deploy";
    if (/\/_git(\/|$)/.test(path)) return "code";
  }
  return null;
}

export function classifyBrowserUrl(raw: string): BrowserCategory | null {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `http://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (isLocalHost(host)) return "local-dev";
  const forge = classifyForge(host, path);
  if (forge) return forge;
  if (hostIs(host, ...AI_CHAT)) return "ai-chat";
  if (hostIs(host, ...Q_AND_A)) return "q-and-a";
  if (hostIs(host, ...ISSUES)) return "issues";
  if (hostIs(host, ...CI_DEPLOY)) return "ci-deploy";
  if (hostIs(host, ...COMMUNICATION)) return "communication";
  if (hostIs(host, "docs.google.com")) return null; // documents, not dev docs
  if (
    hostIs(host, ...DOCS) ||
    /^docs?\./.test(host) ||
    /^(developer|developers|devdocs)\./.test(host) ||
    /^\/(docs?|documentation|api-reference|reference)(\/|$)/i.test(path)
  ) {
    return "docs";
  }
  return null;
}

/** Title first (free); the URL only when the title says nothing. */
export function classifyBrowserPage(
  windowTitle: string,
  readUrl: () => string | null,
): BrowserCategory | null {
  const byTitle = classifyBrowserTitle(windowTitle);
  if (byTitle) return byTitle;
  const url = readUrl();
  return url ? classifyBrowserUrl(url) : null;
}
