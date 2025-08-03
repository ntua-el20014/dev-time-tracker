import { showConfirmationModal } from "./Modals";

export function showColorGridPicker(options: {
  colors: string[];
  selected: string;
  onSelect: (color: string) => void;
  anchorEl: HTMLElement;
}) {
  // Remove any existing picker
  document.querySelectorAll(".color-grid-picker").forEach((e) => e.remove());

  const picker = document.createElement("div");
  picker.className = "color-grid-picker";
  picker.style.position = "absolute";
  picker.style.zIndex = "9999";
  picker.style.background = "#fff";
  picker.style.border = "1px solid #ccc";
  picker.style.borderRadius = "8px";
  picker.style.padding = "8px";
  picker.style.display = "grid";
  picker.style.gridTemplateColumns = "repeat(5, 24px)";
  picker.style.gridGap = "6px";

  options.colors.forEach((color) => {
    const swatch = document.createElement("div");
    swatch.style.width = "24px";
    swatch.style.height = "24px";
    swatch.style.borderRadius = "6px";
    swatch.style.background = color;
    swatch.style.cursor = "pointer";
    swatch.style.border =
      color === options.selected ? "2px solid #222" : "2px solid #fff";
    swatch.onclick = () => {
      options.onSelect(color);
      picker.remove();
    };
    picker.appendChild(swatch);
  });

  // Position below anchorEl
  const rect = options.anchorEl.getBoundingClientRect();
  picker.style.left = `${rect.left + window.scrollX}px`;
  picker.style.top = `${rect.bottom + window.scrollY + 4}px`;

  document.body.appendChild(picker);

  // Remove on click outside
  setTimeout(() => {
    const remove = (e: MouseEvent) => {
      if (!picker.contains(e.target as Node)) picker.remove();
      document.removeEventListener("mousedown", remove);
    };
    document.addEventListener("mousedown", remove);
  }, 10);
}

export function showAvatarPicker(options: {
  anchorEl: HTMLElement;
  icons: string[];
  customAvatars?: string[];
  onSelect: (icon: string) => void;
  onUpload: () => void;
  onDeleteCustom?: (icon: string) => void;
}) {
  // Remove any existing picker
  document.querySelectorAll(".avatar-picker-menu").forEach((e) => e.remove());

  const pickerMenu = document.createElement("div");
  pickerMenu.className = "avatar-picker-menu";

  const customAvatars = options.customAvatars || [];
  const regularIcons = options.icons || [];

  pickerMenu.innerHTML = `
    <div class="avatar-picker-container">
      <div class="avatar-thumb avatar-thumb-plus" title="Upload custom">+</div>
      ${customAvatars
        .map(
          (icon) => `
        <div class="avatar-thumb custom-avatar" data-icon="${icon}" title="Custom avatar - Right click to delete">
          <img src="${icon}">
          <div class="delete-overlay">×</div>
        </div>
      `
        )
        .join("")}
      ${regularIcons
        .map(
          (icon) => `
        <div class="avatar-thumb regular-avatar" data-icon="${icon}">
          <img src="${icon}">
        </div>
      `
        )
        .join("")}
    </div>
  `;

  // Position menu below anchorEl
  const rect = options.anchorEl.getBoundingClientRect();
  pickerMenu.style.left = `${rect.left + window.scrollX}px`;
  pickerMenu.style.top = `${rect.bottom + window.scrollY + 4}px`;

  document.body.appendChild(pickerMenu);

  // "+" (upload) click
  pickerMenu
    .querySelector(".avatar-thumb-plus")
    ?.addEventListener("click", () => {
      pickerMenu.remove();
      options.onUpload();
    });

  // Custom avatar interactions
  pickerMenu.querySelectorAll(".custom-avatar").forEach((thumb) => {
    const icon = (thumb as HTMLElement).dataset.icon!;

    // Left click to select
    thumb.addEventListener("click", (e) => {
      e.preventDefault();
      pickerMenu.remove();
      options.onSelect(icon);
    });

    // Right click to delete (if callback provided)
    if (options.onDeleteCustom) {
      thumb.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        pickerMenu.remove();
        showConfirmationModal({
          title: "Delete Avatar",
          message: "Delete this custom avatar?",
          confirmText: "Delete",
          confirmClass: "btn-delete",
          onConfirm: () => options.onDeleteCustom!(icon),
        });
      });
    }

    // Show delete overlay on hover
    thumb.addEventListener("mouseenter", () => {
      const overlay = thumb.querySelector(".delete-overlay") as HTMLElement;
      if (overlay) overlay.style.display = "flex";
    });

    thumb.addEventListener("mouseleave", () => {
      const overlay = thumb.querySelector(".delete-overlay") as HTMLElement;
      if (overlay) overlay.style.display = "none";
    });

    // Delete overlay click
    const deleteOverlay = thumb.querySelector(".delete-overlay");
    if (deleteOverlay && options.onDeleteCustom) {
      deleteOverlay.addEventListener("click", (e) => {
        e.stopPropagation();
        pickerMenu.remove();
        showConfirmationModal({
          title: "Delete Avatar",
          message: "Delete this custom avatar?",
          confirmText: "Delete",
          confirmClass: "btn-delete",
          onConfirm: () => options.onDeleteCustom!(icon),
        });
      });
    }
  });

  // Regular icon selection
  pickerMenu.querySelectorAll(".regular-avatar").forEach((thumb) => {
    const icon = (thumb as HTMLElement).dataset.icon!;
    thumb.addEventListener("click", () => {
      pickerMenu.remove();
      options.onSelect(icon);
    });
  });

  // Hide on click outside
  setTimeout(() => {
    const remove = (ev: MouseEvent) => {
      if (
        !pickerMenu.contains(ev.target as Node) &&
        ev.target !== options.anchorEl
      )
        pickerMenu.remove();
      document.removeEventListener("mousedown", remove);
    };
    document.addEventListener("mousedown", remove);
  }, 10);
}
