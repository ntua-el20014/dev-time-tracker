/* eslint-disable @typescript-eslint/no-non-null-assertion */

// Global modal cleanup function
export function cleanupAllModals() {
  // Clean up calendar modals
  const calendarModals = document.querySelectorAll(
    "#calendarModal, #calendarDetailsModal"
  );
  calendarModals.forEach((modal) => modal.remove());

  // Clean up confirmation modals
  const confirmationModals = document.querySelectorAll(
    "#confirmationModal, #deleteConfirmationModal"
  );
  confirmationModals.forEach((modal) => modal.remove());

  // Clean up generic modals
  const genericModals = document.querySelectorAll(
    "#customModal, #customModalOverlay"
  );
  genericModals.forEach((modal) => modal.remove());

  // Clean up any modal overlays
  const overlays = document.querySelectorAll(
    ".modal-overlay, .custom-modal-overlay"
  );
  overlays.forEach((overlay) => overlay.remove());
}

export interface ModalOptions {
  title: string;
  fields: {
    name: string;
    label: string;
    type: "text" | "textarea" | "password" | "custom";
    value?: string;
    required?: boolean;
    render?: () => HTMLElement; // For custom field types
  }[];
  submitText?: string;
  cancelText?: string;
  cancelClass?: string;
  onSubmit?: (values: Record<string, string>) => void;
  onCancel?: () => void;
  show?: boolean;
  dismissible?: boolean; // If false, modal cannot be closed except by submitting
}

export function showModal(options: ModalOptions) {
  // Clean up any existing generic modals first, but let calendar handle its own modals
  const genericModals = document.querySelectorAll(
    "#customModal, #customModalOverlay"
  );
  genericModals.forEach((modal) => modal.remove());

  const overlays = document.querySelectorAll(".custom-modal-overlay");
  overlays.forEach((overlay) => overlay.remove());

  // --- Overlay logic ---
  let overlay = document.getElementById(
    "customModalOverlay"
  ) as HTMLDivElement | null;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "customModalOverlay";
    overlay.className = "custom-modal-overlay";
    document.body.appendChild(overlay);
  }
  overlay.style.display = "block";

  let modal = document.getElementById("customModal") as HTMLDivElement | null;
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "customModal";
    modal.innerHTML = `
      <div class="session-modal-content">
        <button class="modal-close-btn">&times;</button>
        <h2></h2>
        <form id="customModalForm"></form>
      </div>
    `;
    document.body.appendChild(modal);
  }
  const content = modal.querySelector(
    ".session-modal-content"
  ) as HTMLDivElement;
  const h2 = content.querySelector("h2")!;
  const form = content.querySelector("form") as HTMLFormElement;

  h2.textContent = options.title;

  // Clear form and build it programmatically to support custom fields
  form.innerHTML = "";

  // Add each field
  options.fields.forEach((f) => {
    if (f.type === "custom" && f.render) {
      // For custom fields, use the provided render function
      const customElement = f.render();
      form.appendChild(customElement);
    } else {
      // For standard fields (text, textarea, password), create label and input
      const label = document.createElement("label");
      label.setAttribute("for", `modal-${f.name}`);
      label.textContent = f.label;
      form.appendChild(label);
      form.appendChild(document.createElement("br"));

      if (f.type === "textarea") {
        const textarea = document.createElement("textarea");
        textarea.id = `modal-${f.name}`;
        textarea.name = f.name;
        if (f.required) textarea.required = true;
        textarea.value = f.value || "";
        form.appendChild(textarea);
      } else {
        // text or password
        const input = document.createElement("input");
        input.id = `modal-${f.name}`;
        input.name = f.name;
        input.type = f.type === "password" ? "password" : "text";
        input.value = f.value || "";
        if (f.required) input.required = true;
        form.appendChild(input);
      }
      form.appendChild(document.createElement("br"));
    }
  });

  // Add action buttons
  const actionsDiv = document.createElement("div");
  actionsDiv.className = "session-modal-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.id = "customModalCancelBtn";
  cancelBtn.className = `btn-cancel ${options.cancelClass || ""}`;
  cancelBtn.textContent = options.cancelText || "Cancel";
  actionsDiv.appendChild(cancelBtn);

  if (options.submitText) {
    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.className = "btn-confirm";
    submitBtn.textContent = options.submitText;
    actionsDiv.appendChild(submitBtn);
  }

  form.appendChild(actionsDiv);

  modal.classList.add("active");
  overlay.classList.add("active");

  // Focus the first input with a simple delay
  setTimeout(() => {
    const firstInput = form.querySelector("input,textarea") as HTMLElement;
    if (firstInput) {
      firstInput.focus();
    }
  }, 50);

  // Submit handler
  form.onsubmit = (e) => {
    e.preventDefault();
    if (!options.onSubmit) return;
    const values: Record<string, string> = {};
    options.fields.forEach((f) => {
      // Skip custom fields that don't have form inputs
      if (f.type === "custom") return;
      const el = form.querySelector(`[name="${f.name}"]`) as
        | HTMLInputElement
        | HTMLTextAreaElement;
      if (el) {
        values[f.name] = el.value.trim();
      }
    });
    modal!.classList.remove("active");
    modal.remove();
    overlay?.remove();
    options.onSubmit(values);
  };

  // Cancel handler (using the cancelBtn reference we created earlier)
  cancelBtn.onclick = () => {
    // Only allow cancel if modal is dismissible
    if (options.dismissible === false) return;

    modal!.classList.remove("active");
    modal.remove();
    overlay?.remove();
    if (options.onCancel) options.onCancel();
  };

  // Hide cancel button if modal is not dismissible
  if (options.dismissible === false) {
    cancelBtn.style.display = "none";
  }

  // Close button handler
  const closeBtn = modal.querySelector(".modal-close-btn") as HTMLButtonElement;
  if (closeBtn) {
    // Hide close button if modal is not dismissible
    if (options.dismissible === false) {
      closeBtn.style.display = "none";
    }

    closeBtn.onclick = () => {
      // Only allow closing if modal is dismissible
      if (options.dismissible === false) return;

      modal!.classList.remove("active");
      modal.remove();
      overlay?.remove();
      if (options.onCancel) options.onCancel();
    };
  }

  // Overlay click handler
  modal.addEventListener("click", (e) => {
    // Only allow closing if modal is dismissible
    if (options.dismissible === false) return;

    if (e.target === modal) {
      modal!.classList.remove("active");
      modal.remove();
      overlay?.remove();
      if (options.onCancel) options.onCancel();
    }
  });

  // Prevent modal content clicks from bubbling up
  const modalContent = modal.querySelector(
    ".session-modal-content, .custom-modal-content, .modal-content"
  );
  if (modalContent) {
    modalContent.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }
}

