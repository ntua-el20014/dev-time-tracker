import { ipcRenderer } from "electron";
import { ProjectWithMembers } from "@shared/types";
import {
  getCurrentUserId,
  isCurrentUserManagerOrAdmin,
  safeIpcInvoke,
} from "./utils";
import {
  showInAppNotification,
  showConfirmationModal,
  showModal,
} from "./components";

let currentProjects: ProjectWithMembers[] = [];

// Flag to prevent multiple member management modals
let isMemberModalOpen = false;

export async function renderProjects() {
  const projectsContainer = document.getElementById("projectsContent");
  if (!projectsContainer) return;

  // Check if user has permission to access projects tab
  const hasAccess = await isCurrentUserManagerOrAdmin();
  if (!hasAccess) {
    projectsContainer.innerHTML = `
      <div class="access-denied">
        <h2>Access Denied</h2>
        <p>You don't have permission to access project management. Only managers and administrators can access this section.</p>
      </div>
    `;
    return;
  }

  // Show loading while projects load
  projectsContainer.innerHTML =
    '<div class="tab-loading"><div class="tab-loading-spinner"></div><span class="tab-loading-text">Loading projects…</span></div>';

  // Load projects data
  await loadProjects();

  projectsContainer.innerHTML = `
    <div class="projects-container">
      <div class="projects-header">
        <h1>Project Management</h1>
        <div class="projects-header-actions">
          <button id="newProjectBtn" class="btn-primary">+ New Project</button>
        </div>
      </div>
      
      <div class="projects-stats">
        <div class="project-stat-card active-projects">
          <div class="stat-number">${
            currentProjects.filter((p) => p.is_active).length
          }</div>
          <div class="stat-label">Active Projects</div>
        </div>
        <div class="project-stat-card archived-projects">
          <div class="stat-number">${
            currentProjects.filter((p) => !p.is_active).length
          }</div>
          <div class="stat-label">Archived Projects</div>
        </div>
        <div class="project-stat-card total-projects">
          <div class="stat-number">${currentProjects.length}</div>
          <div class="stat-label">Total Projects</div>
        </div>
      </div>

      <div class="projects-content">
        <div class="projects-tabs">
          <button class="projects-tab-btn active" data-tab="active">Active Projects</button>
          <button class="projects-tab-btn" data-tab="archived">Archived Projects</button>
        </div>
        
        <div id="activeProjectsSection" class="projects-section">
          ${renderProjectsList(currentProjects.filter((p) => p.is_active))}
        </div>
        
        <div id="archivedProjectsSection" class="projects-section" style="display: none;">
          ${renderProjectsList(currentProjects.filter((p) => !p.is_active))}
        </div>
      </div>
    </div>
  `;

  setupProjectsEventListeners();
}

async function loadProjects() {
  try {
    // Get projects based on user role - admins see all, managers see only their projects
    const currentUserId = getCurrentUserId();
    const userRole = await safeIpcInvoke("get-user-role", [currentUserId], {
      fallback: "member",
    });

    if (userRole === "admin") {
      currentProjects = await safeIpcInvoke(
        "get-all-projects-with-members",
        [],
        { fallback: [] },
      );
    } else {
      // Managers only see projects they are members or managers of
      currentProjects = await safeIpcInvoke(
        "get-user-projects-with-members",
        [currentUserId],
        { fallback: [] },
      );
    }
  } catch (error) {
    showInAppNotification("Failed to load projects", 5000);
    currentProjects = [];
  }
}
function renderProjectsList(projects: ProjectWithMembers[]): string {
  if (projects.length === 0) {
    return `
      <div class="empty-state">
        <h3>No projects found</h3>
        <p>Create your first project to get started with project-based time tracking.</p>
      </div>
    `;
  }

  return `
    <div class="projects-grid">
      ${projects.map((project) => renderProjectCard(project)).join("")}
    </div>
  `;
}

