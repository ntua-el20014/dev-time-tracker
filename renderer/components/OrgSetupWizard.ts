/**
 * Organization Setup Wizard
 * Multi-step modal that guides users through org setup.
 * Triggered on first login and after leaving an organization.
 */

import { showNotification } from "./Notifications";
import {
  getCurrentOrganization,
  createTeamOrganization,
  joinWithInviteCode,
  requestToJoinOrganization,
} from "../utils/organizationApi";
import { getCurrentUserId } from "../utils";

type WizardPath = "choose" | "solo" | "create-team" | "join-team" | "done";

interface WizardState {
  path: WizardPath;
  orgName?: string;
  inviteCode?: string;
  joinOrgId?: string;
  resultOrgName?: string;
}

let wizardOverlay: HTMLDivElement | null = null;

/**
 * Check if the org setup wizard should be shown.
 * Returns true if user has no org or only the auto-created personal org
 * and hasn't dismissed the wizard before.
 */
export async function shouldShowOrgSetupWizard(): Promise<boolean> {
  const userId = getCurrentUserId();
  if (!userId) return false;

  // Check if user has dismissed the wizard
  if (localStorage.getItem(`org-wizard-dismissed-${userId}`)) {
    return false;
  }

  try {
    const org = await getCurrentOrganization();
    // Show wizard if user has no org
    if (!org) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Mark the wizard as dismissed so it won't show again for this user.
 */
function dismissWizard(): void {
  const userId = getCurrentUserId();
  if (userId) {
    localStorage.setItem(`org-wizard-dismissed-${userId}`, "true");
  }
}

/**
 * Clear the wizard dismissed flag (e.g., after leaving an org).
 */
export function resetOrgWizardDismissed(): void {
  const userId = getCurrentUserId();
  if (userId) {
    localStorage.removeItem(`org-wizard-dismissed-${userId}`);
  }
}

/**
 * Show the Organization Setup Wizard modal.
 */
export function showOrgSetupWizard(): void {
  const state: WizardState = { path: "choose" };
  renderWizardStep(state);
}

function cleanup(): void {
  if (wizardOverlay) {
    wizardOverlay.remove();
    wizardOverlay = null;
  }
}

function renderWizardStep(state: WizardState): void {
  cleanup();

  wizardOverlay = document.createElement("div");
  wizardOverlay.className = "org-wizard-overlay";

  const content = document.createElement("div");
  content.className = "org-wizard-content";

  // Prevent overlay click from closing on non-dismissible steps
  wizardOverlay.addEventListener("click", (e) => {
    if (e.target === wizardOverlay) {
      // Allow closing on the choose step only
      if (state.path === "choose") {
        cleanup();
        dismissWizard();
      }
    }
  });

  content.addEventListener("click", (e) => e.stopPropagation());

  switch (state.path) {
    case "choose":
      renderChooseStep(content, state);
      break;
    case "solo":
      renderSoloStep(content, state);
      break;
    case "create-team":
      renderCreateTeamStep(content, state);
      break;
    case "join-team":
      renderJoinTeamStep(content, state);
      break;
    case "done":
      renderDoneStep(content, state);
      break;
  }

  wizardOverlay.appendChild(content);
  document.body.appendChild(wizardOverlay);
}

// =========================================================
// Step 1: Choose your path
// =========================================================
function renderChooseStep(content: HTMLDivElement, state: WizardState): void {
  content.innerHTML = `
    <button class="org-wizard-close-btn">&times;</button>
    <div class="org-wizard-header">
      <div class="org-wizard-icon">🏢</div>
      <h2>Set Up Your Organization</h2>
      <p class="org-wizard-subtitle">How would you like to use Dev Time Tracker?</p>
    </div>
    <div class="org-wizard-body">
      <div class="org-wizard-choices">
        <button class="org-wizard-choice-card" data-choice="solo">
          <span class="choice-icon">👤</span>
          <span class="choice-title">I'm working solo</span>
          <span class="choice-desc">Keep your personal organization and start tracking right away.</span>
        </button>
        <button class="org-wizard-choice-card" data-choice="create-team">
          <span class="choice-icon">🚀</span>
          <span class="choice-title">Create a team</span>
          <span class="choice-desc">Start a new team organization and invite members.</span>
        </button>
        <button class="org-wizard-choice-card" data-choice="join-team">
          <span class="choice-icon">🤝</span>
          <span class="choice-title">Join a team</span>
          <span class="choice-desc">Join an existing organization with an invite code or request access.</span>
        </button>
      </div>
    </div>
    <div class="org-wizard-footer">
      <button class="org-wizard-skip">Skip for now</button>
    </div>
  `;

  // Event listeners
  content
    .querySelector(".org-wizard-close-btn")
    ?.addEventListener("click", () => {
      cleanup();
      dismissWizard();
    });

  content.querySelector(".org-wizard-skip")?.addEventListener("click", () => {
    cleanup();
    dismissWizard();
  });

  content.querySelectorAll(".org-wizard-choice-card").forEach((card) => {
    card.addEventListener("click", () => {
      const choice = (card as HTMLElement).dataset.choice as WizardPath;
      state.path = choice;
      renderWizardStep(state);
    });
  });
}

// =========================================================
// Solo path — confirm keeping personal org
// =========================================================
function renderSoloStep(content: HTMLDivElement, state: WizardState): void {
  content.innerHTML = `
    <div class="org-wizard-header">
      <div class="org-wizard-icon">👤</div>
      <h2>Working Solo</h2>
    </div>
    <div class="org-wizard-body">
      <p>Your personal organization is already set up. You can start tracking your time right away!</p>
      <p class="org-wizard-hint">You can always create or join a team later from the <b>Organization</b> tab.</p>
    </div>
    <div class="org-wizard-footer">
      <button class="org-wizard-back">← Back</button>
      <button class="org-wizard-primary">Get Started!</button>
    </div>
  `;

  content.querySelector(".org-wizard-back")?.addEventListener("click", () => {
    state.path = "choose";
    renderWizardStep(state);
  });

  content
    .querySelector(".org-wizard-primary")
    ?.addEventListener("click", () => {
      cleanup();
      dismissWizard();
    });
}

// =========================================================
// Create team path
// =========================================================
function renderCreateTeamStep(
  content: HTMLDivElement,
  state: WizardState,
): void {
  content.innerHTML = `
    <div class="org-wizard-header">
      <div class="org-wizard-icon">🚀</div>
      <h2>Create Your Team</h2>
    </div>
    <div class="org-wizard-body">
      <div class="org-wizard-form-group">
        <label for="wizard-team-name">Team name</label>
        <input type="text" id="wizard-team-name" class="org-wizard-input" placeholder="e.g. My Awesome Team" maxlength="100" value="${state.orgName || ""}" />
      </div>
      <p class="org-wizard-hint">You'll be the admin of this team. You can invite members after setup.</p>
    </div>
    <div class="org-wizard-footer">
      <button class="org-wizard-back">← Back</button>
      <button class="org-wizard-primary" id="wizard-create-team-btn">Create Team</button>
    </div>
    <div class="org-wizard-error" id="wizard-error" style="display:none;"></div>
  `;

  const nameInput = content.querySelector(
    "#wizard-team-name",
  ) as HTMLInputElement;
  const createBtn = content.querySelector(
    "#wizard-create-team-btn",
  ) as HTMLButtonElement;
  const errorDiv = content.querySelector("#wizard-error") as HTMLDivElement;

  nameInput.focus();

  nameInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") createBtn.click();
  });

  content.querySelector(".org-wizard-back")?.addEventListener("click", () => {
    state.orgName = nameInput.value;
    state.path = "choose";
    renderWizardStep(state);
  });

  createBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) {
      errorDiv.textContent = "Please enter a team name.";
      errorDiv.style.display = "block";
      return;
    }

    createBtn.disabled = true;
    createBtn.textContent = "Creating...";
    errorDiv.style.display = "none";

    try {
      await createTeamOrganization({ name });
      state.resultOrgName = name;
      state.path = "done";
      renderWizardStep(state);
    } catch (error) {
      errorDiv.textContent = `Failed: ${error instanceof Error ? error.message : "Unknown error"}`;
      errorDiv.style.display = "block";
      createBtn.disabled = false;
      createBtn.textContent = "Create Team";
    }
  });
}

