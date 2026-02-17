/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  showNotification,
  showConfirmationModal,
  showModal,
} from "./components";
import {
  getCurrentOrganization,
  getOrganizationMembers,
  createTeamOrganization,
  requestToJoinOrganization,
  getPendingJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
  updateUserRole,
  removeUserFromOrganization,
  getCurrentUserProfile,
  getOrganizationById,
  getOrganizationProjects,
  createCloudProject,
  updateCloudProject,
  getProjectMembers,
  assignMemberToProject,
  removeMemberFromProject,
  updateProjectMemberRole,
} from "./utils/organizationApi";
import type {
  Organization,
  UserProfile,
  OrgJoinRequestWithUser,
  CloudProjectWithManager,
  ProjectMemberWithUser,
} from "../src/types/organization.types";

let currentOrg: Organization | null = null;
let currentUserProfile: UserProfile | null = null;
let orgMembers: UserProfile[] = [];
let pendingRequests: OrgJoinRequestWithUser[] = [];
let cloudProjects: CloudProjectWithManager[] = [];
let cleanupFunctions: (() => void)[] = [];
let isMemberModalOpen = false;

/**
 * Main render function for Organization Tab
 */
export async function renderOrganizationTab() {
  const container = document.getElementById("organizationContent");
  if (!container) return;

  // Cleanup previous event listeners
  cleanupFunctions.forEach((cleanup) => cleanup());
  cleanupFunctions = [];

  // Show loading state
  container.innerHTML = `
    <div class="org-loading">
      <p>Loading organization...</p>
    </div>
  `;

  try {
    // Fetch data
    currentUserProfile = await getCurrentUserProfile();
    currentOrg = await getCurrentOrganization();

    if (!currentOrg || !currentUserProfile) {
      container.innerHTML = `
        <div class="org-error">
          <h3>No organization found</h3>
        </div>
      `;
      return;
    }

    // Fetch members and requests
    orgMembers = await getOrganizationMembers(currentOrg.id);
    if (isAdmin()) {
      pendingRequests = await getPendingJoinRequests();
    }

    // Fetch cloud projects if user can manage them
    if (isAdmin() || isManager()) {
      cloudProjects = await getOrganizationProjects();
    }

    // Render all sections
    container.innerHTML = `
      <div id="org-inner">
        <h1 class="org-title">Organization Management</h1>
        <div id="org-info-section"></div>
        <div id="org-members-section"></div>
        <div id="org-projects-section"></div>
        <div id="org-join-section"></div>
        <div id="org-requests-section"></div>
      </div>
    `;

    renderOrganizationInfo();
    renderMembersList();
    if (isAdmin() || isManager()) {
      renderCloudProjects();
    }
    renderJoinForm();
    if (isAdmin()) {
      renderJoinRequests();
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error rendering organization tab:", error);
    container.innerHTML = `
      <div class="org-error">
        <p>Error loading organization: ${
          error instanceof Error ? error.message : "Unknown error"
        }</p>
      </div>
    `;
  }
}

/**
 * Render organization information section
 */
function renderOrganizationInfo() {
  const container = document.getElementById("org-info-section");
  if (!container || !currentOrg) return;

  const stats = calculateOrgStats();
  const orgType = currentOrg.name.includes("Personal") ? "Personal" : "Team";

  container.innerHTML = `
    <div class="org-section">
      <h2>📊 Current Organization</h2>
      <div class="org-info-card">
        <div class="org-info-grid">
          <div class="org-info-item">
            <label>Name:</label>
            <span>${escapeHtml(currentOrg.name)}</span>
          </div>
          <div class="org-info-item">
            <label>Type:</label>
            <span>${orgType}</span>
          </div>
          <div class="org-info-item">
            <label>Members:</label>
            <span>${stats.total} (${stats.admins} admin, ${
              stats.managers
            } manager, ${stats.employees} employee)</span>
          </div>
          <div class="org-info-item">
            <label>Organization ID:</label>
            <span class="org-uuid-wrapper">
              <span class="org-uuid" title="${currentOrg.id}">${
                currentOrg.id
              }</span>
              <button id="copy-org-id-btn" class="copy-icon-btn" title="Copy Organization ID">
                📋
              </button>
            </span>
          </div>
        </div>
        <div class="org-actions">
          ${
            orgType === "Personal"
              ? '<button id="create-team-org-btn" class="btn btn-primary">Create Team Organization</button>'
              : ""
          }
        </div>
      </div>
    </div>
  `;

  // Setup event listeners
  const createBtn = document.getElementById("create-team-org-btn");
  if (createBtn) {
    const handleCreate = () => showCreateOrgModal();
    createBtn.addEventListener("click", handleCreate);
    cleanupFunctions.push(() =>
      createBtn.removeEventListener("click", handleCreate),
    );
  }

  const copyBtn = document.getElementById("copy-org-id-btn");
  if (copyBtn) {
    const handleCopy = () => copyOrgId();
    copyBtn.addEventListener("click", handleCopy);
    cleanupFunctions.push(() =>
      copyBtn.removeEventListener("click", handleCopy),
    );
  }
}

/**
 * Render members list section
 */
function renderMembersList() {
  const container = document.getElementById("org-members-section");
  if (!container || !currentUserProfile) return;

  const canManageMembers = isAdmin();
  const canViewDetails = isAdmin() || isManager();

  container.innerHTML = `
    <div class="org-section">
      <h2>👥 Members</h2>
      <div class="org-members-card">
        <table class="org-members-table">
          <thead>
            <tr>
              <th>Username</th>
              ${canViewDetails ? "<th>Email</th>" : ""}
              <th>Role</th>
              ${canManageMembers ? "<th>Actions</th>" : ""}
            </tr>
          </thead>
          <tbody>
            ${orgMembers
              .map(
                (member) => `
              <tr>
                <td>${escapeHtml(member.username)}</td>
                ${
                  canViewDetails
                    ? `<td>${escapeHtml(member.email || "N/A")}</td>`
                    : ""
                }
                <td>
                  ${
                    canManageMembers && member.id !== currentUserProfile?.id
                      ? `
                    <select class="role-select" data-user-id="${
                      member.id
                    }" data-current-role="${member.role}">
                      <option value="admin" ${
                        member.role === "admin" ? "selected" : ""
                      }>Admin</option>
                      <option value="manager" ${
                        member.role === "manager" ? "selected" : ""
                      }>Manager</option>
                      <option value="employee" ${
                        member.role === "employee" ? "selected" : ""
                      }>Employee</option>
                    </select>
                  `
                      : `<span class="role-badge role-${member.role}">${member.role}</span>`
                  }
                </td>
                ${
                  canManageMembers
                    ? `
                  <td>
                    ${
                      member.id !== currentUserProfile?.id
                        ? `<button class="btn btn-danger btn-sm remove-member-btn" data-user-id="${
                            member.id
                          }" data-username="${escapeHtml(
                            member.username,
                          )}">Remove</button>`
                        : `<span class="text-muted">You</span>`
                    }
                  </td>
                `
                    : ""
                }
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Setup event listeners for role changes
  if (canManageMembers) {
    const roleSelects = container.querySelectorAll(".role-select");
    roleSelects.forEach((select) => {
      const handleChange = (e: Event) =>
        handleRoleChange(e.target as HTMLSelectElement);
      select.addEventListener("change", handleChange);
      cleanupFunctions.push(() =>
        select.removeEventListener("change", handleChange),
      );
    });

    const removeButtons = container.querySelectorAll(".remove-member-btn");
    removeButtons.forEach((btn) => {
      const handleRemove = () =>
        handleRemoveMember(
          btn.getAttribute("data-user-id")!,
          btn.getAttribute("data-username")!,
        );
      btn.addEventListener("click", handleRemove);
      cleanupFunctions.push(() =>
        btn.removeEventListener("click", handleRemove),
      );
    });
  }
}

/**
 * Render join organization form
 */
function renderJoinForm() {
  const container = document.getElementById("org-join-section");
  if (!container) return;

  container.innerHTML = `
    <div class="org-section">
      <h2>🔗 Join Organization</h2>
      <div class="org-join-card">
        <p>Enter an organization ID to request to join:</p>
        <div class="org-join-form">
          <input type="text" id="join-org-input" class="org-input" placeholder="Enter Organization UUID" />
          <button id="join-org-btn" class="btn btn-primary">Join</button>
        </div>
      </div>
    </div>
  `;

  const joinBtn = document.getElementById("join-org-btn");
  const joinInput = document.getElementById(
    "join-org-input",
  ) as HTMLInputElement;

  if (joinBtn && joinInput) {
    const handleJoin = () => handleJoinOrganization(joinInput.value.trim());
    joinBtn.addEventListener("click", handleJoin);

    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === "Enter") handleJoin();
    };
    joinInput.addEventListener("keypress", handleKeyPress);

    cleanupFunctions.push(() => {
      joinBtn.removeEventListener("click", handleJoin);
      joinInput.removeEventListener("keypress", handleKeyPress);
    });
  }
}

/**
 * Render join requests section (admin only)
 */
function renderJoinRequests() {
  const container = document.getElementById("org-requests-section");
  if (!container || !isAdmin()) return;

  if (pendingRequests.length === 0) {
    container.innerHTML = `
      <div class="org-section">
        <h2>📨 Join Requests</h2>
        <div class="org-requests-card">
          <p class="text-muted">No pending join requests</p>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="org-section">
      <h2>📨 Join Requests (${pendingRequests.length} pending)</h2>
      <div class="org-requests-card">
        <table class="org-requests-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Email</th>
              <th>Requested</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${pendingRequests
              .map(
                (req) => `
              <tr>
                <td>${escapeHtml(req.user?.username || "Unknown")}</td>
                <td>${escapeHtml(req.user?.email || "N/A")}</td>
                <td>${formatTimeAgo(req.requested_at)}</td>
                <td>
                  <button class="btn btn-success btn-sm approve-btn" data-request-id="${
                    req.id
                  }">✓ Approve</button>
                  <button class="btn btn-danger btn-sm reject-btn" data-request-id="${
                    req.id
                  }">✕ Reject</button>
                </td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Setup event listeners
  const approveButtons = container.querySelectorAll(".approve-btn");
  approveButtons.forEach((btn) => {
    const handleApprove = () =>
      handleApproveRequest(btn.getAttribute("data-request-id")!);
    btn.addEventListener("click", handleApprove);
    cleanupFunctions.push(() =>
      btn.removeEventListener("click", handleApprove),
    );
  });

  const rejectButtons = container.querySelectorAll(".reject-btn");
  rejectButtons.forEach((btn) => {
    const handleReject = () =>
      handleRejectRequest(btn.getAttribute("data-request-id")!);
    btn.addEventListener("click", handleReject);
    cleanupFunctions.push(() => btn.removeEventListener("click", handleReject));
  });
}

/**
 * Render cloud projects section (admin/manager)
 */
function renderCloudProjects() {
  const container = document.getElementById("org-projects-section");
  if (!container || !currentOrg) return;

  const canManage = isAdmin() || isManager();
  if (!canManage) return;

  const activeProjects = cloudProjects.filter((p) => p.is_active);
  const archivedProjects = cloudProjects.filter((p) => !p.is_active);

  container.innerHTML = `
    <div class="org-section">
      <h2>📂 Organization Projects</h2>
      <div class="org-projects-header">
        <div class="projects-stats-inline">
          <div class="stat-inline">
            <span class="stat-number">${activeProjects.length}</span>
            <span class="stat-label">Active</span>
          </div>
          <div class="stat-inline">
            <span class="stat-number">${archivedProjects.length}</span>
            <span class="stat-label">Archived</span>
          </div>
          <div class="stat-inline">
            <span class="stat-number">${cloudProjects.length}</span>
            <span class="stat-label">Total</span>
          </div>
        </div>
        <button id="new-cloud-project-btn" class="btn btn-primary">+ New Project</button>
      </div>
      
      <div class="projects-tabs">
        <button class="projects-tab-btn active" data-tab="active">Active Projects (${
          activeProjects.length
        })</button>
        <button class="projects-tab-btn" data-tab="archived">Archived Projects (${
          archivedProjects.length
        })</button>
      </div>
      
      <div id="active-cloud-projects" class="projects-list">
        ${renderProjectsList(activeProjects)}
      </div>
      
      <div id="archived-cloud-projects" class="projects-list" style="display: none;">
        ${renderProjectsList(archivedProjects)}
      </div>
    </div>
  `;

  // Setup event listeners
  const newProjectBtn = document.getElementById("new-cloud-project-btn");
  if (newProjectBtn) {
    const handleNewProject = () => showCreateCloudProjectModal();
    newProjectBtn.addEventListener("click", handleNewProject);
    cleanupFunctions.push(() =>
      newProjectBtn.removeEventListener("click", handleNewProject),
    );
  }

  // Tab switching
  const tabButtons = container.querySelectorAll(".projects-tab-btn");
  tabButtons.forEach((btn) => {
    const handleTabClick = () => {
      const target = btn as HTMLButtonElement;
      const tabType = target.dataset.tab;

      tabButtons.forEach((b) => b.classList.remove("active"));
      target.classList.add("active");

      const activeSection = document.getElementById("active-cloud-projects");
      const archivedSection = document.getElementById(
        "archived-cloud-projects",
      );

      if (tabType === "active") {
        if (activeSection) activeSection.style.display = "";
        if (archivedSection) archivedSection.style.display = "none";
      } else {
        if (activeSection) activeSection.style.display = "none";
        if (archivedSection) archivedSection.style.display = "";
      }
    };
    btn.addEventListener("click", handleTabClick);
    cleanupFunctions.push(() =>
      btn.removeEventListener("click", handleTabClick),
    );
  });

  // Project action buttons
  const editButtons = container.querySelectorAll(".edit-cloud-project-btn");
  editButtons.forEach((btn) => {
    const handleEdit = () => {
      const projectId = (btn as HTMLElement).getAttribute("data-project-id");
      if (projectId) showEditCloudProjectModal(projectId);
    };
    btn.addEventListener("click", handleEdit);
    cleanupFunctions.push(() => btn.removeEventListener("click", handleEdit));
  });

  const manageMembersButtons = container.querySelectorAll(
    ".manage-cloud-members-btn",
  );
  manageMembersButtons.forEach((btn) => {
    const handleManage = () => {
      const projectId = (btn as HTMLElement).getAttribute("data-project-id");
      if (projectId) showManageCloudMembersModal(projectId);
    };
    btn.addEventListener("click", handleManage);
    cleanupFunctions.push(() => btn.removeEventListener("click", handleManage));
  });

  const archiveButtons = container.querySelectorAll(
    ".archive-cloud-project-btn",
  );
  archiveButtons.forEach((btn) => {
    const handleArchive = () => {
      const projectId = (btn as HTMLElement).getAttribute("data-project-id");
      if (projectId) archiveCloudProject(projectId);
    };
    btn.addEventListener("click", handleArchive);
    cleanupFunctions.push(() =>
      btn.removeEventListener("click", handleArchive),
    );
  });

  const restoreButtons = container.querySelectorAll(
    ".restore-cloud-project-btn",
  );
  restoreButtons.forEach((btn) => {
    const handleRestore = () => {
      const projectId = (btn as HTMLElement).getAttribute("data-project-id");
      if (projectId) restoreCloudProject(projectId);
    };
    btn.addEventListener("click", handleRestore);
    cleanupFunctions.push(() =>
      btn.removeEventListener("click", handleRestore),
    );
  });
}

/**
 * Render projects list
 */
function renderProjectsList(projects: CloudProjectWithManager[]): string {
  if (projects.length === 0) {
    return `
      <div class="empty-state">
        <p class="text-muted">No projects found</p>
      </div>
    `;
  }

  return `
    <div class="projects-grid">
      ${projects.map((project) => renderProjectCard(project)).join("")}
    </div>
  `;
}

/**
 * Render individual project card
 */
function renderProjectCard(project: CloudProjectWithManager): string {
  const createdDate = new Date(project.created_at).toLocaleDateString();
  const managerName = project.manager?.username || "Unknown";

  return `
    <div class="project-card" data-project-id="${project.id}">
      <div class="project-card-header">
        <div class="project-color" style="background-color: ${
          project.color || "#3b82f6"
        }"></div>
        <h3 class="project-name">${escapeHtml(project.name)}</h3>
        <div class="project-actions">
          <button class="project-action-btn edit-cloud-project-btn" data-project-id="${
            project.id
          }" title="Edit Project">
            ✏️
          </button>
          <button class="project-action-btn manage-cloud-members-btn" data-project-id="${
            project.id
          }" title="Manage Members">
            👥
          </button>
          ${
            project.is_active
              ? `<button class="project-action-btn archive-cloud-project-btn" data-project-id="${project.id}" title="Archive Project">📦</button>`
              : `<button class="project-action-btn restore-cloud-project-btn" data-project-id="${project.id}" title="Restore Project">↩️</button>`
          }
        </div>
      </div>
      
      <div class="project-card-content">
        ${
          project.description
            ? `<p class="project-description">${escapeHtml(
                project.description,
              )}</p>`
            : `<p class="project-description empty">No description provided</p>`
        }
        
        <div class="project-meta">
          <div class="project-meta-item">
            <span class="meta-label">Manager:</span>
            <span class="meta-value">${escapeHtml(managerName)}</span>
          </div>
          <div class="project-meta-item">
            <span class="meta-label">Created:</span>
            <span class="meta-value">${createdDate}</span>
          </div>
          <div class="project-meta-item">
            <span class="meta-label">Status:</span>
            <span class="meta-value status-${
              project.is_active ? "active" : "archived"
            }">
              ${project.is_active ? "Active" : "Archived"}
            </span>
          </div>
        </div>
      </div>
    </div>
  `;
}

// =====================================================
// EVENT HANDLERS
// =====================================================

async function showCreateOrgModal() {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-content">
      <h2>Create Team Organization</h2>
      <div class="modal-body">
        <label for="org-name-input">Organization Name:</label>
        <input type="text" id="org-name-input" class="org-input" placeholder="Enter organization name" />
      </div>
      <div class="modal-actions">
        <button id="create-org-confirm-btn" class="btn btn-primary">Create</button>
        <button id="create-org-cancel-btn" class="btn btn-secondary">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const confirmBtn = document.getElementById(
    "create-org-confirm-btn",
  ) as HTMLButtonElement;
  const cancelBtn = document.getElementById("create-org-cancel-btn");
  const input = document.getElementById("org-name-input") as HTMLInputElement;

  const cleanup = () => {
    document.body.removeChild(modal);
  };

  confirmBtn?.addEventListener("click", async () => {
    const name = input.value.trim();
    if (!name) {
      showNotification("Please enter an organization name");
      return;
    }

    try {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Creating...";

      await createTeamOrganization({ name });
      showNotification("Team organization created successfully!");
      cleanup();
      await renderOrganizationTab(); // Refresh
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Error creating organization:", error);
      showNotification(
        `Failed to create organization: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Create";
    }
  });

  cancelBtn?.addEventListener("click", cleanup);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) cleanup();
  });
}

