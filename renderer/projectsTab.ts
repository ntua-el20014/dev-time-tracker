/**
 * Projects: the one place to create, edit, archive and staff projects,
 * personal and organization alike (the Team view links here).
 *
 * What each button may do follows the database rules (database/schema.sql):
 * - edit: the project's manager, or an org admin for org projects
 * - archive/restore: the project's manager, or an org admin/manager
 * - members: org projects only (a personal project is visible to its owner
 *   alone), and only the project's manager may change them
 *
 * Each card also lists the git repos the user linked to it (from Home or
 * the Stop dialog); links are per user, so anyone may unlink their own.
 */
import { escapeHtml } from "./utils/domUtils";
import {
  getCurrentUserIdSafe,
  getCurrentUserRole,
  safeIpcInvoke,
  withLoading,
} from "./utils";
import { showInAppNotification, showConfirmationModal } from "./components";
import { isNavItemVisible, markTabsDirty } from "./navigation";
import type {
  CloudProjectWithManager,
  ProjectMemberWithUser,
  UserProfile,
} from "../src/types/organization.types";

type Project = CloudProjectWithManager & { members?: ProjectMemberWithUser[] };
type RepoLink = { repo_key: string; repo_name: string; project_id: string };
type Role = "admin" | "manager" | "employee";

let projects: Project[] = [];
let repoLinks: RepoLink[] = [];
let role: Role = "employee";
let me = "";
let showArchived = false;
let listenerInstalled = false;

const isArchived = (p: Project) => !!p.archived || !p.is_active;
const isOrgAdminOrManager = () => role === "admin" || role === "manager";

function canEdit(p: Project): boolean {
  return p.manager_id === me || (p.scope === "organization" && role === "admin");
}

function canArchive(p: Project): boolean {
  return (
    p.manager_id === me || (p.scope === "organization" && isOrgAdminOrManager())
  );
}

function canManageMembers(p: Project): boolean {
  return p.scope === "organization" && p.manager_id === me;
}

/** Org projects only make sense once there is a team to share them with. */
function canCreateOrgProjects(): boolean {
  return isOrgAdminOrManager() && isNavItemVisible("team");
}

function findProject(id: string | undefined): Project | undefined {
  return projects.find((p) => p.id === id);
}

/** Other pages show project names, colors and rates. */
function projectsChanged() {
  markTabsDirty("billing", "summary", "dashboard");
  void renderProjects();
}

export async function renderProjects() {
  const container = document.getElementById("projectsContent");
  if (!container) return;

  await withLoading(container, "Loading projects…", async () => {
    me = getCurrentUserIdSafe() ?? "";
    role = (await getCurrentUserRole()) as Role;
    [projects, repoLinks] = await Promise.all([
      safeIpcInvoke<Project[]>("get-all-projects-with-members", [], { fallback: [] }),
      safeIpcInvoke<RepoLink[]>("get-repo-links", [], {
        fallback: [],
        showNotification: false,
      }),
    ]);
  });

  const active = projects.filter((p) => !isArchived(p));
  const archived = projects.filter(isArchived);
  const shown = showArchived ? archived : active;

  container.innerHTML = `
    <div class="projects-container">
      <div class="projects-header">
        <h1>Projects</h1>
        <div class="projects-header-actions">
          <button id="newProjectBtn" class="btn-primary">+ New Project</button>
        </div>
      </div>

      <div class="projects-tabs" role="tablist">
        <button class="projects-tab-btn ${showArchived ? "" : "active"}" data-filter="active" role="tab">Active (${active.length})</button>
        <button class="projects-tab-btn ${showArchived ? "active" : ""}" data-filter="archived" role="tab">Archived (${archived.length})</button>
      </div>

      <div class="projects-section">
        ${renderGroups(shown)}
      </div>
    </div>
  `;

  if (!listenerInstalled) {
    container.addEventListener("click", onProjectsClick);
    listenerInstalled = true;
  }
}

