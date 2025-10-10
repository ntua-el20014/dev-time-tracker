/* eslint-disable @typescript-eslint/no-explicit-any */
import { showNotification, showConfirmationModal } from "./components";
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
} from "./utils/organizationApi";
import type {
  Organization,
  UserProfile,
  OrgJoinRequestWithUser,
} from "../src/types/organization.types";

let currentOrg: Organization | null = null;
let currentUserProfile: UserProfile | null = null;
let orgMembers: UserProfile[] = [];
let pendingRequests: OrgJoinRequestWithUser[] = [];
let cleanupFunctions: (() => void)[] = [];

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

    // Debug logging
    // eslint-disable-next-line no-console
    console.log("Organization Tab Debug:");
    // eslint-disable-next-line no-console
    console.log("- currentUserProfile:", currentUserProfile);
    // eslint-disable-next-line no-console
    console.log("- currentOrg:", currentOrg);
    // eslint-disable-next-line no-console
    console.log(
      "- localStorage userId:",
      localStorage.getItem("currentUserId")
    );

    if (!currentOrg || !currentUserProfile) {
      container.innerHTML = `
        <div class="org-error">
          <h3>No organization found</h3>
          <p><strong>Debug Info:</strong></p>
          <ul style="text-align: left; margin: 10px 20px;">
            <li>User Profile: ${currentUserProfile ? "Found" : "Not Found"}</li>
            <li>Organization: ${currentOrg ? "Found" : "Not Found"}</li>
            <li>User ID in localStorage: ${
              localStorage.getItem("currentUserId") || "Not Set"
            }</li>
          </ul>
          <p>Please check the console for more details.</p>
        </div>
      `;
      return;
    }

    // Fetch members and requests
    orgMembers = await getOrganizationMembers(currentOrg.id);
    if (isAdmin()) {
      pendingRequests = await getPendingJoinRequests();
    }

    // Render all sections
    container.innerHTML = `
      <div id="org-inner">
        <h1 class="org-title">Organization Management</h1>
        <div id="org-info-section"></div>
        <div id="org-members-section"></div>
        <div id="org-join-section"></div>
        <div id="org-requests-section"></div>
      </div>
    `;

    renderOrganizationInfo();
    renderMembersList();
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
            <span class="org-uuid" title="${currentOrg.id}">${
    currentOrg.id
  }</span>
          </div>
        </div>
        <div class="org-actions">
          ${
            orgType === "Personal"
              ? '<button id="create-team-org-btn" class="btn btn-primary">Create Team Organization</button>'
              : ""
          }
          <button id="copy-org-id-btn" class="btn btn-secondary">Copy Organization ID</button>
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
      createBtn.removeEventListener("click", handleCreate)
    );
  }

  const copyBtn = document.getElementById("copy-org-id-btn");
  if (copyBtn) {
    const handleCopy = () => copyOrgId();
    copyBtn.addEventListener("click", handleCopy);
    cleanupFunctions.push(() =>
      copyBtn.removeEventListener("click", handleCopy)
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
                            member.username
                          )}">Remove</button>`
                        : `<span class="text-muted">You</span>`
                    }
                  </td>
                `
                    : ""
                }
              </tr>
            `
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
        select.removeEventListener("change", handleChange)
      );
    });

    const removeButtons = container.querySelectorAll(".remove-member-btn");
    removeButtons.forEach((btn) => {
      const handleRemove = () =>
        handleRemoveMember(
          btn.getAttribute("data-user-id")!,
          btn.getAttribute("data-username")!
        );
      btn.addEventListener("click", handleRemove);
      cleanupFunctions.push(() =>
        btn.removeEventListener("click", handleRemove)
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
    "join-org-input"
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
            `
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
      btn.removeEventListener("click", handleApprove)
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
    "create-org-confirm-btn"
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
        }`
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
    (err) => {
      // eslint-disable-next-line no-console
      console.error("Failed to copy:", err);
      showNotification("Failed to copy Organization ID");
    }
  );
}

async function handleJoinOrganization(orgId: string) {
  if (!orgId) {
    showNotification("Please enter an organization ID");
    return;
  }

  const joinBtn = document.getElementById("join-org-btn") as HTMLButtonElement;
  const joinInput = document.getElementById(
    "join-org-input"
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
      `Join request sent to ${targetOrg.name}. Waiting for approval.`
    );
    joinInput.value = "";
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error joining organization:", error);
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
        "Cannot change role: Organization must have at least one admin"
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
    // eslint-disable-next-line no-console
    console.error("Error updating role:", error);
    showNotification(
      `Failed to update role: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
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
          // eslint-disable-next-line no-console
          console.error("Error removing member:", error);
          showNotification(
            `Failed to remove member: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
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
    // eslint-disable-next-line no-console
    console.error("Error approving request:", error);
    showNotification(
      `Failed to approve request: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

async function handleRejectRequest(requestId: string) {
  try {
    await rejectJoinRequest(requestId);
    showNotification("Join request rejected");
    await renderOrganizationTab(); // Refresh
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error rejecting request:", error);
    showNotification(
      `Failed to reject request: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
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