function copyOrgId() {
  if (!currentOrg) return;

  navigator.clipboard.writeText(currentOrg.id).then(
    () => {
      showNotification("Organization ID copied to clipboard!");
    },
    () => {
      showNotification("Failed to copy Organization ID");
    },
  );
}

async function handleJoinOrganization(orgId: string) {
  if (!orgId) {
    showNotification("Please enter an organization ID");
    return;
  }

  const joinBtn = document.getElementById("join-org-btn") as HTMLButtonElement;
  const joinInput = document.getElementById(
    "join-org-input",
  ) as HTMLInputElement;

  try {
    joinBtn.disabled = true;
    joinBtn.textContent = "Joining...";

    // Validate org exists
    const targetOrg = await getOrganizationById(orgId);
    if (!targetOrg) {
      showNotification("Organization not found");
      return;
    }

    await requestToJoinOrganization(orgId);
    showNotification(
      `Join request sent to ${targetOrg.name}. Waiting for approval.`,
    );
    joinInput.value = "";
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    showNotification(`Failed to join organization: ${errorMsg}`);
  } finally {
    joinBtn.disabled = false;
    joinBtn.textContent = "Join";
  }
}

async function handleRoleChange(select: HTMLSelectElement) {
  const userId = select.getAttribute("data-user-id");
  const currentRole = select.getAttribute("data-current-role");
  const newRole = select.value as "admin" | "manager" | "employee";

  if (!userId || newRole === currentRole) return;

  // Check if trying to remove last admin
  if (currentRole === "admin") {
    const adminCount = orgMembers.filter((m) => m.role === "admin").length;
    if (adminCount <= 1) {
      showNotification(
        "Cannot change role: Organization must have at least one admin",
      );
      select.value = currentRole;
      return;
    }
  }

  try {
    select.disabled = true;
    await updateUserRole(userId, newRole);
    showNotification("User role updated successfully");
    await renderOrganizationTab(); // Refresh
  } catch (error) {
    showNotification(
      `Failed to update role: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
    select.value = currentRole || "";
    select.disabled = false;
  }
}

async function handleRemoveMember(userId: string, username: string) {
  // Check if trying to remove last admin
  const member = orgMembers.find((m) => m.id === userId);
  if (member?.role === "admin") {
    const adminCount = orgMembers.filter((m) => m.role === "admin").length;
    if (adminCount <= 1) {
      showNotification("Cannot remove last admin from organization");
      return;
    }
  }

  return new Promise<void>((resolve) => {
    showConfirmationModal({
      title: "Remove Member",
      message: `Are you sure you want to remove ${username} from the organization?`,
      confirmText: "Remove",
      cancelText: "Cancel",
      confirmClass: "btn btn-danger",
      onConfirm: async () => {
        try {
          await removeUserFromOrganization(userId);
          showNotification(`${username} removed from organization`);
          await renderOrganizationTab(); // Refresh
          resolve();
        } catch (error) {
          showNotification(
            `Failed to remove member: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          );
          resolve();
        }
      },
      onCancel: () => {
        resolve();
      },
    });
  });
}

