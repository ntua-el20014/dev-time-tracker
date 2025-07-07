import { Chart } from "chart.js/auto";
import type { DailySummaryRow, SessionRow } from "@shared/types";

/* eslint-disable @typescript-eslint/no-non-null-assertion */
export function displayOSInfo(os: string) {
  let osDiv = document.getElementById("os-info") as HTMLDivElement | null;
  if (!osDiv) {
    osDiv = document.createElement("div");
    osDiv.id = "os-info";
    osDiv.style.position = "fixed";
    osDiv.style.right = "20px";
    osDiv.style.bottom = "20px";
    osDiv.style.opacity = "0.7";
    osDiv.style.fontSize = "14px";
    document.body.appendChild(osDiv);
  }
  osDiv.textContent = `OS: ${os}`;
}

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

export function showNotification(message: string, durationMs = 3500) {
  // Remove any existing notification
  let notif = document.getElementById(
    "custom-notification"
  ) as HTMLDivElement | null;
  if (notif) notif.remove();

  notif = document.createElement("div");
  notif.id = "custom-notification";
  notif.textContent = message;
  notif.className = "custom-notification"; // Use CSS class for styling

  document.body.appendChild(notif);

  // Play system notification sound (if possible)
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Dev Time Tracker", { body: message });
    } else {
      // Fallback: play a short beep using Web Audio API
      const audioCtxCtor =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new audioCtxCtor();
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = 880;
      o.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.15);
      o.onended = () => ctx.close();
    }
  } catch {
    // Fallback if sound cannot be played
  }

  setTimeout(() => {
    notif!.style.opacity = "0";
    setTimeout(() => notif?.remove(), 350);
  }, durationMs);
}

export function showInAppNotification(message: string, durationMs = 3500) {
  // Remove any existing notification
  let notif = document.getElementById(
    "custom-notification"
  ) as HTMLDivElement | null;
  if (notif) notif.remove();

  notif = document.createElement("div");
  notif.id = "custom-notification";
  notif.textContent = message;
  notif.className = "custom-notification"; // Use CSS class for styling

  document.body.appendChild(notif);

  setTimeout(() => {
    notif!.style.opacity = "0";
    setTimeout(() => notif?.remove(), 350);
  }, durationMs);
}

export function renderPercentBar(
  items: { label: string; percent: number; color: string }[],
  height = 32,
  borderRadius = 8
): string {
  return `
    <div style="display: flex; height: ${height}px; border-radius: ${borderRadius}px; overflow: hidden; border: 1px solid #ccc; margin-bottom: 12px;">
      ${items
        .map(
          (item) => `
        <div title="${item.label}: ${item.percent.toFixed(1)}%" 
             style="width:${item.percent}%;background:${
            item.color
          };display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;">
          ${item.percent > 10 ? item.label : ""}
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

type PieChartContainer = HTMLElement & { _pieChartInstance?: Chart };

export function renderPieChartJS(
  containerId: string,
  items: { label: string; percent: number; color: string }[],
  size = 160
) {
  const container = document.getElementById(
    containerId
  ) as PieChartContainer | null;
  if (!container) return;
  container.innerHTML = "";

  // Create and append canvas
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size / 2;
  container.appendChild(canvas);

  // Destroy previous chart instance if any
  if (container._pieChartInstance) {
    container._pieChartInstance.destroy();
  }

  // Prepare data
  const data = {
    labels: items.map((i) => i.label),
    datasets: [
      {
        data: items.map((i) => i.percent),
        backgroundColor: items.map((i) => i.color),
        borderWidth: 1,
        borderColor: "#fff",
      },
    ],
  };

  // Create Chart.js pie chart
  const chart = new Chart(canvas, {
    type: "pie",
    data,
    options: {
      responsive: false,
      plugins: {
        legend: {
          display: true,
          position: "right",
          labels: {
            boxWidth: 14,
            boxHeight: 12,
            generateLabels: function (chart: Chart) {
              const data = chart.data;
              if (!data.labels || !data.datasets.length) return [];
              const dataset = data.datasets[0];
              return data.labels.map(function (label, i) {
                const value = dataset.data[i];
                const color = (dataset.backgroundColor as string[])[i];
                return {
                  text: `${label} (${
                    typeof value === "number"
                      ? value.toFixed(1)
                      : Array.isArray(value) && typeof value[0] === "number"
                      ? value[0].toFixed(1)
                      : ""
                  }%)`,
                  fillStyle: color,
                  borderRadius: 3,
                  fontColor: color,
                  strokeStyle: color,
                  hidden: !chart.getDataVisibility(i),
                  index: i,
                };
              });
            },
            font: { size: 14 },
          },
        },
        tooltip: {
          callbacks: {
            label: function (ctx) {
              const label = ctx.label || "";
              const value = ctx.parsed || 0;
              return `${label}: ${value.toFixed(1)}%`;
            },
          },
        },
      },
    },
  });

  // Store chart instance for later cleanup
  container._pieChartInstance = chart;
}