function renderGroups(list: Project[]): string {
  if (list.length === 0) {
    return showArchived
      ? `<div class="empty-state"><h3>No archived projects</h3></div>`
      : `<div class="empty-state">
           <h3>No projects yet</h3>
           <p>Create a project to group sessions, set an hourly rate and invoice the time.</p>
         </div>`;
  }
  const personal = list.filter((p) => p.scope !== "organization");
  const org = list.filter((p) => p.scope === "organization");
  const grid = (items: Project[]) =>
    `<div class="projects-grid">${items.map(renderCard).join("")}</div>`;
  if (org.length === 0) return grid(personal);
  return `
    ${personal.length ? `<h2 class="projects-group-title">Personal</h2>${grid(personal)}` : ""}
    <h2 class="projects-group-title">Organization</h2>${grid(org)}
  `;
}

function renderCard(p: Project): string {
  const id = escapeHtml(p.id);
  const archived = isArchived(p);
  const isOrg = p.scope === "organization";
  const memberCount = p.members?.length ?? 0;
  const actions = [
    canEdit(p)
      ? `<button class="project-action-btn" data-action="edit" data-project-id="${id}" title="Edit project">✏️</button>`
      : "",
    canManageMembers(p)
      ? `<button class="project-action-btn" data-action="members" data-project-id="${id}" title="Manage members">👥</button>`
      : "",
    canArchive(p)
      ? archived
        ? `<button class="project-action-btn" data-action="restore" data-project-id="${id}" title="Restore project">↩️</button>`
        : `<button class="project-action-btn" data-action="archive" data-project-id="${id}" title="Archive project">📦</button>`
      : "",
  ].join("");

  return `
    <div class="project-card" data-project-id="${id}">
      <div class="project-card-header">
        <div class="project-color" style="background-color: ${escapeHtml(p.color || "#3b82f6")}"></div>
        <h3 class="project-name">${escapeHtml(p.name)}</h3>
        <span class="project-scope-badge scope-${isOrg ? "organization" : "personal"}">${isOrg ? "Org" : "Personal"}</span>
        ${actions ? `<div class="project-actions">${actions}</div>` : ""}
      </div>

      <div class="project-card-content">
        ${
          p.description
            ? `<p class="project-description">${escapeHtml(p.description)}</p>`
            : `<p class="project-description empty">No description</p>`
        }
        <div class="project-meta">
          <div class="project-meta-item">
            <span class="meta-label">Hourly rate:</span>
            <span class="meta-value">${
              p.hourly_rate != null
                ? `$${Number(p.hourly_rate).toFixed(2)}`
                : "Not set"
            }</span>
          </div>
          ${
            isOrg
              ? `<div class="project-meta-item">
                   <span class="meta-label">Manager:</span>
                   <span class="meta-value">${escapeHtml(p.manager?.username || "Unknown")}</span>
                 </div>
                 <div class="project-meta-item">
                   <span class="meta-label">Members:</span>
                   <span class="meta-value">${memberCount} ${memberCount === 1 ? "member" : "members"}</span>
                 </div>`
              : ""
          }
          <div class="project-meta-item">
            <span class="meta-label">Repos:</span>
            <span class="meta-value">${renderRepoLinks(p)}</span>
          </div>
          <div class="project-meta-item">
            <span class="meta-label">Created:</span>
            <span class="meta-value">${new Date(p.created_at).toLocaleDateString()}</span>
          </div>
        </div>
        <button class="project-stats-btn" data-action="stats" data-project-id="${id}">
          View Statistics
        </button>
      </div>
    </div>
  `;
}

function renderRepoLinks(p: Project): string {
  const links = repoLinks.filter((l) => l.project_id === p.id);
  if (links.length === 0) {
    return `<span class="project-repos-empty" title="Work in a repo, then link it from Home or when you stop a session">Not linked</span>`;
  }
  return links
    .map((l) => {
      const name = escapeHtml(l.repo_name);
      return `<span class="project-repo-chip" title="${escapeHtml(l.repo_key)}">${name}<button class="project-repo-unlink" data-action="unlink-repo" data-project-id="${escapeHtml(p.id)}" data-repo-key="${escapeHtml(l.repo_key)}" title="Unlink ${name}" aria-label="Unlink ${name}">×</button></span>`;
    })
    .join(" ");
}

async function unlinkRepo(repoKey: string) {
  const ok = await safeIpcInvoke<boolean>("unlink-repo", [repoKey], { fallback: false });
  if (!ok) {
    showInAppNotification("Could not unlink the repo.", 3500, "error");
    return;
  }
  void renderProjects();
}

