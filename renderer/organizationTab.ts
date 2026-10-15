/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  showNotification,
  showInAppNotification,
  showConfirmationModal,
} from "./components";
import { escapeHtml } from "./utils/domUtils";
import {
  getCurrentOrganization,
  getOrganizationMembers,
  createTeamOrganization,
  createPersonalOrganization,
  requestToJoinOrganization,
  getPendingJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
  updateUserRole,
  removeUserFromOrganization,
  getCurrentUserProfile,
  getOrganizationById,
  generateInviteCode,
  listInviteCodes,
  revokeInviteCode,
  joinWithInviteCode,
} from "./utils/organizationApi";
import { withLoading } from "./utils";
import { navigateTo } from "./navigation";
import type {
  Organization,
  UserProfile,
  OrgJoinRequestWithUser,
  OrgInviteCode,
} from "../src/types/organization.types";

let currentOrg: Organization | null = null;
let currentUserProfile: UserProfile | null = null;
let orgMembers: UserProfile[] = [];
let pendingRequests: OrgJoinRequestWithUser[] = [];
let inviteCodes: OrgInviteCode[] = [];
let cleanupFunctions: (() => void)[] = [];

function notifyOrganizationChanged(): void {
  window.dispatchEvent(new Event("organization:changed"));
}

async function refreshOrganizationTab(): Promise<void> {
  notifyOrganizationChanged();
  await renderOrganizationTab();
}

/**
 * Main render function for Organization Tab
 */