type LineChartDataPoint = {
  title: string;
  date: string; // YYYY-MM-DD
  name?: string; // Editor or language
  usage: number; // Usage in seconds or minutes
  color?: string; // Optional: for custom series color
};

type LineChartOptions = {
  containerId: string;
  data: LineChartDataPoint[];
  width?: number;
  height?: number;
  yLabel?: string;
  dateSpan?: string[]; // Optional: array of dates to use as x-axis (for missing days)
};

type LineChartContainer = HTMLElement & { _lineChartInstance?: Chart };

export function renderLineChartJS(opts: LineChartOptions) {
  const {
    containerId,
    data,
    width = 400,
    height = 200,
    yLabel = "Usage",
    dateSpan,
  } = opts;
  const container = document.getElementById(
    containerId
  ) as LineChartContainer | null;
  if (!container) return;
  container.innerHTML = "";

  // Destroy previous chart instance if any
  if (container._lineChartInstance) {
    container._lineChartInstance.destroy();
  }

  // If all data points are missing 'name', use a default name (from title or 'Usage')
  const names = Array.from(new Set(data.map((d) => d.name).filter(Boolean)));
  if (names.length === 0) {
    const defaultName = data[0]?.title || "Usage";
    names.push(defaultName);
    data.forEach((d) => (d.name = defaultName));
  }

  // Get all unique dates (x-axis)
  const dates = dateSpan
    ? dateSpan
    : Array.from(new Set(data.map((d) => d.date))).sort();

  // Assign colors (fallback palette)
  const palette = [
    "#4f8cff",
    "#ffb347",
    "#7ed957",
    "#ff6961",
    "#b19cd9",
    "#f67280",
    "#355c7d",
  ];
  const colorMap: { [name: string]: string } = {};
  names.forEach((name, i) => {
    const custom = data.find((d) => d.name === name && d.color)?.color;
    colorMap[name!] = custom || palette[i % palette.length];
  });

  // Build datasets for Chart.js
  const datasets = names.map((name) => ({
    label: name,
    data: dates.map((date) => {
      const found = data.find((d) => d.name === name && d.date === date);
      return found ? found.usage : 0;
    }),
    borderColor: colorMap[name!],
    backgroundColor: colorMap[name!] + "33", // semi-transparent fill
    tension: 0.2,
    fill: false,
    pointRadius: 3,
    pointHoverRadius: 5,
  }));

  // Create and append canvas
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  container.appendChild(canvas);

  // Use CSS variable for axis/label color
  const axisColor =
    getComputedStyle(document.body).getPropertyValue("--fg").trim() || "#fff";

  // Create Chart.js line chart
  const chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: dates,
      datasets,
    },
    options: {
      responsive: false,
      plugins: {
        legend: {
          labels: {
            color: axisColor,
            font: { size: 13 },
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const label = ctx.dataset.label || "";
              const value = ctx.parsed.y || 0;
              return `${label}: ${value}`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: "Date", color: axisColor },
          ticks: {
            color: axisColor,
            font: { size: 10 }, // smaller font
            maxRotation: 45, // rotate diagonally
            minRotation: 45,
          },
        },
        y: {
          title: { display: true, text: yLabel, color: axisColor },
          ticks: { color: axisColor },
        },
      },
    },
  });

  // Store chart instance for later cleanup
  container._lineChartInstance = chart;
}

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

export interface ChartConfig {
  title: string;
  chartType: "line" | "bar" | "pie" | "doughnut";
  dataSource: "sessions" | "daily-summary";
  groupBy:
    | "date"
    | "language"
    | "editor"
    | "tag"
    | "day-of-week"
    | "hour-of-day";
  aggregation: "total-time" | "session-count" | "average-duration";
  dateRange?: { start: string; end: string };
  filters?: {
    language?: string;
    editor?: string;
    tag?: string;
  };
}

