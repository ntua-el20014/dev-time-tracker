/**
 * The drafts review inbox (Phase D3), at the top of Sessions → List.
 * Always-on mode saves what it records as drafts; here the user confirms
 * them (title, project, billable), merges neighbours, or discards them.
 * Drafts aren't counted anywhere until confirmed, and are never billed.
 */
import { escapeHtml } from "../utils/domUtils";
import { safeIpcInvoke } from "../utils/ipcHelpers";
import { showModal, showConfirmationModal } from "./Modals";
import { showInAppNotification } from "./Notifications";
import {
  draftsLabel,
  onDraftCount,
  onDraftSaved,
  refreshDraftCount,
} from "../draftCount";
import { refreshPages } from "../navigation";
import { addCodeStats, emptyTotals, formatCodeTotals } from "../../shared/codeStats";
import { formatSpan } from "../../shared/projectActivity";
import type { RepoCodeStats } from "../../shared/codeStats";

interface Draft {
  id: string;
  title: string | null;
  start_time: string;
  end_time: string | null;
  duration: number | null;
  project_id: string | null;
  project_name: string | null;
  supervising_seconds: number | null;
  code_stats: RepoCodeStats[] | null;
  /** The segment is still being recorded */
  in_progress: boolean;
}

interface Project {
  id: string;
  name: string;
  hourly_rate?: number | null;
}

let mounted: HTMLElement | null = null;
/** How many drafts the mounted inbox lists */
let shown = 0;
const selected = new Set<string>();
let busy = false;

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function whenText(d: Draft): string {
  const start = new Date(d.start_time);
  const day = start.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  return `${day} · ${time(d.start_time)}–${d.end_time ? time(d.end_time) : "now"}`;
}

function metaText(d: Draft): string {
  const parts = [`${formatSpan(d.duration ?? 0)} active`];
  if (d.supervising_seconds) parts.push(`${formatSpan(d.supervising_seconds)} supervising`);
  parts.push(d.project_name ?? "No project");
  const code = formatCodeTotals(addCodeStats(emptyTotals(), d.code_stats));
  if (code) parts.push(code);
  return parts.join(" · ");
}

function rowHtml(d: Draft): string {
  const id = escapeHtml(d.id);
  return `
    <li class="draft-item${selected.has(d.id) ? " selected" : ""}" data-id="${id}">
      <input type="checkbox" class="draft-check" data-id="${id}" aria-label="Select draft" ${selected.has(d.id) ? "checked" : ""}>
      <div class="draft-info">
        <span class="draft-title">${escapeHtml(d.title || "Untitled")}${
          d.in_progress ? ` <span class="draft-live">● recording</span>` : ""
        }</span>
        <span class="draft-when">${escapeHtml(whenText(d))}</span>
        <span class="draft-meta">${escapeHtml(metaText(d))}</span>
      </div>
      <button type="button" class="draft-confirm-btn" data-id="${id}">Confirm…</button>
    </li>`;
}

/** Render the inbox into `container` (empty when there are no drafts). */
export async function renderDraftInbox(container: HTMLElement) {
  mounted = container;
  const drafts = await safeIpcInvoke<Draft[]>("get-draft-sessions", [], {
    fallback: [],
    showNotification: false,
  });
  if (mounted !== container) return; // re-rendered meanwhile
  shown = drafts.length;
  // Keep the rail badge in step with what is listed
  void refreshDraftCount();
  for (const id of [...selected]) {
    if (!drafts.some((d) => d.id === id)) selected.delete(id);
  }
  if (drafts.length === 0) {
    container.innerHTML = "";
    container.hidden = true;
    return;
  }
  container.hidden = false;
  container.innerHTML = `
    <section class="draft-inbox" aria-label="Drafts to review">
      <div class="draft-inbox-header">
        <div>
          <h3>${escapeHtml(draftsLabel(drafts.length))}</h3>
          <p class="draft-inbox-note">Recorded by always-on. Not counted or billed until you confirm them.</p>
        </div>
        <div class="draft-inbox-actions">
          <button type="button" id="draftMergeBtn" class="draft-action-btn" ${selected.size < 2 ? "disabled" : ""}>Merge selected</button>
          <button type="button" id="draftDiscardBtn" class="draft-action-btn danger" ${selected.size === 0 ? "disabled" : ""}>Discard selected</button>
        </div>
      </div>
      <ul class="draft-list">${drafts.map(rowHtml).join("")}</ul>
    </section>`;

  container.querySelectorAll<HTMLInputElement>(".draft-check").forEach((box) => {
    box.addEventListener("change", () => {
      const id = box.dataset.id!;
      if (box.checked) selected.add(id);
      else selected.delete(id);
      box.closest(".draft-item")?.classList.toggle("selected", box.checked);
      updateActions(container);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".draft-confirm-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const draft = drafts.find((d) => d.id === btn.dataset.id);
      if (draft) void openConfirm(draft);
    });
  });
  container.querySelector("#draftMergeBtn")?.addEventListener("click", () => {
    const chosen = drafts.filter((d) => selected.has(d.id));
    if (chosen.length >= 2) confirmMerge(chosen);
  });
  container.querySelector("#draftDiscardBtn")?.addEventListener("click", () => {
    const chosen = drafts.filter((d) => selected.has(d.id));
    if (chosen.length > 0) confirmDiscard(chosen);
  });
}

