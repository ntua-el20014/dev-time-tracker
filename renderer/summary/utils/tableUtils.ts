// Utility function to create sortable header
export function createSortableHeader(
  text: string,
  columnKey: string,
  currentSort: { column: string | null; direction: "asc" | "desc" }
): string {
  const isCurrentColumn = currentSort.column === columnKey;
  const arrow = isCurrentColumn
    ? currentSort.direction === "asc"
      ? " ▲"
      : " ▼"
    : "";

  return `<th class="sortable-header" data-column="${columnKey}">${text}${arrow}</th>`;
}

// Utility function to sort data
export function sortData<T>(
  data: T[],
  column: string,
  direction: "asc" | "desc",
  getValue: (item: T, column: string) => string | number
): T[] {
  return [...data].sort((a, b) => {
    const aVal = getValue(a, column);
    const bVal = getValue(b, column);

    // Handle different data types
    let comparison = 0;
    if (typeof aVal === "string" && typeof bVal === "string") {
      comparison = aVal.localeCompare(bVal);
    } else if (typeof aVal === "number" && typeof bVal === "number") {
      comparison = aVal - bVal;
    } else {
      // Convert to string for comparison
      comparison = String(aVal).localeCompare(String(bVal));
    }

    return direction === "asc" ? comparison : -comparison;
  });
}

// Utility to create a filter bar for a view
export function createFilterBar(options: {
  filters: {
    [key: string]: {
      type: "select" | "date";
      label: string;
      options?: string[];
    };
  };
  onApply: (filterValues: Record<string, string>) => void;
  onClear: () => void;
}) {
  const filterBar = document.createElement("div");
  filterBar.className = "summary-filter-bar";

  // Check if this is by-date view (has both start-bydate and end-bydate filters)
  const isByDateView =
    "start-bydate" in options.filters && "end-bydate" in options.filters;

  // Create first row for non-date filters (or all filters if not by-date view)
  const firstRow = document.createElement("div");
  firstRow.className = "filter-row";

  // Create second row for date filters (only for by-date view)
  let dateRow: HTMLElement | null = null;
  if (isByDateView) {
    dateRow = document.createElement("div");
    dateRow.className = "filter-row date-filters";
  }

  // Create filter inputs
  Object.entries(options.filters).forEach(([key, config]) => {
    const label = document.createElement("label");
    label.textContent = config.label + ":";

    let input: HTMLElement;
    if (config.type === "select") {
      const select = document.createElement("select");
      select.id = `filter-${key}`;
      select.innerHTML =
        `<option value="">All</option>` +
        (config.options || [])
          .map((opt) => `<option value="${opt}">${opt}</option>`)
          .join("");
      input = select;
    } else {
      const dateInput = document.createElement("input");
      dateInput.type = "date";
      dateInput.id = `filter-${key}`;
      input = dateInput;
    }

    label.appendChild(input);

    // Place date filters in separate row for by-date view
    if (isByDateView && config.type === "date") {
      dateRow!.appendChild(label);
    } else {
      firstRow.appendChild(label);
    }
  });

  // Add rows to filter bar
  filterBar.appendChild(firstRow);
  if (dateRow && dateRow.children.length > 0) {
    filterBar.appendChild(dateRow);
  }

  // Create button container in its own row
  const buttonRow = document.createElement("div");
  buttonRow.className = "filter-row button-row";

  const buttonContainer = document.createElement("div");
  buttonContainer.className = "filter-btn-container";

  // Apply button
  const applyBtn = document.createElement("button");
  applyBtn.className = "filter-btn apply";
  applyBtn.textContent = "Apply";
  applyBtn.onclick = () => {
    const filterValues: Record<string, string> = {};
    Object.keys(options.filters).forEach((key) => {
      const input = filterBar.querySelector(`#filter-${key}`) as
        | HTMLInputElement
        | HTMLSelectElement;
      if (input && input.value) {
        filterValues[key] = input.value;
      }
    });
    options.onApply(filterValues);
  };

  // Clear button
  const clearBtn = document.createElement("button");
  clearBtn.className = "filter-btn clear";
  clearBtn.textContent = "Clear";
  clearBtn.onclick = () => {
    Object.keys(options.filters).forEach((key) => {
      const input = filterBar.querySelector(`#filter-${key}`) as
        | HTMLInputElement
        | HTMLSelectElement;
      if (input) input.value = "";
    });
    options.onClear();
  };

  buttonContainer.appendChild(applyBtn);
  buttonContainer.appendChild(clearBtn);
  buttonRow.appendChild(buttonContainer);
  filterBar.appendChild(buttonRow);

  return filterBar;
}