async function handleApproveRequest(requestId: string) {
  try {
    await approveJoinRequest(requestId);
    showNotification("Join request approved");
    await renderOrganizationTab(); // Refresh
  } catch (error) {
    showNotification(
      `Failed to approve request: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
}

async function handleRejectRequest(requestId: string) {
  try {
    await rejectJoinRequest(requestId);
    showNotification("Join request rejected");
    await renderOrganizationTab(); // Refresh
  } catch (error) {
    showNotification(
      `Failed to reject request: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
}

// =====================================================
// CLOUD PROJECT EVENT HANDLERS
// =====================================================

async function showCreateCloudProjectModal() {
  if (!currentOrg) return;

  // Prevent opening multiple modals
  if (
    document.getElementById("customModal") ||
    document.getElementById("customModalOverlay")
  ) {
    return;
  }

  // Clean up any existing modals first
  const existingModal = document.getElementById("customModal");
  const existingOverlay = document.getElementById("customModalOverlay");
  if (existingModal) existingModal.remove();
  if (existingOverlay) existingOverlay.remove();

  // Create custom modal with color picker
  const overlay = document.createElement("div");
  overlay.id = "customModalOverlay";
  overlay.className = "custom-modal-overlay";
  overlay.style.display = "block";
  document.body.appendChild(overlay);

  const modal = document.createElement("div");
  modal.id = "customModal";
  modal.className = "active";

  modal.innerHTML = `
    <div class="session-modal-content">
      <button class="modal-close-btn">&times;</button>
      <h2>Create New Cloud Project</h2>
      <form id="cloudProjectForm">
        <div style="margin-bottom: 15px;">
          <label for="cloud-project-name">Project Name *</label><br>
          <input id="cloud-project-name" name="name" type="text" required>
        </div>
        
        <div style="margin-bottom: 15px;">
          <label for="cloud-project-description">Description</label><br>
          <textarea id="cloud-project-description" name="description"></textarea>
        </div>
        
        <div style="margin-bottom: 15px;">
          <label for="cloud-project-color">Project Color</label><br>
          <div class="color-picker-container">
            <input id="cloud-project-color" name="color" type="color" value="#3b82f6">
          </div>
        </div>
        
        <div class="session-modal-actions">
          <button type="button" id="cloudProjectCancelBtn" class="btn-cancel">Cancel</button>
          <button type="submit" class="btn-confirm">Create Project</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  const form = document.getElementById("cloudProjectForm") as HTMLFormElement;
  const nameInput = document.getElementById(
    "cloud-project-name",
  ) as HTMLInputElement;
  const cancelBtn = document.getElementById(
    "cloudProjectCancelBtn",
  ) as HTMLButtonElement;
  const closeBtn = modal.querySelector(".modal-close-btn") as HTMLButtonElement;

  // Focus the name input
  setTimeout(() => nameInput.focus(), 50);

  // Handle form submission
  form.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(form);

    try {
      await createCloudProject({
        name: formData.get("name") as string,
        description: formData.get("description") as string,
        color: formData.get("color") as string,
        org_id: currentOrg!.id,
        manager_id: currentUserProfile!.id,
      });
      showNotification("Cloud project created successfully!");
      modal.remove();
      overlay.remove();
      await renderOrganizationTab(); // Refresh
    } catch {
      showNotification("Failed to create project");
    }
  };

  // Handle cancel and close
  const closeModal = () => {
    modal.remove();
    overlay.remove();
  };

  cancelBtn.onclick = closeModal;
  closeBtn.onclick = closeModal;

  // Handle overlay click to close modal
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      closeModal();
    }
  };

  // Handle modal background click to close modal
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };

  // Prevent modal content clicks from closing modal
  modal
    .querySelector(".session-modal-content")
    ?.addEventListener("click", (e) => {
      e.stopPropagation();
    });
}

async function showEditCloudProjectModal(projectId: string) {
  const project = cloudProjects.find((p) => p.id === projectId);
  if (!project) return;

  // Prevent opening multiple modals
  if (
    document.getElementById("customModal") ||
    document.getElementById("customModalOverlay")
  ) {
    return;
  }

  // Clean up any existing modals first
  const existingModal = document.getElementById("customModal");
  const existingOverlay = document.getElementById("customModalOverlay");
  if (existingModal) existingModal.remove();
  if (existingOverlay) existingOverlay.remove();

  // Create custom modal with color picker
  const overlay = document.createElement("div");
  overlay.id = "customModalOverlay";
  overlay.className = "custom-modal-overlay";
  overlay.style.display = "block";
  document.body.appendChild(overlay);

  const modal = document.createElement("div");
  modal.id = "customModal";
  modal.className = "active";

  modal.innerHTML = `
    <div class="session-modal-content">
      <button class="modal-close-btn">&times;</button>
      <h2>Edit Cloud Project</h2>
      <form id="cloudProjectEditForm">
        <div style="margin-bottom: 15px;">
          <label for="cloud-project-edit-name">Project Name *</label><br>
          <input id="cloud-project-edit-name" name="name" type="text" value="${escapeHtml(
            project.name,
          )}" required>
        </div>
        
        <div style="margin-bottom: 15px;">
          <label for="cloud-project-edit-description">Description</label><br>
          <textarea id="cloud-project-edit-description" name="description">${escapeHtml(
            project.description || "",
          )}</textarea>
        </div>
        
        <div style="margin-bottom: 15px;">
          <label for="cloud-project-edit-color">Project Color</label><br>
          <div class="color-picker-container">
            <input id="cloud-project-edit-color" name="color" type="color" value="${
              project.color || "#3b82f6"
            }">
          </div>
        </div>
        
        <div class="session-modal-actions">
          <button type="button" id="cloudProjectEditCancelBtn" class="btn-cancel">Cancel</button>
          <button type="submit" class="btn-confirm">Update Project</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  const form = document.getElementById(
    "cloudProjectEditForm",
  ) as HTMLFormElement;
  const nameInput = document.getElementById(
    "cloud-project-edit-name",
  ) as HTMLInputElement;
  const cancelBtn = document.getElementById(
    "cloudProjectEditCancelBtn",
  ) as HTMLButtonElement;
  const closeBtn = modal.querySelector(".modal-close-btn") as HTMLButtonElement;

  // Focus the name input
  setTimeout(() => nameInput.focus(), 50);

  // Handle form submission
  form.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(form);

    try {
      await updateCloudProject(projectId, {
        name: formData.get("name") as string,
        description: formData.get("description") as string,
        color: formData.get("color") as string,
      });
      showNotification("Cloud project updated successfully!");
      modal.remove();
      overlay.remove();
      await renderOrganizationTab(); // Refresh
    } catch {
      showNotification("Failed to update project");
    }
  };

  // Handle cancel and close
  const closeModal = () => {
    modal.remove();
    overlay.remove();
  };

  cancelBtn.onclick = closeModal;
  closeBtn.onclick = closeModal;

  // Handle overlay click to close modal
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      closeModal();
    }
  };

  // Handle modal background click to close modal
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };

  // Prevent modal content clicks from closing modal
  modal
    .querySelector(".session-modal-content")
    ?.addEventListener("click", (e) => {
      e.stopPropagation();
    });
}