type CustomChartContainer = HTMLElement & { _customChartInstance?: Chart };

export function renderCustomChart(
  containerId: string,
  config: ChartConfig,
  data: (DailySummaryRow | SessionRow)[],
  width = 500,
  height = 300
) {
  const container = document.getElementById(
    containerId
  ) as CustomChartContainer | null;
  if (!container) return;
  container.innerHTML = "";

  // Destroy previous chart instance if any
  if (container._customChartInstance) {
    container._customChartInstance.destroy();
  }

  // Process data based on configuration
  const processedData = processChartData(data, config);

  // Create canvas
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  container.appendChild(canvas);

  // Get theme colors
  const axisColor =
    getComputedStyle(document.body).getPropertyValue("--fg").trim() || "#333";
  const palette = [
    "#4f8cff",
    "#ffb347",
    "#7ed957",
    "#ff6961",
    "#b19cd9",
    "#f67280",
    "#355c7d",
    "#ff9999",
    "#66b3ff",
    "#99ff99",
  ];

  // Chart configuration
  const chartConfig = {
    type: config.chartType,
    data: {
      labels: processedData.labels,
      datasets: [
        {
          label: getDatasetLabel(config),
          data: processedData.values,
          backgroundColor:
            config.chartType === "pie" || config.chartType === "doughnut"
              ? processedData.labels.map((_, i) => palette[i % palette.length])
              : palette[0] + "80",
          borderColor:
            config.chartType === "pie" || config.chartType === "doughnut"
              ? processedData.labels.map((_, i) => palette[i % palette.length])
              : palette[0],
          borderWidth: 2,
          tension: config.chartType === "line" ? 0.3 : undefined,
          fill: config.chartType === "line" ? false : undefined,
        },
      ],
    },
    options: {
      responsive: false,
      plugins: {
        title: {
          display: true,
          text: config.title,
          color: axisColor,
          font: { size: 16, weight: "bold" as const },
        },
        legend: {
          display:
            config.chartType === "pie" || config.chartType === "doughnut",
          labels: {
            color: axisColor,
            font: { size: 12 },
          },
        },
        tooltip: {
          callbacks: {
            label: function (ctx: {
              label?: string;
              parsed: number | { y: number };
            }) {
              const label = ctx.label || "";
              const value =
                typeof ctx.parsed === "number" ? ctx.parsed : ctx.parsed.y;
              const unit = getValueUnit(config.aggregation);
              return `${label}: ${formatChartValue(
                value,
                config.aggregation
              )}${unit}`;
            },
          },
        },
      },
      scales:
        config.chartType !== "pie" && config.chartType !== "doughnut"
          ? {
              x: {
                title: {
                  display: true,
                  text: getAxisLabel(config.groupBy),
                  color: axisColor,
                },
                ticks: {
                  color: axisColor,
                  maxRotation: 45,
                  minRotation: 0,
                },
              },
              y: {
                title: {
                  display: true,
                  text: getDatasetLabel(config),
                  color: axisColor,
                },
                ticks: {
                  color: axisColor,
                  callback: function (value: string | number) {
                    return (
                      formatChartValue(
                        typeof value === "string" ? parseFloat(value) : value,
                        config.aggregation
                      ) + getValueUnit(config.aggregation)
                    );
                  },
                },
              },
            }
          : undefined,
    },
  };

  // Create chart
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chart = new Chart(canvas, chartConfig as any);
  container._customChartInstance = chart;
}

