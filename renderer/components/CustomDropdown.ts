/**
 * Custom Dropdown Component
 * A reusable dropdown component that replaces native <select> elements
 * with full styling control and accent color support.
 */

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface CustomDropdownConfig {
  id?: string;
  name?: string;
  className?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  options: DropdownOption[];
  value?: string;
  onChange?: (value: string, option: DropdownOption) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

export class CustomDropdown {
  private container: HTMLElement;
  private config: CustomDropdownConfig;
  private selectedValue: string;
  private isOpen: boolean = false;
  private selectedIndex: number = -1;

  constructor(config: CustomDropdownConfig) {
    this.config = config;
    this.selectedValue = config.value || "";
    this.container = this.createDropdown();
    this.attachEventListeners();
  }

  private createDropdown(): HTMLElement {
    const container = document.createElement("div");
    container.className = `custom-dropdown ${this.config.className || ""}`;
    if (this.config.disabled) {
      container.classList.add("disabled");
    }

    const selectedOption = this.config.options.find(
      (opt) => opt.value === this.selectedValue
    );
    const displayText =
      selectedOption?.label || this.config.placeholder || "Select an option";

    container.innerHTML = `
      <div class="dropdown-trigger" tabindex="0" role="combobox" aria-expanded="false" aria-haspopup="listbox"
           ${this.config.id ? `id="${this.config.id}"` : ""}
           ${this.config.name ? `data-name="${this.config.name}"` : ""}>
        <span class="dropdown-value">${displayText}</span>
        <span class="dropdown-arrow">▼</span>
      </div>
      <div class="dropdown-menu" role="listbox">
        ${this.config.options
          .map(
            (option, index) => `
          <div class="dropdown-option" 
               role="option" 
               data-value="${option.value}" 
               data-index="${index}"
               ${option.disabled ? 'aria-disabled="true"' : ""}
               ${
                 option.value === this.selectedValue
                   ? 'aria-selected="true"'
                   : ""
               }>
            ${option.label}
          </div>
        `
          )
          .join("")}
      </div>
    `;

    return container;
  }

  private attachEventListeners(): void {
    const trigger = this.container.querySelector(
      ".dropdown-trigger"
    ) as HTMLElement;
    const options = this.container.querySelectorAll(".dropdown-option");

    // Click to open/close
    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      if (!this.config.disabled) {
        this.toggle();
      }
    });

    // Keyboard navigation
    trigger.addEventListener("keydown", (e) => {
      if (this.config.disabled) return;

      switch (e.key) {
        case "Enter":
        case " ":
        case "ArrowDown":
          e.preventDefault();
          this.open();
          this.focusOption(0);
          break;
        case "ArrowUp":
          e.preventDefault();
          this.open();
          this.focusOption(this.config.options.length - 1);
          break;
        case "Escape":
          this.close();
          break;
      }
    });

    // Option selection
    options.forEach((option, index) => {
      option.addEventListener("click", (e) => {
        e.stopPropagation();
        const value = (option as HTMLElement).dataset.value;
        const isDisabled = option.getAttribute("aria-disabled") === "true";

        if (value !== undefined && !isDisabled) {
          this.selectOption(value);
        }
      });

      option.addEventListener("keydown", (e) => {
        const keyEvent = e as KeyboardEvent;
        switch (keyEvent.key) {
          case "Enter":
          case " ": {
            e.preventDefault();
            const value = (option as HTMLElement).dataset.value;
            const isDisabled = option.getAttribute("aria-disabled") === "true";
            if (value !== undefined && !isDisabled) {
              this.selectOption(value);
            }
            break;
          }
          case "ArrowDown":
            e.preventDefault();
            this.focusOption(index + 1);
            break;
          case "ArrowUp":
            e.preventDefault();
            this.focusOption(index - 1);
            break;
          case "Escape": {
            this.close();
            trigger.focus();
            break;
          }
        }
      });
    });

    // Close on outside click
    document.addEventListener("click", (e) => {
      if (!this.container.contains(e.target as Node)) {
        this.close();
      }
    });

    // Focus events
    trigger.addEventListener("focus", () => {
      this.config.onFocus?.();
    });

    trigger.addEventListener("blur", (_e) => {
      // Only trigger blur if focus is moving outside the dropdown
      setTimeout(() => {
        if (!this.container.contains(document.activeElement)) {
          this.config.onBlur?.();
        }
      }, 0);
    });
  }

  private toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  private open(): void {
    if (this.isOpen || this.config.disabled) return;

    this.isOpen = true;
    this.container.classList.add("open");
    const trigger = this.container.querySelector(
      ".dropdown-trigger"
    ) as HTMLElement;
    trigger.setAttribute("aria-expanded", "true");

    // Position the dropdown menu
    const menu = this.container.querySelector(".dropdown-menu") as HTMLElement;
    const rect = this.container.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Check if this dropdown is inside a filter bar (needs fixed positioning)
    const isInFilterBar =
      this.container.closest(".summary-filter-bar") !== null;

    if (isInFilterBar) {
      // Use fixed positioning for filter bar dropdowns
      menu.style.position = "fixed";
      menu.style.left = `${rect.left}px`;
      menu.style.top = `${rect.bottom + 2}px`;
      menu.style.width = "max-content";
      menu.style.minWidth = `${rect.width}px`;
    }

    // Check if there's enough space below
    if (
      rect.bottom + menu.offsetHeight > viewportHeight &&
      rect.top > menu.offsetHeight
    ) {
      menu.classList.add("dropdown-up");
      if (isInFilterBar) {
        menu.style.top = `${rect.top - menu.offsetHeight - 2}px`;
      }
    } else {
      menu.classList.remove("dropdown-up");
      if (isInFilterBar) {
        menu.style.top = `${rect.bottom + 2}px`;
      }
    }

    // Check for horizontal overflow and adjust positioning
    setTimeout(() => {
      const menuRect = menu.getBoundingClientRect();
      if (menuRect.right > viewportWidth) {
        const overflow = menuRect.right - viewportWidth + 16; // 16px margin
        if (isInFilterBar) {
          menu.style.left = `${rect.left - overflow}px`;
        } else {
          menu.style.transform = `translateX(-${overflow}px)`;
        }
      } else if (!isInFilterBar) {
        menu.style.transform = "";
      }
    }, 0);
  }

  private close(): void {
    if (!this.isOpen) return;

    this.isOpen = false;
    this.selectedIndex = -1;
    this.container.classList.remove("open");
    const trigger = this.container.querySelector(
      ".dropdown-trigger"
    ) as HTMLElement;
    trigger.setAttribute("aria-expanded", "false");

    // Reset any positioning styles
    const menu = this.container.querySelector(".dropdown-menu") as HTMLElement;
    menu.style.transform = "";
    menu.style.position = "";
    menu.style.left = "";
    menu.style.top = "";
    menu.style.width = "";
    menu.style.minWidth = "";
  }

  private focusOption(index: number): void {
    const options = this.container.querySelectorAll(
      '.dropdown-option:not([aria-disabled="true"])'
    );
    if (options.length === 0) return;

    // Wrap around
    if (index < 0) index = options.length - 1;
    if (index >= options.length) index = 0;

    this.selectedIndex = index;
    (options[index] as HTMLElement).focus();
  }

  private selectOption(value: string): void {
    const option = this.config.options.find((opt) => opt.value === value);
    if (!option || option.disabled) return;

    this.selectedValue = value;

    // Update display
    const valueSpan = this.container.querySelector(
      ".dropdown-value"
    ) as HTMLElement;
    valueSpan.textContent = option.label;

    // Update aria-selected
    this.container.querySelectorAll(".dropdown-option").forEach((opt) => {
      opt.setAttribute("aria-selected", "false");
    });
    const selectedElement = this.container.querySelector(
      `[data-value="${value}"]`
    );
    if (selectedElement) {
      selectedElement.setAttribute("aria-selected", "true");
    }

    // Trigger change event
    this.config.onChange?.(value, option);

    this.close();
    const trigger = this.container.querySelector(
      ".dropdown-trigger"
    ) as HTMLElement;
    trigger.focus();
  }

  // Public API methods
  public getValue(): string {
    return this.selectedValue;
  }

  public setValue(value: string): void {
    this.selectedValue = value;
    const option = this.config.options.find((opt) => opt.value === value);
    const valueSpan = this.container.querySelector(
      ".dropdown-value"
    ) as HTMLElement;
    valueSpan.textContent =
      option?.label || this.config.placeholder || "Select an option";

    // Update aria-selected
    this.container.querySelectorAll(".dropdown-option").forEach((opt) => {
      opt.setAttribute(
        "aria-selected",
        opt.getAttribute("data-value") === value ? "true" : "false"
      );
    });
  }

  public setOptions(options: DropdownOption[]): void {
    this.config.options = options;
    const menu = this.container.querySelector(".dropdown-menu") as HTMLElement;
    menu.innerHTML = options
      .map(
        (option, index) => `
      <div class="dropdown-option" 
           role="option" 
           data-value="${option.value}" 
           data-index="${index}"
           ${option.disabled ? 'aria-disabled="true"' : ""}
           ${option.value === this.selectedValue ? 'aria-selected="true"' : ""}>
        ${option.label}
      </div>
    `
      )
      .join("");

    // Re-attach option event listeners
    this.attachOptionListeners();
  }

  private attachOptionListeners(): void {
    const options = this.container.querySelectorAll(".dropdown-option");
    options.forEach((option, index) => {
      // Remove existing listeners by replacing the element
      const newOption = option.cloneNode(true) as HTMLElement;
      option.parentNode?.replaceChild(newOption, option);

      newOption.addEventListener("click", (e) => {
        e.stopPropagation();
        const value = newOption.dataset.value;
        const isDisabled = newOption.getAttribute("aria-disabled") === "true";

        if (value !== undefined && !isDisabled) {
          this.selectOption(value);
        }
      });

      newOption.addEventListener("keydown", (e) => {
        const keyEvent = e as KeyboardEvent;
        switch (keyEvent.key) {
          case "Enter":
          case " ": {
            e.preventDefault();
            const value = newOption.dataset.value;
            const isDisabled =
              newOption.getAttribute("aria-disabled") === "true";
            if (value !== undefined && !isDisabled) {
              this.selectOption(value);
            }
            break;
          }
          case "ArrowDown":
            e.preventDefault();
            this.focusOption(index + 1);
            break;
          case "ArrowUp":
            e.preventDefault();
            this.focusOption(index - 1);
            break;
          case "Escape": {
            this.close();
            const trigger = this.container.querySelector(
              ".dropdown-trigger"
            ) as HTMLElement;
            trigger.focus();
            break;
          }
        }
      });
    });
  }

  public setDisabled(disabled: boolean): void {
    this.config.disabled = disabled;
    if (disabled) {
      this.container.classList.add("disabled");
      this.close();
    } else {
      this.container.classList.remove("disabled");
    }
  }

  public getElement(): HTMLElement {
    return this.container;
  }

  public destroy(): void {
    this.container.remove();
  }
}

// Helper function to create a dropdown from configuration
export function createCustomDropdown(
  config: CustomDropdownConfig
): CustomDropdown {
  return new CustomDropdown(config);
}

// Helper function to replace an existing select element
export function replaceSelectWithCustomDropdown(
  selectElement: HTMLSelectElement,
  additionalConfig?: Partial<CustomDropdownConfig>
): CustomDropdown {
  // Extract options from select element
  const options: DropdownOption[] = Array.from(selectElement.options).map(
    (option) => ({
      value: option.value,
      label: option.textContent || option.value,
      disabled: option.disabled,
    })
  );

  // Create configuration
  const config: CustomDropdownConfig = {
    id: selectElement.id,
    name: selectElement.name,
    className: selectElement.className,
    required: selectElement.required,
    disabled: selectElement.disabled,
    value: selectElement.value,
    options,
    ...additionalConfig,
  };

  // Create dropdown
  const dropdown = new CustomDropdown(config);

  // Replace in DOM
  selectElement.parentNode?.insertBefore(dropdown.getElement(), selectElement);
  selectElement.remove();

  return dropdown;
}
