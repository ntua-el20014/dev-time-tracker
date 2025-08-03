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
    type: "text" | "textarea";
    value?: string;
    required?: boolean;
  }[];
  submitText?: string;
  cancelText?: string;
  cancelClass?: string;
  onSubmit?: (values: Record<string, string>) => void;
  onCancel?: () => void;
  show?: boolean;
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
  form.innerHTML =
    options.fields
      .map(
        (f) => `
    <label for="modal-${f.name}">${f.label}</label><br>
    ${
      f.type === "textarea"
        ? `<textarea id="modal-${f.name}" name="${f.name}" ${
            f.required ? "required" : ""
          }>${f.value || ""}</textarea><br>`
        : `<input id="modal-${f.name}" name="${f.name}" type="text" value="${
            f.value || ""
          }" ${f.required ? "required" : ""}><br>`
    }
  `
      )
      .join("") +
    `
  <div class="session-modal-actions">
    <button type="button" id="customModalCancelBtn" class="btn-cancel ${
      options.cancelClass || ""
    }">${options.cancelText || "Cancel"}</button>
    ${
      options.submitText
        ? `<button type="submit" class="btn-confirm">${options.submitText}</button>`
        : ""
    }
  </div>
`;

  modal.classList.add("active");
  overlay.classList.add("active");

  // Focus the first input with a simple delay
  setTimeout(() => {
    const firstInput = form.querySelector("input,textarea") as HTMLElement;
    if (firstInput) {
      firstInput.focus();
    }
  }, 50);

  // Remove previous listeners
  form.onsubmit = null;
  const cancelBtn = form.querySelector(
    "#customModalCancelBtn"
  ) as HTMLButtonElement;
  if (cancelBtn) cancelBtn.onclick = null;

  // Submit handler
  form.onsubmit = (e) => {
    e.preventDefault();
    if (!options.onSubmit) return;
    const values: Record<string, string> = {};
    options.fields.forEach((f) => {
      const el = form.querySelector(`[name="${f.name}"]`) as
        | HTMLInputElement
        | HTMLTextAreaElement;
      values[f.name] = el.value.trim();
    });
    modal!.classList.remove("active");
    modal.remove();
    overlay?.remove();
    options.onSubmit(values);
  };

  // Cancel handler
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      modal!.classList.remove("active");
      modal.remove();
      overlay?.remove();
      if (options.onCancel) options.onCancel();
    };
  }

  // Close button handler
  const closeBtn = modal.querySelector(".modal-close-btn") as HTMLButtonElement;
  if (closeBtn) {
    closeBtn.onclick = () => {
      modal!.classList.remove("active");
      modal.remove();
      overlay?.remove();
      if (options.onCancel) options.onCancel();
    };
  }

  // Overlay click handler
  modal.addEventListener("click", (e) => {
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