export async function renderOrganizationTab() {
  const container = document.getElementById("organizationContent");
  if (!container) return;

  // Cleanup previous event listeners
  cleanupFunctions.forEach((cleanup) => cleanup());
  cleanupFunctions = [];

  try {
    // Fetch data (with loading indicator)
    let fetchError = false;
    await withLoading(container, "Loading organization…", async () => {
      currentUserProfile = await getCurrentUserProfile();
      currentOrg = await getCurrentOrganization();
    }).catch(() => {
      fetchError = true;
    });
    if (fetchError) {
      container.innerHTML =
        '<div class="org-loading"><p>Failed to load organization data.</p></div>';
      return;
    }

    if (!currentOrg || !currentUserProfile) {
      container.innerHTML = `
        <div id="org-inner">
          <h1 class="org-title">Organization Management</h1>
          <div class="org-section">
            <h2>🏢 No Organization</h2>
            <div class="org-join-card">
              <p>You're not part of an organization yet. Create your own or join one with an invite code.</p>

              <div style="margin-top: 1.5rem;">
                <h3 style="margin-bottom: 0.75rem;">Create Organization</h3>
                <div class="org-join-form">
                  <input type="text" id="new-org-name-input" class="org-input" placeholder="Organization name" />
                  <button id="create-org-btn" class="btn btn-primary">Create</button>
                </div>
              </div>

              <div class="join-methods-divider">or</div>

              <div>
                <h3 style="margin-bottom: 0.75rem;">Join with Invite Code</h3>
                <div class="join-with-code-form">
                  <input type="text" id="join-code-input" class="join-code-input" placeholder="Enter invite code (e.g. XXXX-XXXX-XXXX)" maxlength="14" />
                  <button id="join-code-btn" class="btn btn-primary">Join</button>
                </div>
              </div>

              <div class="join-methods-divider">or</div>

              <div>
                <h3 style="margin-bottom: 0.75rem;">Request to Join</h3>
                <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 0.5rem;">If you have an organization's UUID, you can request to join it:</p>
                <div class="org-join-form">
                  <input type="text" id="join-org-input" class="org-input" placeholder="Enter Organization UUID" />
                  <button id="join-org-btn" class="btn btn-secondary">Request to Join</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      // Create org handler
      const createBtn = document.getElementById("create-org-btn");
      const createInput = document.getElementById(
        "new-org-name-input",
      ) as HTMLInputElement;
      if (createBtn && createInput) {
        const handleCreate = async () => {
          const name = createInput.value.trim();
          if (!name) {
            showInAppNotification("Please enter an organization name");
            return;
          }
          try {
            createBtn.setAttribute("disabled", "true");
            createBtn.textContent = "Creating...";
            await createPersonalOrganization(name);
            showInAppNotification("Organization created successfully!");
            (window as any).markTabsDirty("organization");
            await refreshOrganizationTab();
          } catch (error) {
            showNotification(
              `Failed to create organization: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
            createBtn.removeAttribute("disabled");
            createBtn.textContent = "Create";
          }
        };
        createBtn.addEventListener("click", handleCreate);
        createInput.addEventListener("keypress", (e: KeyboardEvent) => {
          if (e.key === "Enter") handleCreate();
        });
      }

      // Join with code handler
      const joinCodeBtn = document.getElementById("join-code-btn");
      const joinCodeInput = document.getElementById(
        "join-code-input",
      ) as HTMLInputElement;
      if (joinCodeBtn && joinCodeInput) {
        const handleJoinCode = async () => {
          const code = joinCodeInput.value.trim();
          if (!code) {
            showInAppNotification("Please enter an invite code");
            return;
          }
          try {
            joinCodeBtn.setAttribute("disabled", "true");
            joinCodeBtn.textContent = "Joining...";
            const result = await joinWithInviteCode(code);
            showNotification(
              result?.org_name
                ? `Successfully joined ${result.org_name}!`
                : "Successfully joined!",
            );
            (window as any).markTabsDirty("organization");
            await refreshOrganizationTab();
          } catch (error) {
            showNotification(
              `Failed to join: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
            joinCodeBtn.removeAttribute("disabled");
            joinCodeBtn.textContent = "Join";
          }
        };
        joinCodeBtn.addEventListener("click", handleJoinCode);
        joinCodeInput.addEventListener("keypress", (e: KeyboardEvent) => {
          if (e.key === "Enter") handleJoinCode();
        });
      }

      // Join with UUID handler
      const joinOrgBtn = document.getElementById("join-org-btn");
      const joinOrgInput = document.getElementById(
        "join-org-input",
      ) as HTMLInputElement;
      if (joinOrgBtn && joinOrgInput) {
        const handleJoinOrg = async () => {
          const orgId = joinOrgInput.value.trim();
          if (!orgId) {
            showInAppNotification("Please enter an organization ID");
            return;
          }
          try {
            joinOrgBtn.setAttribute("disabled", "true");
            joinOrgBtn.textContent = "Requesting...";
            await requestToJoinOrganization(orgId);
            showInAppNotification("Join request sent! Waiting for approval.");
            joinOrgInput.value = "";
          } catch (error) {
            showNotification(
              `Failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
          } finally {
            joinOrgBtn.removeAttribute("disabled");
            joinOrgBtn.textContent = "Request to Join";
          }
        };
        joinOrgBtn.addEventListener("click", handleJoinOrg);
        joinOrgInput.addEventListener("keypress", (e: KeyboardEvent) => {
          if (e.key === "Enter") handleJoinOrg();
        });
      }

      return;
    }

    // Fetch members and requests
    orgMembers = await getOrganizationMembers(currentOrg.id);
    if (isAdmin()) {
      pendingRequests = await getPendingJoinRequests();
    }

    // Fetch invite codes if user can manage them
    if (isAdmin() || isManager()) {
      inviteCodes = await listInviteCodes(currentOrg.id);
    }


    // Render all sections
    container.innerHTML = `
      <div id="org-inner">
        <h1 class="org-title">Organization Management</h1>
        <div id="org-info-section"></div>
        <div id="org-members-section"></div>
        <div id="org-invite-codes-section"></div>
        <div id="org-projects-section"></div>
        <div id="org-requests-section"></div>
      </div>
    `;

    renderOrganizationInfo();
    renderMembersList();
    if (isAdmin() || isManager()) {
      renderInviteCodes();
      renderProjectsPointer();
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
  const canViewOrgId = isAdmin() || isManager();
  const isPersonalOrg = orgType === "Personal";

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
          ${
            canViewOrgId
              ? `
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
          `
              : ""
          }
        </div>
        ${
          isPersonalOrg
            ? `
        <div class="info-note" style="margin-top: 1rem;">
          This is your automatically created personal organization. To join an existing team, leave it first, then use an invite code or request access.
        </div>
        `
            : ""
        }
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

  const canManageMembers = isAdmin() || isManager();
  const canViewDetails = isAdmin() || isManager();

  container.innerHTML = `
    <div class="org-section">
      <h2>👥 Members</h2>
      <div class="org-members-card">
        <table class="org-members-table">
          <thead>
            <tr>
              <th>Avatar</th>
              <th>Username</th>
              ${canViewDetails ? "<th>Email</th>" : ""}
              <th>Role</th>
              ${canManageMembers ? "<th>Update</th><th>Remove</th>" : ""}
            </tr>
          </thead>
          <tbody>
            ${orgMembers
              .map(
                (member) => `
              <tr>
                <td class="member-avatar-cell">${renderMemberAvatar(member)}</td>
                <td>${escapeHtml(member.username)}</td>
                ${
                  canViewDetails
                    ? `<td>${escapeHtml(member.email || "N/A")}</td>`
                    : ""
                }
                <td>
                  ${
                    canManageMembers && canManageMember(member)
                      ? `
                    <select class="role-select" data-user-id="${
                      member.id
                    }" data-current-role="${member.role}">
                      ${getAssignableRoles(member)
                        .map(
                          (role) =>
                            `<option value="${role}" ${
                              member.role === role ? "selected" : ""
                            }>${role[0].toUpperCase() + role.slice(1)}</option>`,
                        )
                        .join("")}
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
                      canManageMember(member)
                        ? `<button class="btn btn-primary btn-sm update-role-btn" data-user-id="${member.id}">Update</button>`
                        : `<span class="text-muted">-</span>`
                    }
                  </td>
                  <td>
                    ${
                      canManageMember(member)
                        ? `<button class="remove-member-x-btn" title="Remove ${escapeHtml(
                            member.username,
                          )}" aria-label="Remove ${escapeHtml(
                            member.username,
                          )}" data-user-id="${member.id}" data-username="${escapeHtml(
                            member.username,
                          )}">✕</button>`
                        : `<span class="text-muted">-</span>`
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
    const updateButtons = container.querySelectorAll(".update-role-btn");
    updateButtons.forEach((btn) => {
      const handleUpdate = async () => {
        const userId = btn.getAttribute("data-user-id");
        if (!userId) return;
        const select = container.querySelector(
          `.role-select[data-user-id="${userId}"]`,
        ) as HTMLSelectElement | null;
        if (!select) return;
        await handleRoleChange(select, btn as HTMLButtonElement);
      };
      btn.addEventListener("click", handleUpdate);
      cleanupFunctions.push(() =>
        btn.removeEventListener("click", handleUpdate),
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
 * Render invite codes section (admin/manager only)
 */
function renderInviteCodes() {
  const container = document.getElementById("org-invite-codes-section");
  if (!container || (!isAdmin() && !isManager())) return;

  const activeInviteCodes = inviteCodes.filter((c) => {
    if (!c.is_active) return false;
    if (c.expires_at && new Date(c.expires_at) < new Date()) return false;
    if (c.max_uses !== null && c.use_count >= c.max_uses) return false;
    return true;
  });
  const inactiveInviteCodes = inviteCodes.filter(
    (c) => !activeInviteCodes.includes(c),
  );

  container.innerHTML = `
    <div class="org-section">
      <h2>🔑 Invite Codes</h2>
      <div class="invite-codes-card">
        <div class="invite-codes-header">
          <p>Generate invite codes to let others join your organization instantly.</p>
        </div>

        <div class="generate-code-form">
          <div class="form-group">
            <label for="invite-max-uses">Max Uses</label>
            <select id="invite-max-uses">
              <option value="">Unlimited</option>
              <option value="1">1 use</option>
              <option value="5">5 uses</option>
              <option value="10">10 uses</option>
              <option value="25">25 uses</option>
              <option value="50">50 uses</option>
            </select>
          </div>
          <div class="form-group">
            <label for="invite-expiry">Expires In</label>
            <select id="invite-expiry">
              <option value="">Never</option>
              <option value="1">1 day</option>
              <option value="7" selected>7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
          </div>
          <button id="generate-invite-btn" class="btn btn-primary">Generate Code</button>
        </div>

        ${
          activeInviteCodes.length > 0
            ? `
          <table class="invite-codes-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Uses</th>
                <th>Expires</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${activeInviteCodes
                .map(
                  (code) => `
                <tr>
                  <td>
                    <span class="invite-code-display">
                      ${escapeHtml(code.code)}
                      <button class="invite-code-copy-btn copy-invite-code-btn" data-code="${escapeHtml(
                        code.code,
                      )}" title="Copy code">📋</button>
                    </span>
                  </td>
                  <td>
                    <span class="uses-counter">
                      <span class="current">${code.use_count}</span>${
                        code.max_uses !== null
                          ? ` / <span class="max">${code.max_uses}</span>`
                          : ' / <span class="max">∞</span>'
                      }
                    </span>
                  </td>
                  <td>${
                    code.expires_at
                      ? formatExpiryDate(code.expires_at)
                      : "Never"
                  }</td>
                  <td><span class="code-status active">Active</span></td>
                  <td>
                    <button class="btn btn-danger btn-sm revoke-invite-btn" data-code-id="${
                      code.id
                    }">Revoke</button>
                  </td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>
        `
            : '<p class="text-muted" style="margin-top: 0.5rem;">No active invite codes. Generate one above to invite members.</p>'
        }

        ${
          inactiveInviteCodes.length > 0
            ? `
          <details style="margin-top: 1rem;">
            <summary style="cursor: pointer; color: var(--text-secondary); font-size: 0.9rem;">
              Show expired/revoked codes (${inactiveInviteCodes.length})
            </summary>
            <table class="invite-codes-table" style="margin-top: 0.5rem;">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Uses</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${inactiveInviteCodes
                  .map(
                    (code) => `
                  <tr>
                    <td style="opacity: 0.6;">
                      <span class="invite-code-display">${escapeHtml(
                        code.code,
                      )}</span>
                    </td>
                    <td>
                      <span class="uses-counter">
                        <span class="current">${code.use_count}</span>${
                          code.max_uses !== null
                            ? ` / <span class="max">${code.max_uses}</span>`
                            : ""
                        }
                      </span>
                    </td>
                    <td><span class="code-status ${getInviteCodeStatusClass(
                      code,
                    )}">${getInviteCodeStatusLabel(code)}</span></td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </details>
        `
            : ""
        }
      </div>
    </div>
  `;

  // Setup event listeners
  const generateBtn = document.getElementById("generate-invite-btn");
  if (generateBtn) {
    const handleGenerate = () => handleGenerateInviteCode();
    generateBtn.addEventListener("click", handleGenerate);
    cleanupFunctions.push(() =>
      generateBtn.removeEventListener("click", handleGenerate),
    );
  }

  const copyButtons = container.querySelectorAll(".copy-invite-code-btn");
  copyButtons.forEach((btn) => {
    const handleCopy = () => {
      const code = (btn as HTMLElement).getAttribute("data-code");
      if (code) {
        navigator.clipboard.writeText(code).then(
          () => showInAppNotification("Invite code copied to clipboard!", 2000),
          () => {}, // Silent failure
        );
      }
    };
    btn.addEventListener("click", handleCopy);
    cleanupFunctions.push(() => btn.removeEventListener("click", handleCopy));
  });

  const revokeButtons = container.querySelectorAll(".revoke-invite-btn");
  revokeButtons.forEach((btn) => {
    const handleRevoke = () => {
      const codeId = (btn as HTMLElement).getAttribute("data-code-id");
      if (codeId) handleRevokeInviteCode(codeId);
    };
    btn.addEventListener("click", handleRevoke);
    cleanupFunctions.push(() => btn.removeEventListener("click", handleRevoke));
  });
}

/**
 * Render join organization form
 */
function renderJoinForm() {
  const container = document.getElementById("org-join-section");
  if (!container) return;

  if (currentOrg) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="org-section">
      <h2>🔗 Join Organization</h2>
      <div class="org-join-card">
        <p>Have an invite code? Enter it below to join instantly:</p>
        <div class="join-with-code-form">
          <input type="text" id="join-code-input" class="join-code-input" placeholder="Enter invite code (e.g. XXXX-XXXX-XXXX)" maxlength="14" />
          <button id="join-code-btn" class="btn btn-primary">Join with Code</button>
        </div>

        <div class="join-methods-divider">or</div>

        <p>Enter an organization ID to request to join:</p>
        <div class="org-join-form">
          <input type="text" id="join-org-input" class="org-input" placeholder="Enter Organization UUID" />
          <button id="join-org-btn" class="btn btn-secondary">Request to Join</button>
        </div>
      </div>
    </div>
  `;

  // Join with invite code
  const joinCodeBtn = document.getElementById("join-code-btn");
  const joinCodeInput = document.getElementById(
    "join-code-input",
  ) as HTMLInputElement;

  if (joinCodeBtn && joinCodeInput) {
    const handleJoinWithCode = () =>
      handleJoinWithInviteCode(joinCodeInput.value.trim());
    joinCodeBtn.addEventListener("click", handleJoinWithCode);

    const handleCodeKeyPress = (e: KeyboardEvent) => {
      if (e.key === "Enter") handleJoinWithCode();
    };
    joinCodeInput.addEventListener("keypress", handleCodeKeyPress);

    cleanupFunctions.push(() => {
      joinCodeBtn.removeEventListener("click", handleJoinWithCode);
      joinCodeInput.removeEventListener("keypress", handleCodeKeyPress);
    });
  }

  // Join with org ID
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
 * Organization projects are managed on the Projects page (one UI for
 * personal and org projects); this section just points there.
 */
function renderProjectsPointer() {
  const container = document.getElementById("org-projects-section");
  if (!container) return;
  container.innerHTML = `
    <div class="org-section">
      <h2>📂 Organization Projects</h2>
      <p>Create organization projects, set rates and assign members on the <b>Projects</b> page.</p>
      <button id="open-projects-btn" class="btn btn-primary">Open Projects</button>
    </div>
  `;
  container
    .querySelector("#open-projects-btn")
    ?.addEventListener("click", () => navigateTo("projects"));
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
      showInAppNotification("Please enter an organization name");
      return;
    }

    try {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Creating...";

      await createTeamOrganization({ name });
      showInAppNotification("Team organization created successfully!");
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
      showInAppNotification("Organization ID copied to clipboard!", 2000);
    },
    () => {
      // Silent failure - clipboard operation
    },
  );
}

async function handleJoinOrganization(orgId: string) {
  if (!orgId) {
    showInAppNotification("Please enter an organization ID");
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
      showInAppNotification("Organization not found");
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

async function handleRoleChange(
  select: HTMLSelectElement,
  updateBtn?: HTMLButtonElement,
) {
  const userId = select.getAttribute("data-user-id");
  const currentRole = select.getAttribute("data-current-role");
  const newRole = select.value as "admin" | "manager" | "employee";

  if (!userId || newRole === currentRole) return;

  const targetMember = orgMembers.find((m) => m.id === userId);
  if (!targetMember || !canManageMember(targetMember)) {
    showNotification(
      "You do not have permission to change this member's role.",
    );
    select.value = currentRole || "employee";
    return;
  }

  if (
    getRoleRank(newRole) > getRoleRank(currentUserProfile?.role || "employee")
  ) {
    showInAppNotification("You cannot assign a role higher than your own.");
    select.value = currentRole || "employee";
    return;
  }

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
    if (updateBtn) {
      updateBtn.disabled = true;
      updateBtn.textContent = "Updating...";
    }
    await updateUserRole(userId, newRole);
    showNotification("User role updated successfully", 2000);
    await refreshOrganizationTab();
  } catch (error) {
    showNotification(
      `Failed to update role: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
    select.value = currentRole || "";
    select.disabled = false;
    if (updateBtn) {
      updateBtn.disabled = false;
      updateBtn.textContent = "Update";
    }
  }
}

async function handleRemoveMember(userId: string, username: string) {
  const member = orgMembers.find((m) => m.id === userId);
  if (!member || !canManageMember(member)) {
    showInAppNotification("You do not have permission to remove this member.");
    return;
  }

  // Check if trying to remove last admin
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
          await refreshOrganizationTab();
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
    showNotification("Join request approved", 2000);
    await refreshOrganizationTab();
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
    showNotification("Join request rejected", 2000);
    await refreshOrganizationTab();
  } catch (error) {
    showNotification(
      `Failed to reject request: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
}

// =====================================================
// INVITE CODE EVENT HANDLERS
// =====================================================

async function handleGenerateInviteCode() {
  const maxUsesSelect = document.getElementById(
    "invite-max-uses",
  ) as HTMLSelectElement;
  const expirySelect = document.getElementById(
    "invite-expiry",
  ) as HTMLSelectElement;
  const generateBtn = document.getElementById(
    "generate-invite-btn",
  ) as HTMLButtonElement;

  const maxUses = maxUsesSelect.value ? parseInt(maxUsesSelect.value) : null;
  const expiresInDays = expirySelect.value
    ? parseInt(expirySelect.value)
    : null;

  try {
    generateBtn.disabled = true;
    generateBtn.textContent = "Generating...";

    const result = await generateInviteCode({
      max_uses: maxUses,
      expires_in_days: expiresInDays,
    });

    if (result?.code) {
      // Copy to clipboard automatically
      await navigator.clipboard.writeText(result.code);
      showNotification(
        `Invite code ${result.code} generated and copied to clipboard!`,
      );
    } else {
      showNotification("Invite code generated!", 2000);
    }

    await refreshOrganizationTab();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    showNotification(`Failed to generate invite code: ${errorMsg}`);
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "Generate Code";
  }
}

async function handleRevokeInviteCode(codeId: string) {
  showConfirmationModal({
    title: "Revoke Invite Code",
    message:
      "Are you sure you want to revoke this invite code? It will no longer be usable.",
    confirmText: "Revoke",
    confirmClass: "btn btn-danger",
    onConfirm: async () => {
      try {
        await revokeInviteCode(codeId);
        showNotification("Invite code revoked", 2000);
        await refreshOrganizationTab();
      } catch (error) {
        showNotification(
          `Failed to revoke invite code: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }
    },
  });
}

