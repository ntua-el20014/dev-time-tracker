/**
 * Dropdown Utilities
 * Helper functions for managing custom dropdowns throughout the application
 */

import {
  CustomDropdown,
  DropdownOption,
  CustomDropdownConfig,
  createCustomDropdown,
  replaceSelectWithCustomDropdown,
} from "../components/CustomDropdown";

// Global dropdown registry for easy management
const dropdownRegistry = new Map<string, CustomDropdown>();

/**
 * Register a dropdown for global management
 */
export function registerDropdown(id: string, dropdown: CustomDropdown): void {
  dropdownRegistry.set(id, dropdown);
}

/**
 * Get a registered dropdown by ID
 */
export function getDropdown(id: string): CustomDropdown | undefined {
  return dropdownRegistry.get(id);
}

/**
 * Unregister and destroy a dropdown
 */
export function unregisterDropdown(id: string): void {
  const dropdown = dropdownRegistry.get(id);
  if (dropdown) {
    dropdown.destroy();
    dropdownRegistry.delete(id);
  }
}

/**
 * Create and register a dropdown
 */
export function createAndRegisterDropdown(
  config: CustomDropdownConfig
): CustomDropdown {
  const dropdown = createCustomDropdown(config);

  if (config.id) {
    registerDropdown(config.id, dropdown);
  }

  return dropdown;
}

/**
 * Replace all select elements in a container with custom dropdowns
 */
export function replaceAllSelectsInContainer(
  container: HTMLElement,
  additionalConfig?: Partial<CustomDropdownConfig>
): CustomDropdown[] {
  const selects = container.querySelectorAll("select");
  const dropdowns: CustomDropdown[] = [];

  selects.forEach((select) => {
    const dropdown = replaceSelectWithCustomDropdown(select, additionalConfig);
    dropdowns.push(dropdown);

    // Register if it has an ID
    if (dropdown.getElement().querySelector(".dropdown-trigger")?.id) {
      const id = dropdown.getElement().querySelector(".dropdown-trigger")!.id;
      registerDropdown(id, dropdown);
    }
  });

  return dropdowns;
}

/**
 * Common dropdown configurations for the application
 */
export const CommonDropdownConfigs = {
  /**
   * Project selector dropdown
   */
  projectSelector: (
    projects: Array<{ id: string; name: string }>,
    onChange?: (value: string) => void
  ): CustomDropdownConfig => ({
    placeholder: "Select a project",
    options: [
      { value: "", label: "No Project" },
      ...projects.map((p) => ({ value: p.id, label: p.name })),
    ],
    onChange: onChange ? (value) => onChange(value) : undefined,
  }),

  /**
   * Tag selector dropdown
   */
  tagSelector: (
    tags: Array<{ name: string; color: string }>,
    onChange?: (value: string) => void
  ): CustomDropdownConfig => ({
    placeholder: "Select a tag",
    options: [
      { value: "", label: "No Tag" },
      ...tags.map((t) => ({ value: t.name, label: t.name })),
    ],
    onChange: onChange ? (value) => onChange(value) : undefined,
  }),

  /**
   * User role selector dropdown
   */
  roleSelector: (
    roles: string[],
    onChange?: (value: string) => void
  ): CustomDropdownConfig => ({
    placeholder: "Select role",
    options: roles.map((role) => ({ value: role, label: role })),
    onChange: onChange ? (value) => onChange(value) : undefined,
  }),

  /**
   * Export format selector
   */
  exportFormat: (onChange?: (value: string) => void): CustomDropdownConfig => ({
    placeholder: "Export format",
    options: [
      { value: "csv", label: "CSV" },
      { value: "json", label: "JSON" },
      { value: "xlsx", label: "Excel" },
    ],
    onChange: onChange ? (value) => onChange(value) : undefined,
  }),

  /**
   * Chart type selector
   */
  chartType: (onChange?: (value: string) => void): CustomDropdownConfig => ({
    placeholder: "Chart type",
    options: [
      { value: "bar", label: "Bar Chart" },
      { value: "line", label: "Line Chart" },
      { value: "pie", label: "Pie Chart" },
      { value: "doughnut", label: "Doughnut Chart" },
    ],
    onChange: onChange ? (value) => onChange(value) : undefined,
  }),

  /**
   * Time grouping selector
   */
  timeGrouping: (onChange?: (value: string) => void): CustomDropdownConfig => ({
    placeholder: "Group by",
    options: [
      { value: "day", label: "By Day" },
      { value: "week", label: "By Week" },
      { value: "month", label: "By Month" },
      { value: "project", label: "By Project" },
      { value: "tag", label: "By Tag" },
      { value: "language", label: "By Language" },
      { value: "editor", label: "By Editor" },
    ],
    onChange: onChange ? (value) => onChange(value) : undefined,
  }),

  /**
   * Data aggregation selector
   */
  dataAggregation: (
    onChange?: (value: string) => void
  ): CustomDropdownConfig => ({
    placeholder: "Aggregation",
    options: [
      { value: "sum", label: "Total Time" },
      { value: "avg", label: "Average Time" },
      { value: "count", label: "Session Count" },
    ],
    onChange: onChange ? (value) => onChange(value) : undefined,
  }),

  /**
   * User selector dropdown
   */
  userSelector: (
    users: Array<{ id: string; name: string }>,
    onChange?: (value: string) => void
  ): CustomDropdownConfig => ({
    placeholder: "Select user",
    options: users.map((u) => ({ value: u.id, label: u.name })),
    onChange: onChange ? (value) => onChange(value) : undefined,
  }),
};