function processChartData(
  data: (DailySummaryRow | SessionRow)[],
  config: ChartConfig
) {
  const grouped: { [key: string]: number[] } = {};

  data.forEach((item) => {
    let key: string;
    let value: number;

    // Determine grouping key
    switch (config.groupBy) {
      case "date": {
        key = "date" in item ? item.date : (item as SessionRow).date;
        break;
      }
      case "language": {
        key = "language" in item ? item.language || "Unknown" : "Unknown";
        break;
      }
      case "editor": {
        key = "app" in item ? item.app || "Unknown" : "Unknown";
        break;
      }
      case "tag": {
        if (config.dataSource === "sessions" && "tags" in item && item.tags) {
          item.tags.forEach((tag: string) => {
            const tagKey = tag || "Untagged";
            if (!grouped[tagKey]) grouped[tagKey] = [];
            const tagValue = getItemValue(item, config.aggregation);
            grouped[tagKey].push(tagValue);
          });
          return; // Skip the rest for tag processing
        } else {
          key = "Untagged";
        }
        break;
      }
      case "day-of-week": {
        const dateStr = "date" in item ? item.date : (item as SessionRow).date;
        const date = new Date(dateStr);
        key = date.toLocaleDateString("en-US", { weekday: "long" });
        break;
      }
      case "hour-of-day": {
        if (config.dataSource === "sessions" && "start_time" in item) {
          const hour = new Date(item.start_time || item.timestamp).getHours();
          key = `${hour}:00`;
        } else {
          key = "All Day"; // Daily summary doesn't have hour data
        }
        break;
      }
      default:
        key = "Unknown";
    }

    if (config.groupBy !== "tag") {
      value = getItemValue(item, config.aggregation);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(value);
    }
  });

  // Aggregate values
  const result: { labels: string[]; values: number[] } = {
    labels: [],
    values: [],
  };

  Object.entries(grouped).forEach(([key, values]) => {
    result.labels.push(key);

    let aggregatedValue: number;
    switch (config.aggregation) {
      case "total-time":
        aggregatedValue = values.reduce((sum, val) => sum + val, 0);
        break;
      case "session-count":
        aggregatedValue = values.length;
        break;
      case "average-duration":
        aggregatedValue =
          values.reduce((sum, val) => sum + val, 0) / values.length;
        break;
      default:
        aggregatedValue = values.reduce((sum, val) => sum + val, 0);
    }

    result.values.push(aggregatedValue);
  });

  // Sort by value (descending) for better visualization
  const sortedIndices = result.values
    .map((val, index) => ({ val, index }))
    .sort((a, b) => b.val - a.val)
    .map((item) => item.index);

  const sortedLabels = sortedIndices.map((i) => result.labels[i]);
  const sortedValues = sortedIndices.map((i) => result.values[i]);

  return { labels: sortedLabels, values: sortedValues };
}

function getItemValue(
  item: DailySummaryRow | SessionRow,
  aggregation: string
): number {
  switch (aggregation) {
    case "total-time":
      return "total_time" in item
        ? item.total_time
        : (item as SessionRow).duration || 0;
    case "session-count":
      return 1; // Each item counts as 1
    case "average-duration":
      return "total_time" in item
        ? item.total_time
        : (item as SessionRow).duration || 0;
    default:
      return "total_time" in item
        ? item.total_time
        : (item as SessionRow).duration || 0;
  }
}

function getDatasetLabel(config: ChartConfig): string {
  switch (config.aggregation) {
    case "total-time":
      return "Total Time";
    case "session-count":
      return "Number of Sessions";
    case "average-duration":
      return "Average Duration";
    default:
      return "Value";
  }
}

function getAxisLabel(groupBy: string): string {
  switch (groupBy) {
    case "date":
      return "Date";
    case "language":
      return "Programming Language";
    case "editor":
      return "Editor/IDE";
    case "tag":
      return "Tag";
    case "day-of-week":
      return "Day of Week";
    case "hour-of-day":
      return "Hour of Day";
    default:
      return "Category";
  }
}

function getValueUnit(aggregation: string): string {
  switch (aggregation) {
    case "total-time":
    case "average-duration":
      return " min";
    case "session-count":
      return "";
    default:
      return "";
  }
}

function formatChartValue(value: number, aggregation: string): string {
  switch (aggregation) {
    case "total-time":
    case "average-duration": {
      const minutes = Math.round(value / 60);
      return minutes.toString();
    }
    case "session-count":
      return Math.round(value).toString();
    default:
      return value.toFixed(1);
  }
}