// Reusable confirmation modal component
export interface ConfirmationModalOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmClass?: string; // CSS class for confirm button styling
  confirmStyle?: Partial<CSSStyleDeclaration>; // Additional inline styles for confirm button
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

export function showConfirmationModal(options: ConfirmationModalOptions) {
  const {
    title = "Confirm Action",
    message,
    confirmText = "Yes",
    cancelText = "Cancel",
    confirmClass = "export-button",
    confirmStyle,
    onConfirm,
    onCancel,
  } = options;

  // Remove any existing confirmation modals
  const existingModal = document.getElementById("confirmationModal");
  if (existingModal) {
    existingModal.remove();
  }

  const modalHTML = `
    <div id="confirmationModal" class="active" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;">
      <div class="session-modal-content" style="max-width: 400px; background: var(--bg-primary, white); border-radius: 8px; padding: 20px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
        <h3>${title}</h3>
        <p style="margin: 20px 0;">${message}</p>
        <div class="session-modal-actions" style="display: flex; gap: 10px; justify-content: flex-end;">
          <button type="button" id="confirmModalCancelBtn" class="btn-cancel">${cancelText}</button>
          <button type="button" id="confirmModalOkBtn" class="${confirmClass}">${confirmText}</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", modalHTML);

  // Wait for DOM to be ready before setting up event listeners
  setTimeout(() => {
    // Setup event listeners for confirmation modal
    const cancelBtn = document.getElementById("confirmModalCancelBtn");
    const okBtn = document.getElementById("confirmModalOkBtn");
    const modal = document.getElementById("confirmationModal");

    const cleanup = () => {
      modal?.remove();
    };

    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        cleanup();
        if (onCancel) onCancel();
      });
    }

    if (okBtn) {
      okBtn.addEventListener("click", async () => {
        cleanup();
        if (onConfirm) {
          await onConfirm();
        }
      });

      // Apply custom styles if provided
      if (confirmStyle) {
        Object.assign(okBtn.style, confirmStyle);
      }
    }

    if (modal) {
      modal.addEventListener("click", (e: Event) => {
        if (e.target === e.currentTarget) {
          cleanup();
          if (onCancel) onCancel();
        }
      });
    }

    // Add escape key handler
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cleanup();
        if (onCancel) onCancel();
        document.removeEventListener("keydown", handleEscape);
      }
    };
    document.addEventListener("keydown", handleEscape);
  }, 10); // Small delay to ensure DOM is ready
}