/**
 * Utility function to create a dropdown with form validation
 */
export function createValidatedDropdown(
  config: CustomDropdownConfig,
  validationRules?: {
    required?: boolean;
    customValidator?: (value: string) => string | null; // Return error message or null
  }
): CustomDropdown {
  const originalOnChange = config.onChange;

  const dropdown = createCustomDropdown({
    ...config,
    onChange: (value, option) => {
      // Run validation
      if (validationRules) {
        let errorMessage: string | null = null;

        if (validationRules.required && (!value || value.trim() === "")) {
          errorMessage = "This field is required";
        }

        if (!errorMessage && validationRules.customValidator) {
          errorMessage = validationRules.customValidator(value);
        }

        // Add/remove error styling
        const element = dropdown.getElement();
        const trigger = element.querySelector(
          ".dropdown-trigger"
        ) as HTMLElement;

        if (errorMessage) {
          trigger.style.borderColor = "#ff6961";
          trigger.style.boxShadow = "0 0 0 2px rgba(255, 105, 97, 0.3)";

          // Show error message (you can customize this)
          let errorEl = element.querySelector(".dropdown-error") as HTMLElement;
          if (!errorEl) {
            errorEl = document.createElement("div");
            errorEl.className = "dropdown-error";
            errorEl.style.cssText =
              "color: #ff6961; font-size: 0.85em; margin-top: 4px;";
            element.appendChild(errorEl);
          }
          errorEl.textContent = errorMessage;
        } else {
          trigger.style.borderColor = "";
          trigger.style.boxShadow = "";

          const errorEl = element.querySelector(".dropdown-error");
          if (errorEl) {
            errorEl.remove();
          }
        }
      }

      // Call original onChange
      originalOnChange?.(value, option);
    },
  });

  return dropdown;
}

/**
 * Cleanup function to destroy all registered dropdowns
 */
export function cleanupAllDropdowns(): void {
  dropdownRegistry.forEach((dropdown) => dropdown.destroy());
  dropdownRegistry.clear();
}

/**
 * Update options for multiple dropdowns at once
 */
export function updateDropdownOptions(
  updates: Array<{ id: string; options: DropdownOption[] }>
): void {
  updates.forEach(({ id, options }) => {
    const dropdown = getDropdown(id);
    if (dropdown) {
      dropdown.setOptions(options);
    }
  });
}

/**
 * Get values from multiple dropdowns
 */
export function getDropdownValues(ids: string[]): Record<string, string> {
  const values: Record<string, string> = {};

  ids.forEach((id) => {
    const dropdown = getDropdown(id);
    if (dropdown) {
      values[id] = dropdown.getValue();
    }
  });

  return values;
}

/**
 * Set values for multiple dropdowns
 */
export function setDropdownValues(values: Record<string, string>): void {
  Object.entries(values).forEach(([id, value]) => {
    const dropdown = getDropdown(id);
    if (dropdown) {
      dropdown.setValue(value);
    }
  });
}