export function showChartConfigModal(options: {
  data: (DailySummaryRow | SessionRow)[];
  dataSource: "sessions" | "daily-summary";
  onCreateChart: (
    config: ChartConfig,
    data: (DailySummaryRow | SessionRow)[]
  ) => void;
}) {
  const modal = document.createElement("div");
  modal.className = "chart-modal-overlay";

  modal.innerHTML = `
    <div class="chart-modal-content chart-config-modal">
      <div class="chart-modal-header">
        <h3>Create Custom Chart</h3>
        <button class="chart-modal-close">&times;</button>
      </div>
      <div class="chart-modal-body">
        <form id="chartConfigForm">
          <div class="form-group">
            <label for="chartTitle">Chart Title:</label>
            <input type="text" id="chartTitle" class="chart-title-input" value="${
              options.dataSource === "sessions"
                ? "Session Analysis"
                : "Daily Summary Analysis"
            }" required>
          </div>
          
          <div class="form-group">
            <label for="chartType">Chart Type:</label>
            <select id="chartType" required>
              <option value="bar">Bar Chart</option>
              <option value="line">Line Chart</option>
              <option value="pie">Pie Chart</option>
              <option value="doughnut">Doughnut Chart</option>
            </select>
          </div>
          
          <div class="form-group">
            <label for="groupBy">Group Data By:</label>
            <select id="groupBy" required>
              <option value="date">Date</option>
              <option value="language">Programming Language</option>
              <option value="editor">Editor/IDE</option>
              ${
                options.dataSource === "sessions"
                  ? '<option value="tag">Tag</option>'
                  : ""
              }
              <option value="day-of-week">Day of Week</option>
              ${
                options.dataSource === "sessions"
                  ? '<option value="hour-of-day">Hour of Day</option>'
                  : ""
              }
            </select>
          </div>
          
          <div class="form-group">
            <label for="aggregation">Show:</label>
            <select id="aggregation" required>
              <option value="total-time">Total Time Spent</option>
              ${
                options.dataSource === "sessions"
                  ? '<option value="session-count">Number of Sessions</option>'
                  : ""
              }
              ${
                options.dataSource === "sessions"
                  ? '<option value="average-duration">Average Session Duration</option>'
                  : ""
              }
            </select>
          </div>
          
          <div class="chart-preview">
            <h4>Preview:</h4>
            <div id="chartPreview">
              Configure chart to see preview
            </div>
          </div>
        </form>
      </div>
      <div class="chart-modal-footer">
        <button type="button" class="chart-modal-cancel">Cancel</button>
        <button type="button" class="chart-modal-submit" id="createChartBtn">Create Chart</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const titleInput = modal.querySelector("#chartTitle") as HTMLInputElement;
  const typeSelect = modal.querySelector("#chartType") as HTMLSelectElement;
  const groupBySelect = modal.querySelector("#groupBy") as HTMLSelectElement;
  const aggregationSelect = modal.querySelector(
    "#aggregation"
  ) as HTMLSelectElement;
  const createBtn = modal.querySelector("#createChartBtn") as HTMLButtonElement;
  const cancelBtn = modal.querySelector(
    ".chart-modal-cancel"
  ) as HTMLButtonElement;
  const closeBtn = modal.querySelector(
    ".chart-modal-close"
  ) as HTMLButtonElement;

  // Update preview when form changes
  function updatePreview() {
    const config: ChartConfig = {
      title: titleInput.value,
      chartType: typeSelect.value as ChartConfig["chartType"],
      dataSource: options.dataSource,
      groupBy: groupBySelect.value as ChartConfig["groupBy"],
      aggregation: aggregationSelect.value as ChartConfig["aggregation"],
    };

    if (options.data.length > 0) {
      try {
        renderCustomChart("chartPreview", config, options.data, 400, 180);
      } catch (error) {
        // Handle Preview error silently
      }
    }
  }

  [titleInput, typeSelect, groupBySelect, aggregationSelect].forEach(
    (element) => {
      element.addEventListener("change", updatePreview);
      element.addEventListener("input", updatePreview);
    }
  );

  // Initial preview
  setTimeout(updatePreview, 100);

  // Focus the title input and select all text for easy editing
  setTimeout(() => {
    titleInput.focus();
    titleInput.select();
  }, 150);

  // Event handlers
  createBtn.addEventListener("click", () => {
    const config: ChartConfig = {
      title: titleInput.value,
      chartType: typeSelect.value as ChartConfig["chartType"],
      dataSource: options.dataSource,
      groupBy: groupBySelect.value as ChartConfig["groupBy"],
      aggregation: aggregationSelect.value as ChartConfig["aggregation"],
    };

    options.onCreateChart(config, options.data);
    modal.remove();
  });

  [cancelBtn, closeBtn].forEach((btn) => {
    btn.addEventListener("click", () => modal.remove());
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });

  // Prevent modal content clicks from bubbling up
  const modalContent = modal.querySelector(".chart-modal-content");
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