function renderProjectCard(project: ProjectWithMembers): string {
  const createdDate = new Date(project.created_at).toLocaleDateString();
  const memberCount = project.members ? project.members.length : 0;

  return `
    <div class="project-card" data-project-id="${project.id}">
      <div class="project-card-header">
        <div class="project-color" style="background-color: ${
          project.color || "#3b82f6"
        }"></div>
        <h3 class="project-name">${escapeHtml(project.name)}</h3>
        <div class="project-actions">
          <button class="project-action-btn edit-project-btn" data-project-id="${
            project.id
          }" title="Edit Project">
            ✏️
          </button>
          <button class="project-action-btn manage-members-btn" data-project-id="${
            project.id
          }" title="Manage Members">
            👥
          </button>
          ${
            project.is_active
              ? `<button class="project-action-btn archive-project-btn" data-project-id="${project.id}" title="Archive Project">📦</button>`
              : `<button class="project-action-btn restore-project-btn" data-project-id="${project.id}" title="Restore Project">↩️</button>`
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
            <span class="meta-value">${escapeHtml(
              project.manager_name || "Unknown",
            )}</span>
          </div>
          <div class="project-meta-item">
            <span class="meta-label">Members:</span>
            <span class="meta-value">${memberCount} ${
              memberCount === 1 ? "member" : "members"
            }</span>
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
        
        <button class="project-stats-btn" data-project-id="${project.id}">
          View Statistics
        </button>
      </div>
    </div>
  `;
}

function setupProjectsEventListeners() {
  const projectsContainer = document.getElementById("projectsContent");
  if (!projectsContainer) return;

  // Tab switching
  const tabButtons = projectsContainer.querySelectorAll(".projects-tab-btn");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const target = e.target as HTMLButtonElement;
      const tabType = target.dataset.tab;

      // Update tab button states
      tabButtons.forEach((b) => b.classList.remove("active"));
      target.classList.add("active");

      // Show/hide sections
      const activeSection = document.getElementById("activeProjectsSection");
      const archivedSection = document.getElementById(
        "archivedProjectsSection",
      );

      if (tabType === "active") {
        if (activeSection) activeSection.style.display = "";
        if (archivedSection) archivedSection.style.display = "none";
      } else {
        if (activeSection) activeSection.style.display = "none";
        if (archivedSection) archivedSection.style.display = "";
      }
    });
  });

  // New project button
  const newProjectBtn = document.getElementById("newProjectBtn");
  if (newProjectBtn && !newProjectBtn.hasAttribute("data-listener-added")) {
    newProjectBtn.addEventListener("click", showCreateProjectModal);
    newProjectBtn.setAttribute("data-listener-added", "true");
  }

  // Project action buttons
  projectsContainer.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;

    if (target.classList.contains("edit-project-btn")) {
      const projectId = parseInt(target.dataset.projectId!);
      showEditProjectModal(projectId);
    }

    if (target.classList.contains("manage-members-btn")) {
      const projectId = parseInt(target.dataset.projectId!);
      showManageMembersModal(projectId);
    }

    if (target.classList.contains("archive-project-btn")) {
      const projectId = parseInt(target.dataset.projectId!);
      archiveProject(projectId);
    }

    if (target.classList.contains("restore-project-btn")) {
      const projectId = parseInt(target.dataset.projectId!);
      restoreProject(projectId);
    }

    if (target.classList.contains("project-stats-btn")) {
      const projectId = parseInt(target.dataset.projectId!);
      showProjectStats(projectId);
    }
  });
}