function updateActions(container: HTMLElement) {
  const merge = container.querySelector<HTMLButtonElement>("#draftMergeBtn");
  const discard = container.querySelector<HTMLButtonElement>("#draftDiscardBtn");
  if (merge) merge.disabled = busy || selected.size < 2;
  if (discard) discard.disabled = busy || selected.size === 0;
}

async function rerender() {
  if (mounted?.isConnected) await renderDraftInbox(mounted);
  else await refreshDraftCount();
}

async function run<T>(work: () => Promise<T>): Promise<T> {
  busy = true;
  if (mounted) updateActions(mounted);
  try {
    return await work();
  } finally {
    busy = false;
  }
}

function confirmMerge(chosen: Draft[]) {
  const live = chosen.some((d) => d.in_progress);
  showConfirmationModal({
    title: "Merge drafts",
    message: `Merge ${chosen.length} drafts into one, from ${time(chosen[chosen.length - 1].start_time)}? Their active time is added up; the gaps between them don't count.${
      live ? " The draft being recorded ends here." : ""
    }`,
    confirmText: "Merge",
    onConfirm: async () => {
      const kept = await run(() =>
        safeIpcInvoke<string | null>("merge-draft-sessions", [chosen.map((d) => d.id)], {
          fallback: null,
        }),
      );
      if (kept) {
        selected.clear();
        selected.add(kept);
        showInAppNotification(`Merged ${chosen.length} drafts`);
      } else {
        showInAppNotification("Could not merge the drafts.", 4000, "error");
      }
      await rerender();
    },
  });
}

function confirmDiscard(chosen: Draft[]) {
  const n = chosen.length;
  showConfirmationModal({
    title: "Discard drafts",
    message: `Discard ${n} draft${n === 1 ? "" : "s"}? This time won't be recorded. This cannot be undone.`,
    confirmText: `Discard ${n}`,
    confirmClass: "btn-delete",
    onConfirm: async () => {
      const removed = await run(() =>
        safeIpcInvoke<number>("discard-draft-sessions", [chosen.map((d) => d.id)], {
          fallback: 0,
        }),
      );
      if (removed > 0) {
        for (const d of chosen) selected.delete(d.id);
        showInAppNotification(`Discarded ${removed} draft${removed === 1 ? "" : "s"}`);
      } else {
        showInAppNotification("Could not discard the drafts.", 4000, "error");
      }
      await rerender();
    },
  });
}

async function openConfirm(draft: Draft) {
  const projects = (
    await safeIpcInvoke<Project[]>("get-projects-for-user", [], { fallback: [] })
  ).filter((p) => (p as { is_active?: boolean }).is_active !== false);
  const hasRate = (id: string) =>
    projects.find((p) => p.id === id)?.hourly_rate != null;

  // Read straight from these elements: showModal doesn't collect checkboxes
  const form = document.createElement("div");
  form.className = "draft-confirm-form";
  form.innerHTML = `
    <p class="draft-confirm-when">${escapeHtml(whenText(draft))} · ${escapeHtml(formatSpan(draft.duration ?? 0))} active</p>
    ${draft.in_progress ? `<p class="draft-confirm-note">This draft is still being recorded; confirming ends it here.</p>` : ""}
    <label for="draftTitle">Title</label>
    <input type="text" id="draftTitle" maxlength="200" required>
    <label for="draftProject">Project</label>
    <select id="draftProject">
      <option value="">No project</option>
      ${projects.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("")}
    </select>
    <label class="draft-billable"><input type="checkbox" id="draftBillable"> Billable</label>
    <label for="draftDescription">Description</label>
    <textarea id="draftDescription" maxlength="2000"></textarea>`;
  const title = form.querySelector<HTMLInputElement>("#draftTitle")!;
  const project = form.querySelector<HTMLSelectElement>("#draftProject")!;
  const billable = form.querySelector<HTMLInputElement>("#draftBillable")!;
  const description = form.querySelector<HTMLTextAreaElement>("#draftDescription")!;
  title.value = draft.title ?? "";
  if (draft.project_id && projects.some((p) => p.id === draft.project_id)) {
    project.value = draft.project_id;
  }
  // As in the Stop dialog: a project with a rate is usually billed
  billable.checked = project.value !== "" && hasRate(project.value);
  project.addEventListener("change", () => {
    billable.checked = project.value !== "" && hasRate(project.value);
  });

  showModal({
    title: "Confirm session",
    fields: [{ name: "draft", label: "", type: "custom", render: () => form }],
    submitText: "Confirm",
    onSubmit: async () => {
      const ok = await run(() =>
        safeIpcInvoke<boolean>(
          "confirm-draft-session",
          [
            {
              id: draft.id,
              title: title.value.trim() || "Untitled Session",
              description: description.value.trim(),
              projectId: project.value || null,
              isBillable: billable.checked,
            },
          ],
          { fallback: false },
        ),
      );
      if (ok) {
        selected.delete(draft.id);
        showInAppNotification("Session confirmed");
        // It now counts: everything that lists or sums sessions is stale
        refreshPages("summary", "dashboard", "insights", "projects", "billing", "teamAnalytics");
      } else {
        showInAppNotification("Could not confirm the draft.", 4000, "error");
      }
      await rerender();
    },
  });
}

// A draft was saved (new, or grown), or the count changed under the list:
// refresh it, unless the user is in the middle of choosing some
const refreshIdle = () => {
  if (mounted?.isConnected && selected.size === 0 && !busy) {
    void renderDraftInbox(mounted);
  }
};
onDraftSaved(refreshIdle);
onDraftCount((n) => {
  if (n !== shown) refreshIdle();
});
