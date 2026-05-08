import { safeIpcInvoke } from "../utils/ipcHelpers";
import {
  generateInvoicePDF,
  downloadInvoicePDF,
  calculateInvoiceData,
  DEFAULT_TEMPLATE,
  formatDate,
} from "../utils/invoiceUtils";
import type { InvoiceCustomization } from "../utils/invoiceUtils";

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

  const selectedProjects: Map<
    string,
    { id: string; name: string; hourly_rate: number }
  > = new Map();

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
              value="${thirtyDaysAgo.toISOString().split("T")[0]}"
            />
            <span>to</span>
            <input 
              type="date" 
              id="invoice-end-date" 
              value="${today.toISOString().split("T")[0]}"
            />
          </div>
        </div>

        <div>
          <label>Projects</label>
          <div id="invoice-projects-list">
            <p style="color: var(--fg-secondary); font-size: 12px; margin: 0;">Loading projects with billable hours...</p>
          </div>
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
    renderProjectsList(projectsData as any[], initialProjectId);
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
      renderProjectsList(projectsData as any[], initialProjectId);
      selectedProjects.clear();
      updateSummary();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Error updating projects:", error);
    }
  }

  function renderProjectsList(projects: any[], initial?: string) {
    const projectsList = document.getElementById("invoice-projects-list")!;

    if (projects.length === 0) {
      projectsList.innerHTML =
        '<p style="color: var(--fg-secondary); font-size: 12px; font-style: italic; margin: 0;">No projects with billable hours in this date range</p>';
      return;
    }

    projectsList.innerHTML = "";

    projects.forEach((project) => {
      const label = document.createElement("label");
      label.className = "invoice-project-label";

      const isChecked =
        !initial || project.projectId === initial ? " checked" : "";

      label.innerHTML = `
        <input 
          type="checkbox" 
          class="invoice-project-select" 
          data-project-id="${project.projectId}"
          data-project-name="${project.projectName}"
          data-hourly-rate="${project.hourlyRate}"
          ${isChecked}
        />
        <span class="invoice-project-info">
          <span class="invoice-project-name">${project.projectName}</span>
          <span class="invoice-project-details">${project.totalSessions} billable session(s) - $${project.hourlyRate}/hr</span>
        </span>
      `;

      const input = label.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      input.addEventListener("change", (e) => {
        const target = e.target as HTMLInputElement;
        if (target.checked) {
          selectedProjects.set(target.dataset.projectId!, {
            id: target.dataset.projectId!,
            name: target.dataset.projectName!,
            hourly_rate: parseFloat(target.dataset.hourlyRate!),
          });
        } else {
          selectedProjects.delete(target.dataset.projectId!);
        }
        updateSummary();
      });

      // Pre-select if it's the initial project
      if (isChecked) {
        selectedProjects.set(input.dataset.projectId!, {
          id: input.dataset.projectId!,
          name: input.dataset.projectName!,
          hourly_rate: parseFloat(input.dataset.hourlyRate!),
        });
      }

      projectsList.appendChild(label);
    });

    updateSummary();
  }

  function updateSummary() {
    const summaryDiv = document.getElementById("invoice-summary")!;
    const generateBtn = document.getElementById(
      "generate-invoice-btn",
    ) as HTMLButtonElement;

    if (selectedProjects.size === 0) {
      summaryDiv.innerHTML =
        '<p style="margin: 0; color: var(--text-secondary); font-size: 12px;">Select projects to see summary...</p>';
      generateBtn.disabled = true;
      return;
    }

    let projectsSummary =
      '<p style="margin: 0 0 8px 0; color: var(--text-primary); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Selected Projects:</p><ul style="margin: 0; padding-left: 20px; color: var(--text-secondary); font-size: 12px;">';

    selectedProjects.forEach((project) => {
      const input = document.querySelector(
        `input[data-project-id="${project.id}"][type="checkbox"]`,
      ) as HTMLInputElement;

      if (input?.checked) {
        const projectCheckbox = input.closest("label");
        const checkboxText = projectCheckbox?.textContent ?? "";
        const matched = checkboxText.match(/(\d+) billable/);
        const sessionCount = parseInt(matched?.[1] ?? "0", 10);
        projectsSummary += `<li>${project.name} (${sessionCount} sessions) - $${project.hourly_rate}/hr</li>`;
      }
    });

    projectsSummary += "</ul>";
    summaryDiv.innerHTML = projectsSummary;
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

    if (selectedProjects.size === 0) {
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
      const projectIds = Array.from(selectedProjects.keys());
      const billableSessions = await safeIpcInvoke("get-billable-sessions", [
        {
          projectIds,
          startDate,
          endDate,
          billableOnly: true,
        },
      ]);

      // Group sessions by project
      const projectsWithSessions = Array.from(selectedProjects.values()).map(
        (project) => {
          const sessions = (billableSessions as any[]).filter(
            (s: any) => s.project_id === project.id,
          );
          return {
            projectId: project.id,
            projectName: project.name,
            hourlyRate: project.hourly_rate,
            billableSessions: sessions,
          };
        },
      );

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
      );

      const doc = generateInvoicePDF(invoiceData);
      const filename = `Invoice_${formatDate(new Date()).replace(/\s/g, "_")}.pdf`;
      downloadInvoicePDF(doc, filename);

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
