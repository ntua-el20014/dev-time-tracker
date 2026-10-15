/**
 * Sidebar navigation.
 *
 * A *view* is a sidebar item (Home, Sessions, …). Some views have sub-views
 * picked with a segmented control (Sessions → List / Calendar / Insights).
 * What is on screen is made of *pages*, each with a render function and a
 * dirty flag: a page renders on its first visit and then only after
 * markTabsDirty() names it. Page ids are the old tab ids ("dashboard",
 * "summary", "organization", …), so existing markTabsDirty calls keep working.
 */

export type ViewId =
  | "home"
  | "sessions"
  | "projects"
  | "billing"
  | "team"
  | "settings";

/** Page shown by each view, keyed by sub-view ("" for views without any). */
const VIEW_PAGES: Record<ViewId, Record<string, string>> = {
  home: { "": "dashboard" },
  sessions: { list: "summary", calendar: "calendar", insights: "insights" },
  projects: { "": "projects" },
  billing: { "": "billing" },
  team: { organization: "organization", analytics: "teamAnalytics" },
  settings: { "": "settings" },
};

/** Home's collapsible "App activity" section is its own page ("today"). */
const APP_ACTIVITY_ID = "appActivity";

const renderers = new Map<string, () => unknown>();
const dirty: Record<string, boolean> = {};
const rendered: Record<string, boolean> = {};

let activeView: ViewId = "home";
const activeSub: Partial<Record<ViewId, string>> = {
  sessions: "list",
  team: "organization",
};
let initialized = false;
/** Items the user opened on purpose; they stay visible until sign-out. */
const pinned = new Set<ViewId>();

export function registerPage(pageId: string, render: () => unknown) {
  renderers.set(pageId, render);
}

/** Mark pages as needing a re-render on their next visit. */
export function markTabsDirty(...pageIds: string[]) {
  for (const id of pageIds) dirty[id] = true;
}

/** Record that a page was just rendered. */
export function markTabClean(pageId: string) {
  rendered[pageId] = true;
  dirty[pageId] = false;
}

/** Sign-out: everything renders again on its next visit, pins are dropped. */
export function resetNavigation() {
  for (const id of Object.keys(rendered)) rendered[id] = false;
  pinned.clear();
}

function appActivityOpen(): boolean {
  const details = document.getElementById(
    APP_ACTIVITY_ID,
  ) as HTMLDetailsElement | null;
  return !!details?.open;
}

/** Pages currently on screen. */
function visiblePages(): string[] {
  const subs = VIEW_PAGES[activeView];
  const page = subs[activeSub[activeView] ?? ""];
  const pages = page ? [page] : [];
  if (activeView === "home" && appActivityOpen()) pages.push("today");
  return pages;
}

export function isPageVisible(pageId: string): boolean {
  return visiblePages().includes(pageId);
}

export function getActiveView(): ViewId {
  return activeView;
}

function renderIfNeeded(pageId: string, force = false) {
  if (!force && rendered[pageId] && !dirty[pageId]) return;
  const render = renderers.get(pageId);
  if (!render) return;
  void render();
  markTabClean(pageId);
}

/**
 * Mark pages dirty and re-render the ones on screen right away (the others
 * re-render on their next visit).
 */
export function refreshPages(...pageIds: string[]) {
  markTabsDirty(...pageIds);
  for (const id of visiblePages()) {
    if (pageIds.includes(id)) renderIfNeeded(id);
  }
}

function syncDom() {
  document.querySelectorAll<HTMLElement>(".nav-item[data-view]").forEach((el) => {
    const on = el.dataset.view === activeView;
    el.classList.toggle("active", on);
    if (on) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  document.querySelectorAll<HTMLElement>(".view").forEach((el) => {
    el.hidden = el.id !== `view-${activeView}`;
  });
  const sub = activeSub[activeView];
  if (!sub) return;
  const view = document.getElementById(`view-${activeView}`);
  view?.querySelectorAll<HTMLElement>(".subnav-btn").forEach((btn) => {
    const on = btn.dataset.sub === sub;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", String(on));
  });
  view?.querySelectorAll<HTMLElement>(".subview").forEach((el) => {
    el.hidden = el.dataset.sub !== sub;
  });
}

/** Show a view (and optionally one of its sub-views), rendering as needed. */
export function navigateTo(view: ViewId, sub?: string) {
  if (sub && VIEW_PAGES[view][sub]) activeSub[view] = sub;
  activeView = view;
  syncDom();
  for (const id of visiblePages()) renderIfNeeded(id);
  document.querySelector(".app-main")?.scrollTo({ top: 0 });
}

/**
 * Show or hide a sidebar item; hiding the active one falls back to Home.
 * Pinned items are never hidden.
 */
export function setNavItemVisible(view: ViewId, visible: boolean) {
  if (!visible && pinned.has(view)) return;
  const item = document.querySelector<HTMLElement>(
    `.nav-item[data-view="${view}"]`,
  );
  if (item) item.hidden = !visible;
  if (!visible && activeView === view) navigateTo("home");
}

/**
 * Show an item the user asked for (e.g. Settings → "Set up a team") and keep
 * it until sign-out, so a visibility re-check can't pull it away mid-setup.
 */
export function pinNavItem(view: ViewId) {
  pinned.add(view);
  setNavItemVisible(view, true);
}

export function isNavItemVisible(view: ViewId): boolean {
  const item = document.querySelector<HTMLElement>(
    `.nav-item[data-view="${view}"]`,
  );
  return !!item && !item.hidden;
}

/** Show or hide a sub-view button; hiding the active one picks the first. */
export function setSubViewVisible(view: ViewId, sub: string, visible: boolean) {
  const btn = document.querySelector<HTMLElement>(
    `#view-${view} .subnav-btn[data-sub="${sub}"]`,
  );
  if (btn) btn.hidden = !visible;
  if (!visible && activeSub[view] === sub) {
    activeSub[view] = Object.keys(VIEW_PAGES[view])[0];
    if (activeView === view) navigateTo(view);
  }
}

/** Ctrl+N: the Nth visible sidebar item, top to bottom (1-based). */
export function navigateToIndex(n: number) {
  const items = Array.from(
    document.querySelectorAll<HTMLElement>(".nav-item[data-view]"),
  ).filter((el) => !el.hidden);
  const view = items[n - 1]?.dataset.view as ViewId | undefined;
  if (view) navigateTo(view);
}

/** Wire sidebar, sub-view and App activity clicks (once). */
export function initNavigation() {
  if (initialized) return;
  initialized = true;

  document.getElementById("appNav")?.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(
      ".nav-item[data-view]",
    );
    if (item) navigateTo(item.dataset.view as ViewId);
  });

  document.querySelectorAll<HTMLElement>(".subnav").forEach((nav) => {
    nav.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>(
        ".subnav-btn[data-sub]",
      );
      const view = nav.closest<HTMLElement>(".view")?.id.replace("view-", "");
      if (btn && view) navigateTo(view as ViewId, btn.dataset.sub);
    });
  });

  document.getElementById(APP_ACTIVITY_ID)?.addEventListener("toggle", () => {
    if (appActivityOpen()) renderIfNeeded("today");
  });
}