function onProjectsClick(e: Event) {
  const target = e.target as HTMLElement;

  if (target.closest("#newProjectBtn")) {
    showProjectForm();
    return;
  }

  const filterBtn = target.closest<HTMLElement>("[data-filter]");
  if (filterBtn) {
    showArchived = filterBtn.dataset.filter === "archived";
    void renderProjects();
    return;
  }

  const actionBtn = target.closest<HTMLElement>("[data-action]");
  const project = findProject(actionBtn?.dataset.projectId);
  if (!actionBtn || !project) return;
  switch (actionBtn.dataset.action) {
    case "edit":
      showProjectForm(project);
      break;
    case "members":
      void showMembersModal(project);
      break;
    case "archive":
      confirmArchive(project, true);
      break;
    case "restore":
      confirmArchive(project, false);
      break;
    case "stats":
      void showStatsModal(project);
      break;
    case "unlink-repo":
      if (actionBtn.dataset.repoKey) void unlinkRepo(actionBtn.dataset.repoKey);
      break;
  }
}

// ── Modals ──────────────────────────────────────────────────────────

/** Open a modal; returns its content element and a close function. */
function openModal(title: string, bodyHtml: string, onClose?: () => void) {
  document.getElementById("customModal")?.remove();
  document.getElementById("customModalOverlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "customModalOverlay";
  overlay.className = "custom-modal-overlay";
  overlay.style.display = "block";

  const modal = document.createElement("div");
  modal.id = "customModal";
  modal.className = "active";
  modal.innerHTML = `
    <div class="session-modal-content">
      <button class="modal-close-btn" aria-label="Close">&times;</button>
      <h2>${escapeHtml(title)}</h2>
      <div class="project-modal-body">${bodyHtml}</div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.appendChild(modal);

  const content = modal.querySelector(".session-modal-content") as HTMLElement;
  const close = () => {
    modal.remove();
    overlay.remove();
    onClose?.();
  };
  modal.querySelector(".modal-close-btn")?.addEventListener("click", close);
  overlay.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  return {
    body: modal.querySelector(".project-modal-body") as HTMLElement,
    content,
    close,
  };
}

function showProjectForm(project?: Project) {
  const editing = !!project;
  const offerScope = !editing && canCreateOrgProjects();
  const { body, close } = openModal(
    editing ? "Edit Project" : "New Project",
    `
    <form id="projectForm">
      <div style="margin-bottom: 15px;">
        <label for="project-name">Project name *</label><br>
        <input id="project-name" name="name" type="text" required value="${escapeHtml(project?.name ?? "")}">
      </div>
      <div style="margin-bottom: 15px;">
        <label for="project-description">Description</label><br>
        <textarea id="project-description" name="description">${escapeHtml(project?.description ?? "")}</textarea>
      </div>
      <div style="margin-bottom: 15px;">
        <label for="project-color">Color</label><br>
        <div class="color-picker-container">
          <input id="project-color" name="color" type="color" value="${escapeHtml(project?.color || "#3b82f6")}">
        </div>
      </div>
      <div style="margin-bottom: 15px;">
        <label for="project-hourly-rate">Hourly rate (optional)</label><br>
        <input id="project-hourly-rate" name="hourlyRate" type="number" min="0" step="0.01" placeholder="e.g. 75.00" value="${project?.hourly_rate ?? ""}">
      </div>
      ${
        offerScope
          ? `<fieldset style="margin-bottom: 15px; border: none; padding: 0;">
               <legend>Who is it for?</legend>
               <label><input type="radio" name="scope" value="personal" checked> Just me (personal)</label><br>
               <label><input type="radio" name="scope" value="organization"> My organization (team members can be added)</label>
             </fieldset>`
          : ""
      }
      <div class="session-modal-actions">
        <button type="button" id="projectCancelBtn" class="btn-cancel">Cancel</button>
        <button type="submit" class="btn-confirm">${editing ? "Save" : "Create Project"}</button>
      </div>
    </form>
    `,
  );

  const form = body.querySelector("#projectForm") as HTMLFormElement;
  body.querySelector("#projectCancelBtn")?.addEventListener("click", close);
  setTimeout(
    () => (body.querySelector("#project-name") as HTMLInputElement)?.focus(),
    50,
  );

  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const rateText = String(data.get("hourlyRate") ?? "").trim();
    const rate = rateText ? Number(rateText) : null;
    const hourlyRate = rate !== null && Number.isFinite(rate) ? rate : null;
    const name = String(data.get("name") ?? "").trim();
    const description = String(data.get("description") ?? "");
    const color = String(data.get("color") ?? "#3b82f6");

    const result = editing
      ? await safeIpcInvoke(
          "update-project",
          [project!.id, name, description, color, hourlyRate],
          { fallback: null },
        )
      : await safeIpcInvoke(
          "create-project",
          [
            name,
            description,
            color,
            hourlyRate,
            String(data.get("scope") ?? "personal"),
          ],
          { fallback: null },
        );
    if (!result) {
      showInAppNotification(
        editing ? "Could not save the project." : "Could not create the project.",
        4000,
        "error",
      );
      return;
    }
    close();
    showInAppNotification(editing ? "Project saved." : "Project created.", 2000);
    projectsChanged();
  };
}

function confirmArchive(project: Project, archive: boolean) {
  showConfirmationModal({
    title: archive ? "Archive Project" : "Restore Project",
    message: archive
      ? `Archive "${project.name}"? It disappears from project pickers; its sessions and history are kept.`
      : `Restore "${project.name}" to active projects?`,
    confirmText: archive ? "Archive" : "Restore",
    onConfirm: async () => {
      const ok = await safeIpcInvoke(
        archive ? "delete-project" : "restore-project",
        [project.id],
        { fallback: false },
      );
      if (!ok) {
        showInAppNotification(
          `Could not ${archive ? "archive" : "restore"} the project.`,
          4000,
          "error",
        );
        return;
      }
      showInAppNotification(
        archive ? "Project archived." : "Project restored.",
        2000,
      );
      projectsChanged();
    },
  });
}

async function showStatsModal(project: Project) {
  const stats = await safeIpcInvoke(
    "get-project-stats",
    [project.id],
    {
      fallback: {
        total_sessions: 0,
        total_time: 0,
        member_count: 0,
        last_activity: null,
      },
    },
  );
  const hours = Math.floor(stats.total_time / 3600);
  const minutes = Math.floor((stats.total_time % 3600) / 60);
  const { body, close } = openModal(
    `${project.name} — Statistics`,
    `
    <div class="project-stats-modal">
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-value">${Number(stats.total_sessions)}</div>
          <div class="stat-label">Sessions</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${hours}h ${minutes}m</div>
          <div class="stat-label">Total time</div>
        </div>
        ${
          project.scope === "organization"
            ? `<div class="stat-item">
                 <div class="stat-value">${Number(stats.member_count)}</div>
                 <div class="stat-label">Members</div>
               </div>`
            : ""
        }
      </div>
      ${
        stats.last_activity
          ? `<div class="stats-timeline"><div class="timeline-item"><strong>Last activity:</strong> ${new Date(stats.last_activity).toLocaleDateString()}</div></div>`
          : `<div class="empty-stats"><p>No sessions recorded for this project yet.</p></div>`
      }
      <div class="session-modal-actions">
        <button type="button" id="statsCloseBtn" class="btn-cancel">Close</button>
      </div>
    </div>
    `,
  );
  body.querySelector("#statsCloseBtn")?.addEventListener("click", close);
}

async function showMembersModal(project: Project) {
  let changed = false;
  const { body, close } = openModal(
    `Members — ${project.name}`,
    `<div class="members-modal-content"></div>`,
    () => {
      if (changed) projectsChanged();
    },
  );
  const content = body.querySelector(".members-modal-content") as HTMLElement;

  const draw = async () => {
    const [members, orgUsers] = await Promise.all([
      safeIpcInvoke<ProjectMemberWithUser[]>(
        "get-project-members",
        [project.id],
        { fallback: [] },
      ),
      safeIpcInvoke<UserProfile[]>("get-all-users", [], { fallback: [] }),
    ]);
    const memberIds = new Set(members.map((m) => m.user_id));
    const available = orgUsers.filter((u) => !memberIds.has(u.id));
    // Only org admins/managers can be project managers
    const mayManage = (userRole?: string) =>
      userRole === "admin" || userRole === "manager";

    content.innerHTML = `
      <div class="members-section">
        <h3>Current members</h3>
        <div class="members-list">
          ${
            members.length === 0
              ? "<p><em>No members yet.</em></p>"
              : members
                  .map((m) => {
                    const uid = escapeHtml(m.user_id);
                    const name = escapeHtml(m.user?.username || "Unknown");
                    if (m.user_id === project.manager_id) {
                      return `<div class="member-item"><span class="member-info">👑 ${name}</span><span class="manager-label">Project manager</span></div>`;
                    }
                    return `
                      <div class="member-item">
                        <span class="member-info">${m.role === "manager" ? "👑" : "👤"} ${name}</span>
                        <div class="member-actions">
                          <select class="member-role-select" data-user-id="${uid}" aria-label="Role for ${name}">
                            <option value="member" ${m.role === "member" ? "selected" : ""}>Member</option>
                            ${mayManage(m.user?.role) ? `<option value="manager" ${m.role === "manager" ? "selected" : ""}>Manager</option>` : ""}
                          </select>
                          <button type="button" class="btn-remove-member" data-user-id="${uid}" data-name="${name}">Remove</button>
                        </div>
                      </div>`;
                  })
                  .join("")
          }
        </div>
      </div>
      ${
        available.length > 0
          ? `<div class="add-member-section">
               <h3>Add a member</h3>
               <div class="add-member-form">
                 <select id="addMemberUser" aria-label="Organization member">
                   ${available.map((u) => `<option value="${escapeHtml(u.id)}" data-role="${escapeHtml(u.role)}">${escapeHtml(u.username)}</option>`).join("")}
                 </select>
                 <select id="addMemberRole" aria-label="Project role">
                   <option value="member">Member</option>
                   <option value="manager">Manager</option>
                 </select>
                 <button type="button" id="addMemberBtn" class="btn-confirm">Add</button>
               </div>
               <p class="info-note" style="margin-top: 10px; font-size: 12px;">
                 Only organization admins and managers can be project managers.
               </p>
             </div>`
          : "<p><em>Everyone in your organization is already on this project.</em></p>"
      }
      <div class="session-modal-actions">
        <button type="button" id="membersCloseBtn" class="btn-cancel">Close</button>
      </div>
    `;

    content.querySelector("#membersCloseBtn")?.addEventListener("click", close);

    const userSelect = content.querySelector<HTMLSelectElement>("#addMemberUser");
    const roleSelect = content.querySelector<HTMLSelectElement>("#addMemberRole");
    const syncRoleChoice = () => {
      const userRole = userSelect?.selectedOptions[0]?.dataset.role;
      const managerOpt = roleSelect?.querySelector<HTMLOptionElement>(
        'option[value="manager"]',
      );
      if (managerOpt) managerOpt.disabled = !mayManage(userRole);
      if (roleSelect && managerOpt?.disabled) roleSelect.value = "member";
    };
    userSelect?.addEventListener("change", syncRoleChoice);
    syncRoleChoice();

    content.querySelector("#addMemberBtn")?.addEventListener("click", async () => {
      if (!userSelect?.value) return;
      const added = await safeIpcInvoke(
        "add-project-member",
        [project.id, userSelect.value, roleSelect?.value || "member"],
        { fallback: null },
      );
      if (!added) {
        showInAppNotification("Could not add the member.", 4000, "error");
        return;
      }
      changed = true;
      showInAppNotification("Member added.", 2000);
      await draw();
    });

    content
      .querySelectorAll<HTMLSelectElement>(".member-role-select")
      .forEach((select) => {
        const previous = select.value;
        select.addEventListener("change", async () => {
          const updated = await safeIpcInvoke(
            "update-project-member-role",
            [project.id, select.dataset.userId, select.value],
            { fallback: null },
          );
          if (!updated) {
            select.value = previous;
            showInAppNotification("Could not change the role.", 4000, "error");
            return;
          }
          changed = true;
          showInAppNotification("Role updated.", 2000);
          await draw();
        });
      });

    content
      .querySelectorAll<HTMLButtonElement>(".btn-remove-member")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          const removed = await safeIpcInvoke(
            "remove-project-member",
            [project.id, btn.dataset.userId],
            { fallback: false },
          );
          if (!removed) {
            showInAppNotification("Could not remove the member.", 4000, "error");
            return;
          }
          changed = true;
          showInAppNotification(`${btn.dataset.name ?? "Member"} removed.`, 2000);
          await draw();
        });
      });
  };

  await withLoading(content, "Loading members…", draw);
}