// =========================================================
// Join team path
// =========================================================
function renderJoinTeamStep(content: HTMLDivElement, state: WizardState): void {
  content.innerHTML = `
    <div class="org-wizard-header">
      <div class="org-wizard-icon">🤝</div>
      <h2>Join a Team</h2>
    </div>
    <div class="org-wizard-body">
      <div class="org-wizard-form-group">
        <label for="wizard-invite-code">Invite code</label>
        <input type="text" id="wizard-invite-code" class="org-wizard-input" placeholder="e.g. XXXX-XXXX-XXXX" maxlength="14" value="${state.inviteCode || ""}" />
      </div>

      <div class="org-wizard-divider"><span>or</span></div>

      <div class="org-wizard-form-group">
        <label for="wizard-org-uuid">Organization ID</label>
        <input type="text" id="wizard-org-uuid" class="org-wizard-input" placeholder="Paste the org UUID to request access" value="${state.joinOrgId || ""}" />
        <p class="org-wizard-hint">Ask an admin for the organization's ID. They'll need to approve your request.</p>
      </div>
    </div>
    <div class="org-wizard-footer">
      <button class="org-wizard-back">← Back</button>
      <div class="org-wizard-footer-actions">
        <button class="org-wizard-secondary" id="wizard-request-btn">Request Access</button>
        <button class="org-wizard-primary" id="wizard-join-btn">Join with Code</button>
      </div>
    </div>
    <div class="org-wizard-error" id="wizard-error" style="display:none;"></div>
  `;

  const codeInput = content.querySelector(
    "#wizard-invite-code",
  ) as HTMLInputElement;
  const uuidInput = content.querySelector(
    "#wizard-org-uuid",
  ) as HTMLInputElement;
  const joinBtn = content.querySelector(
    "#wizard-join-btn",
  ) as HTMLButtonElement;
  const requestBtn = content.querySelector(
    "#wizard-request-btn",
  ) as HTMLButtonElement;
  const errorDiv = content.querySelector("#wizard-error") as HTMLDivElement;

  codeInput.focus();

  content.querySelector(".org-wizard-back")?.addEventListener("click", () => {
    state.inviteCode = codeInput.value;
    state.joinOrgId = uuidInput.value;
    state.path = "choose";
    renderWizardStep(state);
  });

  // Join with invite code
  joinBtn.addEventListener("click", async () => {
    const code = codeInput.value.trim();
    if (!code) {
      errorDiv.textContent = "Please enter an invite code.";
      errorDiv.style.display = "block";
      return;
    }

    joinBtn.disabled = true;
    joinBtn.textContent = "Joining...";
    errorDiv.style.display = "none";

    try {
      const result = await joinWithInviteCode(code);
      state.resultOrgName = (result as any)?.organization?.name || "the team";
      state.path = "done";
      renderWizardStep(state);
    } catch (error) {
      errorDiv.textContent = `Failed: ${error instanceof Error ? error.message : "Invalid or expired code"}`;
      errorDiv.style.display = "block";
      joinBtn.disabled = false;
      joinBtn.textContent = "Join with Code";
    }
  });

  // Request to join with UUID
  requestBtn.addEventListener("click", async () => {
    const orgId = uuidInput.value.trim();
    if (!orgId) {
      errorDiv.textContent = "Please enter an organization ID.";
      errorDiv.style.display = "block";
      return;
    }

    requestBtn.disabled = true;
    requestBtn.textContent = "Requesting...";
    errorDiv.style.display = "none";

    try {
      await requestToJoinOrganization(orgId);
      showNotification("Request sent! An admin will review your request.");
      cleanup();
      dismissWizard();
    } catch (error) {
      errorDiv.textContent = `Failed: ${error instanceof Error ? error.message : "Unknown error"}`;
      errorDiv.style.display = "block";
      requestBtn.disabled = false;
      requestBtn.textContent = "Request Access";
    }
  });
}