async function archiveCloudProject(projectId: string) {
  const project = cloudProjects.find((p) => p.id === projectId);
  if (!project) return;

  showConfirmationModal({
    title: "Archive Project",
    message: `Are you sure you want to archive "${project.name}"?`,
    confirmText: "Archive",
    onConfirm: async () => {
      try {
        await updateCloudProject(projectId, { is_active: false });
        showNotification("Project archived successfully!");
        await renderOrganizationTab();
      } catch {
        showNotification("Failed to archive project");
      }
    },
  });
}

async function restoreCloudProject(projectId: string) {
  const project = cloudProjects.find((p) => p.id === projectId);
  if (!project) return;

  showConfirmationModal({
    title: "Restore Project",
    message: `Are you sure you want to restore "${project.name}" to active projects?`,
    confirmText: "Restore",
    onConfirm: async () => {
      try {
        await updateCloudProject(projectId, { is_active: true });
        showNotification("Project restored successfully!");
        await renderOrganizationTab();
      } catch {
        showNotification("Failed to restore project");
      }
    },
  });
}

async function showManageCloudMembersModal(projectId: string) {
  const project = cloudProjects.find((p) => p.id === projectId);
  if (!project || isMemberModalOpen) return;

  isMemberModalOpen = true;

  try {
    const refreshModalContent = async () => {
      const freshMembers = await getProjectMembers(projectId);

      // Filter org members who aren't already project members
      const projectMemberIds = freshMembers.map((m) => m.user_id);
      const availableMembers = orgMembers.filter(
        (m) => !projectMemberIds.includes(m.id),
      );

      const membersList = freshMembers
        .map((member: ProjectMemberWithUser) => {
          const displayRole = member.role;
          const roleIcon = displayRole === "manager" ? "👑" : "👤";
          const username = member.user?.username || "Unknown";
          const isProjectManager = member.user_id === project.manager_id;

          return `
            <div class="member-item" data-user-id="${member.user_id}">
              <span class="member-info">
                ${roleIcon} ${escapeHtml(username)} 
                <small>(${displayRole})</small>
              </span>
              <div class="member-actions">
                ${
                  !isProjectManager
                    ? `
                  <div class="role-select-container" data-user-id="${member.user_id}" data-current-role="${displayRole}"></div>
                  <button class="btn-remove-member" data-user-id="${member.user_id}">Remove</button>
                `
                    : '<span class="manager-label">Project Manager</span>'
                }
              </div>
            </div>
          `;
        })
        .join("");

      const userOptions = availableMembers
        .map(
          (user) =>
            `<option value="${user.id}">${escapeHtml(user.username)}</option>`,
        )
        .join("");

      return {
        membersList,
        availableMembers,
        userOptions,
        projectMembers: freshMembers,
      };
    };

    const setupModalInteractions = (data: {
      membersList: string;
      availableMembers: UserProfile[];
      userOptions: string;
      projectMembers: ProjectMemberWithUser[];
    }) => {
      const modal = document.getElementById("customModal");
      if (!modal) return;

      // Import CustomDropdown
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createCustomDropdown } = require("./components/CustomDropdown");

      // Create role dropdowns for existing members
      const roleContainers = modal.querySelectorAll(".role-select-container");
      roleContainers.forEach((container: Element) => {
        const userId = (container as HTMLElement).dataset.userId;
        const currentRole = (container as HTMLElement).dataset.currentRole;
        const member = orgMembers.find((u) => u.id === userId);
        const canBeManager =
          member && (member.role === "admin" || member.role === "manager");

        const options = [{ value: "member", label: "Member" }];
        if (canBeManager) {
          options.push({ value: "manager", label: "Manager" });
        }

        const roleDropdown = createCustomDropdown({
          id: `role-${userId}`,
          name: `role-${userId}`,
          value: currentRole,
          options: options,
          onChange: async (newRole: string) => {
            try {
              await updateProjectMemberRole(
                projectId,
                userId!,
                newRole as "manager" | "member",
              );
              showNotification("Role updated successfully!");
              setTimeout(async () => {
                await renderOrganizationTab();
                modal?.remove();
                document.getElementById("customModalOverlay")?.remove();
                isMemberModalOpen = false;
              }, 500);
            } catch (error) {
              showNotification(`Failed to update role: ${error}`);
            }
          },
        });

        container.appendChild(roleDropdown.getElement());
      });

      // Create dropdowns for adding new members
      let userSelectDropdown: any = null;
      let roleSelectDropdown: any = null;

      if (data.availableMembers.length > 0) {
        const userContainer = modal.querySelector("#userSelect-container");
        if (userContainer) {
          userSelectDropdown = createCustomDropdown({
            id: "userSelect",
            name: "userSelect",
            placeholder: "Select a member...",
            options: [
              { value: "", label: "Select a member..." },
              ...data.availableMembers.map((user) => ({
                value: user.id.toString(),
                label: user.username,
              })),
            ],
            onChange: (userId: string) => {
              if (roleSelectDropdown && userId) {
                const selectedUser = orgMembers.find((u) => u.id === userId);
                const canBeManager =
                  selectedUser &&
                  (selectedUser.role === "admin" ||
                    selectedUser.role === "manager");

                const options = [{ value: "member", label: "Member" }];
                if (canBeManager) {
                  options.push({ value: "manager", label: "Manager" });
                }

                roleSelectDropdown.setOptions(options);
                roleSelectDropdown.setValue("member");
              }
            },
          });
          userContainer.appendChild(userSelectDropdown.getElement());
        }

        const roleContainer = modal.querySelector("#roleSelect-container");
        if (roleContainer) {
          roleSelectDropdown = createCustomDropdown({
            id: "roleSelect",
            name: "roleSelect",
            value: "member",
            options: [{ value: "member", label: "Member" }],
          });
          roleContainer.appendChild(roleSelectDropdown.getElement());
        }
      }

      // Add member button
      const addMemberBtn = modal.querySelector(
        "#addMemberBtn",
      ) as HTMLButtonElement;
      if (addMemberBtn) {
        addMemberBtn.onclick = async () => {
          const userValue = userSelectDropdown?.getValue();

          if (userValue) {
            try {
              const frontendRole = roleSelectDropdown?.getValue() || "member";
              await assignMemberToProject({
                project_id: projectId,
                user_id: userValue,
                role: frontendRole as "manager" | "member",
              });
              showNotification("Member added successfully!");

              setTimeout(async () => {
                await renderOrganizationTab();
                modal?.remove();
                document.getElementById("customModalOverlay")?.remove();
                isMemberModalOpen = false;
              }, 500);
            } catch {
              showNotification("Failed to add member");
            }
          }
        };
      }

      // Remove member buttons
      const removeButtons = modal.querySelectorAll(".btn-remove-member");
      removeButtons.forEach((btn) => {
        btn.addEventListener("click", async () => {
          const userId = (btn as HTMLButtonElement).dataset.userId!;
          const memberName =
            btn
              .closest(".member-item")
              ?.querySelector(".member-info")
              ?.textContent?.split("(")[0]
              ?.trim() || "this member";

          showConfirmationModal({
            title: "Remove Member",
            message: `Are you sure you want to remove ${memberName} from the project?`,
            confirmText: "Remove",
            onConfirm: async () => {
              try {
                await removeMemberFromProject(projectId, userId);
                showNotification("Member removed successfully!");
                modal?.remove();
                document.getElementById("customModalOverlay")?.remove();
                isMemberModalOpen = false;
                await renderOrganizationTab();
              } catch (error) {
                showNotification(`Failed to remove member: ${error}`);
              }
            },
          });
        });
      });
    };

    // Create modal using showModal
    showModal({
      title: `Manage Members - ${project.name}`,
      fields: [],
      cancelText: "Close",
      onCancel: () => {
        isMemberModalOpen = false;
        renderOrganizationTab();
      },
    });

    // Replace form content with custom members management UI
    setTimeout(async () => {
      const modal = document.getElementById("customModal");
      const form = modal?.querySelector("form");
      if (form) {
        const data = await refreshModalContent();

        form.innerHTML = `
          <div class="members-modal-content">
            <div class="members-section">
              <h3>Current Members</h3>
              <div class="members-list">
                ${data.membersList}
              </div>
            </div>

            ${
              data.availableMembers.length > 0
                ? `
              <div class="add-member-section">
                <h3>Add New Member</h3>
                <div class="add-member-form">
                  <div id="userSelect-container"></div>
                  <div id="roleSelect-container"></div>
                  <button type="button" id="addMemberBtn" class="btn-confirm">Add Member</button>
                </div>
                <p class="info-note" style="margin-top: 10px; font-size: 12px; color: var(--fg-muted);">
                  Note: Only admins and managers can be assigned as project managers.
                </p>
              </div>
            `
                : "<p><em>All organization members are already assigned to this project.</em></p>"
            }
            
            <div class="session-modal-actions">
              <button type="button" id="membersCloseBtn" class="btn-cancel">Close</button>
            </div>
          </div>
        `;

        setTimeout(() => {
          setupModalInteractions(data);

          const closeBtn = form.querySelector("#membersCloseBtn");
          if (closeBtn) {
            closeBtn.addEventListener("click", () => {
              modal?.remove();
              document.getElementById("customModalOverlay")?.remove();
              isMemberModalOpen = false;
              renderOrganizationTab();
            });
          }
        }, 100);
      }
    }, 50);
  } catch (error) {
    isMemberModalOpen = false;
    showNotification("Failed to load project members");
  }
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

function isAdmin(): boolean {
  return currentUserProfile?.role === "admin";
}

function isManager(): boolean {
  return currentUserProfile?.role === "manager";
}

function calculateOrgStats() {
  const admins = orgMembers.filter((m) => m.role === "admin").length;
  const managers = orgMembers.filter((m) => m.role === "manager").length;
  const employees = orgMembers.filter((m) => m.role === "employee").length;

  return {
    total: orgMembers.length,
    admins,
    managers,
    employees,
  };
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatTimeAgo(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 60)
    return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
  if (diffHours < 24)
    return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
  return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
}
