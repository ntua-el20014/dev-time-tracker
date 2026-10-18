import { safeIpcInvoke } from "../utils/ipcHelpers";
import { escapeHtml } from "../utils/domUtils";
import { getLocalDateString } from "../../src/utils/timeFormat";
import {
  generateInvoicePDF,
  downloadInvoicePDF,
  calculateInvoiceData,
  DEFAULT_TEMPLATE,
  formatDate,
} from "../utils/invoiceUtils";
import type { InvoiceCustomization } from "../utils/invoiceUtils";
import { formatMoney, formatRate, normalizeCurrency } from "../../shared/currency";

/** A project with billable work in the range (get-projects-for-invoice) */
interface InvoiceProject {
  projectId: string;
  projectName: string;
  hourlyRate: number;
  /** Currency of the rate; an invoice holds one currency */
  currency?: string;
  totalSessions: number;
  /** Reported AI agent cost in the range (C6) */
  agentCostUsd?: number;
  agentCostIncomplete?: boolean;
  agentSessions?: number;
}

export async function showInvoiceGenerationModal(
  initialProjectId?: string,
): Promise<void> {
  // Clean up any existing modal
  const existingModal = document.getElementById("customModal");
  const existingOverlay = document.getElementById("customModalOverlay");
  if (existingModal) existingModal.remove();
  if (existingOverlay) existingOverlay.remove();

  const overlay = document.createElement("div");
  overlay.id = "customModalOverlay";
  overlay.className = "custom-modal-overlay";
  overlay.style.display = "block";
  document.body.appendChild(overlay);

  const modal = document.createElement("div");
  modal.id = "customModal";
  modal.className = "active";

  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

  /** Projects listed for the current range, and the ones ticked */
  let projects = new Map<string, InvoiceProject>();
  const selected = new Set<string>();

  modal.innerHTML = `
    <div class="session-modal-content">
      <button class="modal-close-btn">&times;</button>
      <h2>Generate Invoice</h2>
      <form id="invoiceForm">
        <div>
          <label>Date Range</label>
          <div class="date-range-container">
            <input 
              type="date" 
              id="invoice-start-date" 
              value="${getLocalDateString(thirtyDaysAgo)}"
            />
            <span>to</span>
            <input 
              type="date" 
              id="invoice-end-date" 
              value="${getLocalDateString(today)}"
            />
          </div>
        </div>

        <div>
          <label>Projects</label>
          <div id="invoice-projects-list">
            <p style="color: var(--fg-secondary); font-size: 12px; margin: 0;">Loading projects with billable hours...</p>
          </div>
        </div>

        <div id="invoice-agent-cost-row" hidden>
          <label class="invoice-project-label">
            <input type="checkbox" id="invoice-include-agent-cost" />
            <span class="invoice-project-info">
              <span class="invoice-project-name">Add AI agent costs as a line item</span>
              <span class="invoice-project-details" id="invoice-agent-cost-note"></span>
            </span>
          </label>
        </div>

        <div>
          <label for="invoice-company-name">Company Name *</label>
          <input 
            type="text" 
            id="invoice-company-name" 
            placeholder="Your company or name"
            required
          />
        </div>

        <div>
          <label for="invoice-notes">Notes (Optional)</label>
          <textarea 
            id="invoice-notes"
            placeholder="Add any additional notes or terms..."
          ></textarea>
        </div>

        <div>
          <label for="invoice-number">Invoice Number (Optional)</label>
          <input 
            type="text" 
            id="invoice-number"
            placeholder="e.g., INV-001"
          />
        </div>

        <div id="invoice-summary">
          <p>Select projects to see summary...</p>
        </div>

        <div class="session-modal-actions">
          <button type="button" id="cancel-invoice-modal" class="btn-cancel">Cancel</button>
          <button type="button" id="generate-invoice-btn" class="btn-confirm" disabled>Generate PDF</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  // Load projects with billable hours
  const startDate = (
    document.getElementById("invoice-start-date") as HTMLInputElement
  ).value;
  const endDate = (
    document.getElementById("invoice-end-date") as HTMLInputElement
  ).value;

  try {
    const projectsData = await safeIpcInvoke("get-projects-for-invoice", [
      startDate,
      endDate,
    ]);
    renderProjectsList(projectsData as InvoiceProject[], initialProjectId);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error loading projects:", error);
    const projectsList =
      document.getElementById("invoice-projects-list") ||
      document.createElement("div");
    projectsList.innerHTML =
      '<p style="color: var(--error-color, #d32f2f); font-size: 12px;">Failed to load projects</p>';
  }

  // Event listeners
  const closeBtn = modal.querySelector(".modal-close-btn") as HTMLButtonElement;
  const cancelBtn = document.getElementById(
    "cancel-invoice-modal",
  ) as HTMLButtonElement;
  const generateBtn = document.getElementById(
    "generate-invoice-btn",
  ) as HTMLButtonElement;

  closeBtn.addEventListener("click", () => {
    modal.remove();
    overlay.remove();
  });

  cancelBtn.addEventListener("click", () => {
    modal.remove();
    overlay.remove();
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      modal.remove();
      overlay.remove();
    }
  });

  // Update projects when date range changes
  document
    .getElementById("invoice-start-date")
    ?.addEventListener("change", updateProjects);
  document
    .getElementById("invoice-end-date")
    ?.addEventListener("change", updateProjects);

  // Generate invoice button
  generateBtn.addEventListener("click", generateAndDownloadInvoice);
  document
    .getElementById("invoice-include-agent-cost")
    ?.addEventListener("change", updateSummary);

  async function updateProjects() {
    const startDate = (
      document.getElementById("invoice-start-date") as HTMLInputElement
    ).value;
    const endDate = (
      document.getElementById("invoice-end-date") as HTMLInputElement
    ).value;

    try {
      const projectsData = await safeIpcInvoke("get-projects-for-invoice", [
        startDate,
        endDate,
      ]);
      renderProjectsList(projectsData as InvoiceProject[], initialProjectId);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Error updating projects:", error);
    }
  }

  function renderProjectsList(list: InvoiceProject[], initial?: string) {
    const projectsList = document.getElementById("invoice-projects-list")!;
    projects = new Map(list.map((p) => [p.projectId, p]));
    selected.clear();

    if (list.length === 0) {
      projectsList.innerHTML =
        '<p style="color: var(--fg-secondary); font-size: 12px; font-style: italic; margin: 0;">No projects with billable hours in this date range</p>';
      updateSummary();
      return;
    }

    // Preselect the given project, or every project in the first one's
    // currency (an invoice holds one currency)
    const first = initial ? projects.get(initial) : list[0];
    const startCurrency = first ? currencyOf(first) : null;
    projectsList.innerHTML = list
      .map((p) => {
        const checked = initial
          ? p.projectId === initial
          : currencyOf(p) === startCurrency;
        if (checked) selected.add(p.projectId);
        const agent =
          (p.agentCostUsd ?? 0) > 0 ? ` · ${agentCostText(p)} AI agents` : "";
        return `
          <label class="invoice-project-label">
            <input type="checkbox" class="invoice-project-select" data-project-id="${escapeHtml(p.projectId)}" ${checked ? "checked" : ""} />
            <span class="invoice-project-info">
              <span class="invoice-project-name">${escapeHtml(p.projectName)}</span>
              <span class="invoice-project-details">${escapeHtml(`${p.totalSessions} billable session(s) - ${formatRate(p.hourlyRate, currencyOf(p))}${agent}`)}</span>
            </span>
          </label>`;
      })
      .join("");

    projectsList
      .querySelectorAll<HTMLInputElement>(".invoice-project-select")
      .forEach((input) => {
        input.addEventListener("change", () => {
          const id = input.dataset.projectId!;
          if (input.checked) selected.add(id);
          else selected.delete(id);
          updateSummary();
        });
      });

    updateSummary();
  }

  function currencyOf(p: InvoiceProject): string {
    return normalizeCurrency(p.currency);
  }

  /** The chosen projects' currency (null when none is chosen). */
  function invoiceCurrency(): string | null {
    const chosen = selectedProjects();
    return chosen.length ? currencyOf(chosen[0]) : null;
  }

  /** Projects in another currency than the chosen ones can't be added. */
  function lockOtherCurrencies(currency: string | null) {
    document
      .querySelectorAll<HTMLInputElement>(".invoice-project-select")
      .forEach((input) => {
        const p = projects.get(input.dataset.projectId!);
        const other = !!currency && !!p && currencyOf(p) !== currency;
        input.disabled = other && !input.checked;
        const label = input.closest(".invoice-project-label");
        if (input.disabled && p) {
          label?.setAttribute(
            "title",
            `In ${currencyOf(p)}: invoice it separately (this invoice is in ${currency})`,
          );
        } else {
          label?.removeAttribute("title");
        }
      });
  }

  /** "$12.30", or "$12.30+" when some sessions reported no cost (USD) */
  function agentCostText(p: InvoiceProject): string {
    return `${formatMoney(p.agentCostUsd ?? 0, "USD")}${p.agentCostIncomplete ? "+" : ""}`;
  }

  function selectedProjects(): InvoiceProject[] {
    return [...selected].map((id) => projects.get(id)).filter(Boolean) as InvoiceProject[];
  }

  function includeAgentCost(): boolean {
    const row = document.getElementById("invoice-agent-cost-row");
    const box = document.getElementById(
      "invoice-include-agent-cost",
    ) as HTMLInputElement | null;
    return !!row && !row.hidden && !!box?.checked && !box.disabled;
  }

  function updateSummary() {
    const summaryDiv = document.getElementById("invoice-summary")!;
    const generateBtn = document.getElementById(
      "generate-invoice-btn",
    ) as HTMLButtonElement;
    const chosen = selectedProjects();
    const currency = invoiceCurrency();
    lockOtherCurrencies(currency);

    // The agent-cost option shows only when a chosen project has some;
    // agents report USD, so it can only go on a USD invoice
    const withAgentCost = chosen.filter((p) => (p.agentCostUsd ?? 0) > 0);
    const agentRow = document.getElementById("invoice-agent-cost-row")!;
    agentRow.hidden = withAgentCost.length === 0;
    const agentBox = document.getElementById(
      "invoice-include-agent-cost",
    ) as HTMLInputElement;
    agentBox.disabled = currency !== "USD";
    const agentTotal = withAgentCost.reduce(
      (sum, p) => sum + (p.agentCostUsd ?? 0),
      0,
    );
    const incomplete = withAgentCost.some((p) => p.agentCostIncomplete);
    document.getElementById("invoice-agent-cost-note")!.textContent =
      `${formatMoney(agentTotal, "USD")} reported by Claude Code / Codex in this range, billed at cost.` +
      (incomplete
        ? " Some sessions reported no cost; only reported costs are added."
        : "") +
      (agentBox.disabled
        ? ` Agent costs are in USD, so they can only go on a USD invoice (this one is in ${currency}).`
        : "");

    if (chosen.length === 0) {
      summaryDiv.innerHTML =
        '<p style="margin: 0; color: var(--text-secondary); font-size: 12px;">Select projects to see summary...</p>';
      generateBtn.disabled = true;
      return;
    }

    const withAgents = includeAgentCost();
    const items = chosen
      .map((p) => {
        const agent =
          withAgents && (p.agentCostUsd ?? 0) > 0
            ? ` + ${formatMoney(p.agentCostUsd ?? 0, "USD")} AI agents`
            : "";
        return `<li>${escapeHtml(`${p.projectName} (${p.totalSessions} sessions) - ${formatRate(p.hourlyRate, currencyOf(p))}${agent}`)}</li>`;
      })
      .join("");
    summaryDiv.innerHTML = `<p style="margin: 0 0 8px 0; color: var(--text-primary); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Selected Projects (${escapeHtml(currency ?? "")}):</p><ul style="margin: 0; padding-left: 20px; color: var(--text-secondary); font-size: 12px;">${items}</ul>`;
    generateBtn.disabled = false;
  }

  async function generateAndDownloadInvoice() {
    const companyName = (
      document.getElementById("invoice-company-name") as HTMLInputElement
    ).value;
    const startDate = (
      document.getElementById("invoice-start-date") as HTMLInputElement
    ).value;
    const endDate = (
      document.getElementById("invoice-end-date") as HTMLInputElement
    ).value;

    if (!companyName.trim()) {
      alert("Please enter your company name");
      return;
    }

    if (selected.size === 0) {
      alert("Please select at least one project");
      return;
    }

    const generateBtn = document.getElementById(
      "generate-invoice-btn",
    ) as HTMLButtonElement;
    const originalText = generateBtn.textContent;
    generateBtn.disabled = true;
    generateBtn.textContent = "Generating...";

    try {
      // Fetch billable sessions for selected projects
      const chosen = selectedProjects();
      const projectIds = chosen.map((p) => p.projectId);
      const billableSessions = await safeIpcInvoke("get-billable-sessions", [
        {
          projectIds,
          startDate,
          endDate,
          billableOnly: true,
        },
      ]);

      // Group sessions by project
      const projectsWithSessions = chosen.map((project) => ({
        projectId: project.projectId,
        projectName: project.projectName,
        hourlyRate: Number(project.hourlyRate) || 0,
        currency: currencyOf(project),
        billableSessions: (billableSessions as any[]).filter(
          (s: any) => s.project_id === project.projectId,
        ),
        agentCostUsd: project.agentCostUsd ?? 0,
        agentSessions: project.agentSessions ?? 0,
      }));

      // Create customization object
      const customization: InvoiceCustomization = {
        companyName: companyName.trim(),
        notes:
          (document.getElementById("invoice-notes") as HTMLTextAreaElement)
            .value || undefined,
        invoiceNumber:
          (document.getElementById("invoice-number") as HTMLInputElement)
            .value || undefined,
        invoiceDate: new Date().toISOString(),
      };

      // Calculate invoice data and generate PDF
      const invoiceData = calculateInvoiceData(
        projectsWithSessions,
        {
          startDate: new Date(startDate),
          endDate: new Date(endDate),
        },
        customization,
        DEFAULT_TEMPLATE,
        includeAgentCost(),
      );

      const doc = generateInvoicePDF(invoiceData);
      const filename = `Invoice_${formatDate(new Date()).replace(/\s/g, "_")}.pdf`;
      const saved = await downloadInvoicePDF(doc, filename);
      if (!saved) return; // cancelled: keep the modal open

      modal.remove();
      overlay.remove();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Error generating invoice:", error);
      alert("Failed to generate invoice. Check the console for details.");
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = originalText;
    }
  }
}