// =========================================================
// Done step — confirmation
// =========================================================
function renderDoneStep(content: HTMLDivElement, state: WizardState): void {
  content.innerHTML = `
    <div class="org-wizard-header">
      <div class="org-wizard-icon">🎉</div>
      <h2>You're All Set!</h2>
    </div>
    <div class="org-wizard-body org-wizard-done-body">
      <div class="org-wizard-done-card">
        <div class="org-wizard-done-row">
          <label>Organization:</label>
          <span>${escapeHtml(state.resultOrgName || "Your Team")}</span>
        </div>
        <div class="org-wizard-done-row">
          <label>Role:</label>
          <span class="role-badge role-admin">Admin</span>
        </div>
      </div>
      <p class="org-wizard-hint">You can manage your organization, invite members, and create projects from the <b>Organization</b> tab.</p>
    </div>
    <div class="org-wizard-footer">
      <button class="org-wizard-primary" id="wizard-finish-btn">Go to Dashboard</button>
      <button class="org-wizard-secondary" id="wizard-go-org-btn">Open Organization Tab</button>
    </div>
  `;

  content.querySelector("#wizard-finish-btn")?.addEventListener("click", () => {
    cleanup();
    dismissWizard();
  });

  content.querySelector("#wizard-go-org-btn")?.addEventListener("click", () => {
    cleanup();
    dismissWizard();
    // Switch to the organization tab
    const orgTab = document.querySelector(
      '.tab[data-tab="organization"]',
    ) as HTMLButtonElement;
    if (orgTab) orgTab.click();
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
