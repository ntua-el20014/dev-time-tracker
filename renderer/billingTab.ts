/**
 * Billing: billable hours and earnings per project by month, and invoices.
 * Rates are set per project on the Projects page.
 */
import { withLoading } from "./utils";
import { showInvoiceGenerationModal } from "./components";
import { renderBillableHoursSummary } from "./components/BillableHoursSummary";
import { navigateTo } from "./navigation";

let listenerInstalled = false;

export async function renderBilling() {
  const container = document.getElementById("billingContent");
  if (!container) return;

  container.innerHTML = `
    <div class="billing-page">
      <div class="billable-section-header">
        <h1>Billing</h1>
        <button id="generateInvoiceBtn" class="btn-primary">📄 New Invoice</button>
      </div>
      <p class="info-note">
        Billable sessions grouped by project, priced at each project's hourly
        rate. Set rates on the
        <button type="button" class="link-btn" id="billingToProjects">Projects</button>
        page; mark sessions billable when you stop them or in Sessions.
      </p>
      <div id="billable-hours-container"></div>
    </div>
  `;

  if (!listenerInstalled) {
    container.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest("#generateInvoiceBtn")) {
        void showInvoiceGenerationModal();
      } else if (target.closest("#billingToProjects")) {
        navigateTo("projects");
      }
    });
    listenerInstalled = true;
  }

  const summary = container.querySelector<HTMLElement>(
    "#billable-hours-container",
  );
  if (summary) {
    await withLoading(summary, "Loading billable hours…", () =>
      renderBillableHoursSummary(summary),
    );
  }
}
