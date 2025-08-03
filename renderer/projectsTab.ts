import { ipcRenderer } from "electron";
import { ProjectWithMembers } from "@shared/types";
import { getCurrentUserId, isCurrentUserManagerOrAdmin } from "./utils";
import {
  showInAppNotification,
  showConfirmationModal,
  showModal,
} from "./components";

let currentProjects: ProjectWithMembers[] = [];

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
        <div class="project-stat-card">
          <div class="stat-number">${
            currentProjects.filter((p) => p.is_active).length
          }</div>
          <div class="stat-label">Active Projects</div>
        </div>
        <div class="project-stat-card">
          <div class="stat-number">${
            currentProjects.filter((p) => !p.is_active).length
          }</div>
          <div class="stat-label">Archived Projects</div>
        </div>
        <div class="project-stat-card">
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
    // Get all projects with member information for managers/admins
    currentProjects = await ipcRenderer.invoke("get-all-projects-with-members");
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
                project.description
              )}</p>`
            : `<p class="project-description empty">No description provided</p>`
        }
        
        <div class="project-meta">
          <div class="project-meta-item">
            <span class="meta-label">Manager:</span>
            <span class="meta-value">${escapeHtml(
              project.manager_name || "Unknown"
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
        "archivedProjectsSection"
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
  if (newProjectBtn) {
    newProjectBtn.addEventListener("click", showCreateProjectModal);
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
        <label for="project-name">Project Name:</label><br>
        <input id="project-name" name="name" type="text" required><br>
        
        <label for="project-description">Description:</label><br>
        <textarea id="project-description" name="description"></textarea><br>
        
        <label for="project-color">Project Color:</label><br>
        <div class="color-picker-container">
          <input id="project-color" name="color" type="color" value="#3b82f6">
          <div class="color-preview" style="background-color: #3b82f6;"></div>
        </div><br>
        
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
  const colorInput = document.getElementById(
    "project-color"
  ) as HTMLInputElement;
  const colorPreview = modal.querySelector(".color-preview") as HTMLElement;
  const cancelBtn = document.getElementById(
    "projectCancelBtn"
  ) as HTMLButtonElement;
  const closeBtn = modal.querySelector(".modal-close-btn") as HTMLButtonElement;

  // Update color preview when color changes
  colorInput.addEventListener("input", (e) => {
    const color = (e.target as HTMLInputElement).value;
    colorPreview.style.backgroundColor = color;
  });

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
        userId
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

  // Handle overlay click to close
  overlay.onclick = (e) => {
    if (e.target === overlay) {
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
        <label for="project-edit-name">Project Name:</label><br>
        <input id="project-edit-name" name="name" type="text" value="${escapeHtml(
          project.name
        )}" required><br>
        
        <label for="project-edit-description">Description:</label><br>
        <textarea id="project-edit-description" name="description">${escapeHtml(
          project.description || ""
        )}</textarea><br>
        
        <label for="project-edit-color">Project Color:</label><br>
        <div class="color-picker-container">
          <input id="project-edit-color" name="color" type="color" value="${
            project.color || "#3b82f6"
          }">
          <div class="color-preview" style="background-color: ${
            project.color || "#3b82f6"
          };"></div>
        </div><br>
        
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
    "project-edit-name"
  ) as HTMLInputElement;
  const colorInput = document.getElementById(
    "project-edit-color"
  ) as HTMLInputElement;
  const colorPreview = modal.querySelector(".color-preview") as HTMLElement;
  const cancelBtn = document.getElementById(
    "projectEditCancelBtn"
  ) as HTMLButtonElement;
  const closeBtn = modal.querySelector(".modal-close-btn") as HTMLButtonElement;

  // Update color preview when color changes
  colorInput.addEventListener("input", (e) => {
    const color = (e.target as HTMLInputElement).value;
    colorPreview.style.backgroundColor = color;
  });

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
        formData.get("color") as string
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

  // Handle overlay click to close
  overlay.onclick = (e) => {
    if (e.target === overlay) {
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
                    stats.firstSession
                  ).toLocaleDateString()}
                </div>
                <div class="timeline-item">
                  <strong>Last Session:</strong> ${new Date(
                    stats.lastSession
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

  try {
    // Get all users and current project members
    const allUsers = await ipcRenderer.invoke("get-all-users");
    const projectMembers = await ipcRenderer.invoke(
      "get-project-members",
      projectId
    );

    // Create custom modal
    const overlay = document.createElement("div");
    overlay.id = "customModalOverlay";
    overlay.className = "custom-modal-overlay";
    overlay.style.display = "block";
    document.body.appendChild(overlay);

    const modal = document.createElement("div");
    modal.id = "customModal";
    modal.className = "active";

    const membersList = projectMembers
      .map((member: any) => {
        const roleIcon = member.role === "manager" ? "👑" : "👤";
        return `
          <div class="member-item" data-user-id="${member.user_id}">
            <span class="member-info">
              ${roleIcon} ${escapeHtml(member.username)} 
              <small>(${member.role})</small>
            </span>
            <div class="member-actions">
              ${
                member.user_id !== project.manager_id
                  ? `
                <select class="role-select" data-user-id="${member.user_id}">
                  <option value="member" ${
                    member.role === "member" ? "selected" : ""
                  }>Member</option>
                  <option value="manager" ${
                    member.role === "manager" ? "selected" : ""
                  }>Manager</option>
                </select>
                <button class="btn-remove-member" data-user-id="${
                  member.user_id
                }">Remove</button>
              `
                  : '<span class="manager-label">Project Manager</span>'
              }
            </div>
          </div>
        `;
      })
      .join("");

    const availableUsers = allUsers.filter(
      (user: any) =>
        !projectMembers.some((member: any) => member.user_id === user.id)
    );

    const userOptions = availableUsers
      .map(
        (user: any) =>
          `<option value="${user.id}">${escapeHtml(user.username)}</option>`
      )
      .join("");

    modal.innerHTML = `
      <div class="session-modal-content">
        <button class="modal-close-btn">&times;</button>
        <h2>Manage Members - ${escapeHtml(project.name)}</h2>
        
        <div class="members-section">
          <h3>Current Members</h3>
          <div class="members-list">
            ${membersList}
          </div>
        </div>

        ${
          availableUsers.length > 0
            ? `
          <div class="add-member-section">
            <h3>Add New Member</h3>
            <div class="add-member-form">
              <select id="userSelect">
                <option value="">Select a user...</option>
                ${userOptions}
              </select>
              <select id="roleSelect">
                <option value="member">Member</option>
                <option value="manager">Manager</option>
              </select>
              <button id="addMemberBtn" class="btn-confirm">Add Member</button>
            </div>
          </div>
        `
            : "<p><em>All users are already members of this project.</em></p>"
        }
        
        <div class="session-modal-actions">
          <button type="button" id="membersCloseBtn" class="btn-cancel">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Event listeners
    const closeBtn = modal.querySelector(
      ".modal-close-btn"
    ) as HTMLButtonElement;
    const cancelBtn = modal.querySelector(
      "#membersCloseBtn"
    ) as HTMLButtonElement;
    const addMemberBtn = modal.querySelector(
      "#addMemberBtn"
    ) as HTMLButtonElement;

    const closeModal = () => {
      modal.remove();
      overlay.remove();
    };

    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;

    // Add member functionality
    if (addMemberBtn) {
      addMemberBtn.onclick = async () => {
        const userSelect = modal.querySelector(
          "#userSelect"
        ) as HTMLSelectElement;
        const roleSelect = modal.querySelector(
          "#roleSelect"
        ) as HTMLSelectElement;

        if (userSelect.value) {
          try {
            await ipcRenderer.invoke(
              "add-project-member",
              projectId,
              parseInt(userSelect.value),
              roleSelect.value
            );
            showInAppNotification("Member added successfully!", 3000);
            closeModal();
            renderProjects(); // Refresh projects
          } catch (error) {
            showInAppNotification("Failed to add member", 5000);
          }
        }
      };
    }

    // Role change functionality
    modal.addEventListener("change", async (e) => {
      const target = e.target as HTMLSelectElement;
      if (target.classList.contains("role-select")) {
        const userId = parseInt(target.dataset.userId!);
        const newRole = target.value as "manager" | "member";

        try {
          if (newRole === "manager") {
            // Transfer management
            await ipcRenderer.invoke(
              "transfer-project-management",
              projectId,
              userId
            );
          } else {
            await ipcRenderer.invoke(
              "update-project-member-role",
              projectId,
              userId,
              newRole
            );
          }
          showInAppNotification("Role updated successfully!", 3000);
          closeModal();
          renderProjects(); // Refresh projects
        } catch (error) {
          showInAppNotification("Failed to update role", 5000);
          // Revert the select value
          target.value = target.value === "manager" ? "member" : "manager";
        }
      }
    });

    // Remove member functionality
    modal.addEventListener("click", async (e) => {
      const target = e.target as HTMLButtonElement;
      if (target.classList.contains("btn-remove-member")) {
        const userId = parseInt(target.dataset.userId!);

        showConfirmationModal({
          title: "Remove Member",
          message:
            "Are you sure you want to remove this member from the project?",
          confirmText: "Remove",
          onConfirm: async () => {
            try {
              await ipcRenderer.invoke(
                "remove-project-member",
                projectId,
                userId
              );
              showInAppNotification("Member removed successfully!", 3000);
              closeModal();
              renderProjects(); // Refresh projects
            } catch (error) {
              showInAppNotification("Failed to remove member", 5000);
            }
          },
        });
      }
    });

    // Handle overlay click to close
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        closeModal();
      }
    };

    // Prevent modal content clicks from closing modal
    modal
      .querySelector(".session-modal-content")
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
      });
  } catch (error) {
    showInAppNotification("Failed to load project members", 5000);
  }
}