function showCreateProjectModal() {
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
      <h2>Create New Project</h2>
      <form id="projectForm">
        <div style="margin-bottom: 15px;">
          <label for="project-name">Project Name *</label><br>
          <input id="project-name" name="name" type="text" required>
        </div>
        
        <div style="margin-bottom: 15px;">
          <label for="project-description">Description</label><br>
          <textarea id="project-description" name="description"></textarea>
        </div>
        
        <div style="margin-bottom: 15px;">
          <label for="project-color">Project Color</label><br>
          <div class="color-picker-container">
            <input id="project-color" name="color" type="color" value="#3b82f6">
          </div>
        </div>
        
        <div class="session-modal-actions">
          <button type="button" id="projectCancelBtn" class="btn-cancel">Cancel</button>
          <button type="submit" class="btn-confirm">Create Project</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  const form = document.getElementById("projectForm") as HTMLFormElement;
  const nameInput = document.getElementById("project-name") as HTMLInputElement;
  const cancelBtn = document.getElementById(
    "projectCancelBtn",
  ) as HTMLButtonElement;
  const closeBtn = modal.querySelector(".modal-close-btn") as HTMLButtonElement;

  // Focus the name input
  setTimeout(() => nameInput.focus(), 50);

  // Handle form submission
  form.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const userId = getCurrentUserId();

    try {
      await ipcRenderer.invoke(
        "create-project",
        formData.get("name") as string,
        formData.get("description") as string,
        formData.get("color") as string,
        userId,
      );
      showInAppNotification("Project created successfully!", 3000);
      renderProjects(); // Refresh the projects list
      modal.remove();
      overlay.remove();
    } catch (error) {
      showInAppNotification("Failed to create project", 5000);
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

function showEditProjectModal(projectId: number) {
  const project = currentProjects.find((p) => p.id === projectId);
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
      <h2>Edit Project</h2>
      <form id="projectEditForm">
        <label for="project-edit-name">Project Name *</label><br>
        <input id="project-edit-name" name="name" type="text" value="${escapeHtml(
          project.name,
        )}" required>
        
        <label for="project-edit-description">Description</label><br>
        <textarea id="project-edit-description" name="description">${escapeHtml(
          project.description || "",
        )}</textarea>
        
        <label for="project-edit-color">Project Color</label><br>
        <div class="color-picker-container">
          <input id="project-edit-color" name="color" type="color" value="${
            project.color || "#3b82f6"
          }">
        </div>
        
        <div class="session-modal-actions">
          <button type="button" id="projectEditCancelBtn" class="btn-cancel">Cancel</button>
          <button type="submit" class="btn-confirm">Update Project</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  const form = document.getElementById("projectEditForm") as HTMLFormElement;
  const nameInput = document.getElementById(
    "project-edit-name",
  ) as HTMLInputElement;
  const cancelBtn = document.getElementById(
    "projectEditCancelBtn",
  ) as HTMLButtonElement;
  const closeBtn = modal.querySelector(".modal-close-btn") as HTMLButtonElement;

  // Focus the name input
  setTimeout(() => nameInput.focus(), 50);

  // Handle form submission
  form.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(form);

    try {
      await ipcRenderer.invoke(
        "update-project",
        projectId,
        formData.get("name") as string,
        formData.get("description") as string,
        formData.get("color") as string,
      );
      showInAppNotification("Project updated successfully!", 3000);
      renderProjects(); // Refresh the projects list
      modal.remove();
      overlay.remove();
    } catch (error) {
      showInAppNotification("Failed to update project", 5000);
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

function archiveProject(projectId: number) {
  const project = currentProjects.find((p) => p.id === projectId);
  if (!project) return;

  showConfirmationModal({
    title: "Archive Project",
    message: `Are you sure you want to archive "${project.name}"? This will hide it from active projects but preserve all session history.`,
    confirmText: "Archive",
    onConfirm: async () => {
      try {
        await ipcRenderer.invoke("delete-project", projectId);
        showInAppNotification("Project archived successfully!", 3000);
        renderProjects(); // Refresh the projects list
      } catch (error) {
        showInAppNotification("Failed to archive project", 5000);
      }
    },
  });
}

function restoreProject(projectId: number) {
  const project = currentProjects.find((p) => p.id === projectId);
  if (!project) return;

  showConfirmationModal({
    title: "Restore Project",
    message: `Are you sure you want to restore "${project.name}" to active projects?`,
    confirmText: "Restore",
    onConfirm: async () => {
      try {
        await ipcRenderer.invoke("restore-project", projectId);
        showInAppNotification("Project restored successfully!", 3000);
        renderProjects(); // Refresh the projects list
      } catch (error) {
        showInAppNotification("Failed to restore project", 5000);
      }
    },
  });
}

async function showProjectStats(projectId: number) {
  const project = currentProjects.find((p) => p.id === projectId);
  if (!project) return;

  try {
    const stats = await ipcRenderer.invoke("get-project-stats", projectId);

    const totalHours = Math.floor(stats.totalTime / 3600);
    const totalMinutes = Math.floor((stats.totalTime % 3600) / 60);
    const billableHours = Math.floor(stats.billableTime / 3600);
    const billableMinutes = Math.floor((stats.billableTime % 3600) / 60);
    const nonBillableHours = Math.floor(stats.nonBillableTime / 3600);
    const nonBillableMinutes = Math.floor((stats.nonBillableTime % 3600) / 60);

    // Create a proper statistics modal using the existing modal system
    showModal({
      title: `${project.name} - Statistics`,
      fields: [], // No form fields, just display data
      cancelText: "Close",
      onCancel: () => {
        // Modal will close automatically
      },
    });

    // After the modal is created, replace the form content with statistics
    setTimeout(() => {
      const modal = document.getElementById("customModal");
      const form = modal?.querySelector("form");
      if (form) {
        form.innerHTML = `
          <div class="project-stats-modal">
            <div class="stats-grid">
              <div class="stat-item">
                <div class="stat-value">${stats.totalSessions}</div>
                <div class="stat-label">Total Sessions</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">${totalHours}h ${totalMinutes}m</div>
                <div class="stat-label">Total Time</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">${billableHours}h ${billableMinutes}m</div>
                <div class="stat-label">Billable Time</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">${nonBillableHours}h ${nonBillableMinutes}m</div>
                <div class="stat-label">Non-Billable Time</div>
              </div>
            </div>
            
            ${
              stats.firstSession
                ? `
              <div class="stats-timeline">
                <div class="timeline-item">
                  <strong>First Session:</strong> ${new Date(
                    stats.firstSession,
                  ).toLocaleDateString()}
                </div>
                <div class="timeline-item">
                  <strong>Last Session:</strong> ${new Date(
                    stats.lastSession,
                  ).toLocaleDateString()}
                </div>
              </div>
            `
                : `
              <div class="empty-stats">
                <p>No sessions recorded for this project yet.</p>
              </div>
            `
            }
            
            <div class="session-modal-actions">
              <button type="button" id="statsModalCloseBtn" class="btn-cancel">Close</button>
            </div>
          </div>
        `;

        // Add close button handler
        const closeBtn = form.querySelector("#statsModalCloseBtn");
        if (closeBtn) {
          closeBtn.addEventListener("click", () => {
            modal?.classList.remove("active");
            modal?.remove();
            document.getElementById("customModalOverlay")?.remove();
          });
        }
      }
    }, 50);
  } catch (error) {
    showInAppNotification("Failed to load project statistics", 5000);
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

async function showManageMembersModal(projectId: number) {
  const project = currentProjects.find((p) => p.id === projectId);
  if (!project) return;

  // Prevent opening multiple modals
  if (isMemberModalOpen) {
    return;
  }

  isMemberModalOpen = true;

  try {
    const refreshModalContent = async () => {
      // Refresh data
      const freshUsers = await ipcRenderer.invoke("get-all-users");
      const freshMembers = await ipcRenderer.invoke(
        "get-project-members",
        projectId,
      );

      const membersList = freshMembers
        .map((member: any) => {
          // Map database roles to display roles
          const displayRole =
            member.role === "employee" ? "member" : member.role;
          const roleIcon = displayRole === "manager" ? "👑" : "👤";

          return `
            <div class="member-item" data-user-id="${member.user_id}">
              <span class="member-info">
                ${roleIcon} ${escapeHtml(member.username)} 
                <small>(${displayRole})</small>
              </span>
              <div class="member-actions">
                ${
                  member.user_id !== project.manager_id
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

      const availableUsers = freshUsers.filter(
        (user: any) =>
          !freshMembers.some((member: any) => member.user_id === user.id),
      );

      const userOptions = availableUsers
        .map(
          (user: any) =>
            `<option value="${user.id}">${escapeHtml(user.username)}</option>`,
        )
        .join("");

      return {
        membersList,
        availableUsers,
        userOptions,
        allUsers: freshUsers,
        projectMembers: freshMembers,
      };
    };

    const setupModalInteractions = (data: any) => {
      const modal = document.getElementById("customModal");
      if (!modal) return;

      // Create custom dropdowns
      const { createCustomDropdown } = require("./components/CustomDropdown");

      // Create role select dropdowns for existing members
      const roleContainers = modal.querySelectorAll(".role-select-container");
      const roleDropdowns = new Map();

      roleContainers.forEach((container: any) => {
        const userId = container.dataset.userId;
        const currentRole = container.dataset.currentRole;
        const user = data.allUsers.find((u: any) => u.id === parseInt(userId));
        const canBeManager =
          user && (user.role === "admin" || user.role === "manager");

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
            const oldValue = currentRole;
            const dbRole = newRole === "member" ? "employee" : "manager";

            try {
              if (newRole === "manager") {
                await ipcRenderer.invoke(
                  "transfer-project-management",
                  projectId,
                  parseInt(userId),
                );
              } else {
                await ipcRenderer.invoke(
                  "update-project-member-role",
                  projectId,
                  parseInt(userId),
                  dbRole,
                );
              }
              showInAppNotification("Role updated successfully!", 3000);

              setTimeout(async () => {
                await loadProjects();
                renderProjects();
                modal?.classList.remove("active");
                modal?.remove();
                document.getElementById("customModalOverlay")?.remove();
                isMemberModalOpen = false;
              }, 500);
            } catch (error) {
              showInAppNotification(`Failed to update role: ${error}`, 5000);
              roleDropdown.setValue(oldValue);
            }
          },
        });

        container.appendChild(roleDropdown.getElement());
        roleDropdowns.set(userId, roleDropdown);
      });

      // Create dropdowns for adding new members
      let userSelectDropdown: any = null;
      let roleSelectDropdown: any = null;

      if (data.availableUsers.length > 0) {
        // User selection dropdown
        const userContainer = modal.querySelector("#userSelect-container");
        if (userContainer) {
          userSelectDropdown = createCustomDropdown({
            id: "userSelect",
            name: "userSelect",
            placeholder: "Select a user...",
            options: [
              { value: "", label: "Select a user..." },
              ...data.availableUsers.map((user: any) => ({
                value: user.id.toString(),
                label: user.username,
              })),
            ],
            onChange: (userId: string) => {
              if (roleSelectDropdown && userId) {
                const selectedUser = data.allUsers.find(
                  (u: any) => u.id === parseInt(userId),
                );
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

        // Role selection dropdown for new member
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

      // Add member functionality
      const addMemberBtn = modal.querySelector(
        "#addMemberBtn",
      ) as HTMLButtonElement;
      if (addMemberBtn) {
        addMemberBtn.onclick = async () => {
          const userValue = userSelectDropdown?.getValue();

          if (userValue) {
            try {
              // Map frontend role to database role
              const frontendRole = roleSelectDropdown?.getValue() || "member";
              const dbRole = frontendRole === "member" ? "employee" : "manager";

              await ipcRenderer.invoke(
                "add-project-member",
                projectId,
                parseInt(userValue),
                dbRole,
              );
              showInAppNotification("Member added successfully!", 3000);

              // Wait a bit before refreshing to ensure database is updated
              setTimeout(async () => {
                await loadProjects();
                renderProjects();
                // Close modal after successful update
                modal?.classList.remove("active");
                modal?.remove();
                document.getElementById("customModalOverlay")?.remove();
                isMemberModalOpen = false;
              }, 500);
            } catch (error) {
              showInAppNotification("Failed to add member", 5000);
            }
          }
        };
      }
    };

    // Use showModal but override content after creation
    showModal({
      title: `Manage Members - ${project.name}`,
      fields: [], // No form fields, we'll replace with custom content
      cancelText: "Close",
      onCancel: () => {
        isMemberModalOpen = false;
        // Refresh the projects list when closing
        loadProjects().then(() => renderProjects());
      },
    });

    // Replace the form content with our custom members management UI
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
              data.availableUsers.length > 0
                ? `
              <div class="add-member-section">
                <h3>Add New Member</h3>
                <div class="add-member-form">
                  <div id="userSelect-container"></div>
                  <div id="roleSelect-container"></div>
                  <button type="button" id="addMemberBtn" class="btn-confirm">Add Member</button>
                </div>
                <p class="info-note" style="margin-top: 10px; font-size: 12px; color: var(--fg-muted);">
                  Note: Only system admins and managers can be assigned as project managers.
                </p>
              </div>
            `
                : "<p><em>All users are already members of this project.</em></p>"
            }
            
            <div class="session-modal-actions">
              <button type="button" id="membersCloseBtn" class="btn-cancel">Close</button>
            </div>
          </div>
        `;

        // Setup interactions after a small delay to ensure DOM is fully ready
        setTimeout(() => {
          setupModalInteractions(data);

          // Add direct click listeners for remove buttons
          const removeButtons = modal?.querySelectorAll(".btn-remove-member");
          removeButtons?.forEach((btn) => {
            btn.addEventListener("click", async () => {
              const userId = parseInt(
                (btn as HTMLButtonElement).dataset.userId!,
              );
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
                    await ipcRenderer.invoke(
                      "remove-project-member",
                      projectId,
                      userId,
                    );
                    showInAppNotification("Member removed successfully!", 3000);
                    // Close modal and refresh projects
                    modal?.classList.remove("active");
                    modal?.remove();
                    document.getElementById("customModalOverlay")?.remove();
                    isMemberModalOpen = false;
                    await loadProjects();
                    renderProjects();
                  } catch (error) {
                    showInAppNotification(
                      `Failed to remove member: ${error}`,
                      5000,
                    );
                  }
                },
              });
            });
          });

          // Add direct listeners for role changes - don't close modal immediately
          const roleSelects = modal?.querySelectorAll(".role-select");
          roleSelects?.forEach((select) => {
            select.addEventListener("change", async (e) => {
              const target = e.target as HTMLSelectElement;
              const userId = parseInt(target.dataset.userId!);
              const newRole = target.value as "manager" | "member";
              const oldValue =
                target.value === "manager" ? "member" : "manager";

              // Map frontend role to database role
              const dbRole = newRole === "member" ? "employee" : "manager";

              try {
                if (newRole === "manager") {
                  await ipcRenderer.invoke(
                    "transfer-project-management",
                    projectId,
                    userId,
                  );
                } else {
                  await ipcRenderer.invoke(
                    "update-project-member-role",
                    projectId,
                    userId,
                    dbRole,
                  );
                }
                showInAppNotification("Role updated successfully!", 3000);

                // Wait a bit before refreshing to ensure database is updated
                setTimeout(async () => {
                  await loadProjects();
                  renderProjects();
                  // Close modal after successful update
                  modal?.classList.remove("active");
                  modal?.remove();
                  document.getElementById("customModalOverlay")?.remove();
                  isMemberModalOpen = false;
                }, 500);
              } catch (error) {
                showInAppNotification(`Failed to update role: ${error}`, 5000);
                // Revert the select value
                target.value = oldValue;
              }
            });
          });
        }, 100);

        // Add close button handler
        const closeBtn = form.querySelector("#membersCloseBtn");
        if (closeBtn) {
          closeBtn.addEventListener("click", () => {
            modal?.classList.remove("active");
            modal?.remove();
            document.getElementById("customModalOverlay")?.remove();
            isMemberModalOpen = false;
            loadProjects().then(() => renderProjects());
          });
        }
      }
    }, 50);
  } catch (error) {
    isMemberModalOpen = false; // Reset flag on error
    showInAppNotification("Failed to load project members", 5000);
  }
}