async function handleJoinWithInviteCode(code: string) {
  if (!code) {
    showInAppNotification("Please enter an invite code");
    return;
  }

  const joinBtn = document.getElementById("join-code-btn") as HTMLButtonElement;
  const joinInput = document.getElementById(
    "join-code-input",
  ) as HTMLInputElement;

  try {
    joinBtn.disabled = true;
    joinBtn.textContent = "Joining...";

    const result = await joinWithInviteCode(code);

    if (result?.org_name) {
      showNotification(`Successfully joined ${result.org_name}!`);
    } else {
      showNotification("Successfully joined the organization!");
    }

    joinInput.value = "";
    await refreshOrganizationTab();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    showNotification(`Failed to join: ${errorMsg}`);
  } finally {
    joinBtn.disabled = false;
    joinBtn.textContent = "Join with Code";
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

function getRoleRank(role: "admin" | "manager" | "employee"): number {
  if (role === "admin") return 3;
  if (role === "manager") return 2;
  return 1;
}

function canManageMember(member: UserProfile): boolean {
  if (!currentUserProfile) return false;
  if (member.id === currentUserProfile.id) return false;

  const actorRank = getRoleRank(currentUserProfile.role);
  const targetRank = getRoleRank(member.role);
  return actorRank > targetRank;
}

function getAssignableRoles(
  member: UserProfile,
): Array<"admin" | "manager" | "employee"> {
  if (!currentUserProfile || !canManageMember(member)) {
    return [];
  }

  const actorRank = getRoleRank(currentUserProfile.role);
  const allRoles: Array<"admin" | "manager" | "employee"> = [
    "admin",
    "manager",
    "employee",
  ];

  return allRoles.filter((role) => getRoleRank(role) <= actorRank);
}

function renderMemberAvatar(member: UserProfile): string {
  const label = escapeHtml((member.username || "?").charAt(0).toUpperCase());
  if (member.avatar) {
    return `<img class="member-avatar" src="${escapeHtml(member.avatar)}" alt="${escapeHtml(member.username)} avatar" />`;
  }
  return `<span class="member-avatar member-avatar-fallback" aria-label="${escapeHtml(member.username)} avatar">${label}</span>`;
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

function formatExpiryDate(expiresAt: string): string {
  const expiry = new Date(expiresAt);
  const now = new Date();
  const diffMs = expiry.getTime() - now.getTime();

  if (diffMs <= 0) return "Expired";

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d remaining`;
  if (diffHours > 0) return `${diffHours}h remaining`;
  return "< 1h remaining";
}

function getInviteCodeStatusClass(code: OrgInviteCode): string {
  if (!code.is_active) return "revoked";
  if (code.expires_at && new Date(code.expires_at) < new Date())
    return "expired";
  if (code.max_uses !== null && code.use_count >= code.max_uses) return "maxed";
  return "active";
}

function getInviteCodeStatusLabel(code: OrgInviteCode): string {
  if (!code.is_active) return "Revoked";
  if (code.expires_at && new Date(code.expires_at) < new Date())
    return "Expired";
  if (code.max_uses !== null && code.use_count >= code.max_uses)
    return "Max uses reached";
  return "Active";
}
