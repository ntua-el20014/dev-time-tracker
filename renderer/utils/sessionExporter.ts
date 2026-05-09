import { ipcRenderer } from "electron";
import jsPDF from "jspdf";
import type { SessionRow, DailySummaryRow } from "../../shared/types";
import { showNotification } from "../components";
import { formatTimeSpent } from "../../src/utils/timeFormat";
import { safeIpcInvoke } from "./ipcHelpers";

export interface ExportOptions {
  format: "csv" | "json" | "pdf";
  dateRange?: {
    start: string;
    end: string;
  };
  includeFields: {
    sessions: boolean;
    dailySummary: boolean;
    tags: boolean;
    goals: boolean;
  };
  filters?: {
    tags?: string[];
    minDuration?: number; // in seconds
  };
}

export class SessionExporter {
  async exportData(options: ExportOptions): Promise<void> {
    try {
      let success = false;
      if (options.format === "pdf") {
        const pdfData = await this.collectPdfReportData(options);
        success = await this.exportAsPDF(pdfData);
      } else {
        const data = await this.collectData(options);
        if (options.format === "csv") {
          success = await this.exportAsCSV(data);
        } else {
          success = await this.exportAsJSON(data);
        }
      }

      // Only show success notification if export was actually completed
      if (success) {
        showNotification("Data exported successfully!");
      }
    } catch (error) {
      showNotification("Export failed. Please try again.");
    }
  }

  private async collectData(options: ExportOptions) {
    const data: Record<string, unknown[]> = {};

    if (options.includeFields.sessions) {
      const filters: Record<string, unknown> = {};

      if (options.dateRange) {
        filters.startDate = options.dateRange.start;
        filters.endDate = options.dateRange.end;
      }

      let sessions: SessionRow[] = await safeIpcInvoke(
        "get-sessions",
        [filters],
        {
          fallback: [],
          rethrow: true,
          errorMessage: "Failed to fetch sessions for export",
        },
      );

      // Apply additional filters
      if (options.filters) {
        if (options.filters.tags && options.filters.tags.length > 0) {
          sessions = sessions.filter((session) =>
            session.tags?.some((tag: string) =>
              options.filters?.tags?.includes(tag),
            ),
          );
        }

        if (options.filters.minDuration) {
          sessions = sessions.filter(
            (session) =>
              (session.duration || 0) >= (options.filters?.minDuration || 0),
          );
        }
      }

      data.sessions = sessions.map((session) => ({
        id: session.id,
        title: session.title,
        description: session.description,
        date: session.date,
        startTime: session.start_time,
        duration: session.duration,
        durationFormatted: formatTimeSpent(session.duration || 0),
        tags: session.tags?.join(", ") || "",
        timestamp: session.timestamp,
      }));
    }

    if (options.includeFields.dailySummary) {
      const dailyData: DailySummaryRow[] = await safeIpcInvoke(
        "get-daily-summary",
        [
          {
            startDate: options.dateRange?.start,
            endDate: options.dateRange?.end,
          },
        ],
        {
          fallback: [],
          rethrow: true,
          errorMessage: "Failed to fetch daily summary for export",
        },
      );

      data.dailySummary = dailyData.map((day) => ({
        date: day.date,
        application: day.app,
        language: day.language || "Unknown",
        timeSpent: day.total_time,
        timeSpentFormatted: formatTimeSpent(day.total_time),
      }));
    }

    if (options.includeFields.tags) {
      data.tags = await safeIpcInvoke("get-all-tags", [], {
        fallback: [],
        rethrow: true,
        errorMessage: "Failed to fetch tags for export",
      });
    }

    if (options.includeFields.goals) {
      data.goals = await safeIpcInvoke("get-all-daily-goals", [], {
        fallback: [],
        rethrow: true,
        errorMessage: "Failed to fetch goals for export",
      });
    }

    return data;
  }

  private async collectPdfReportData(options: ExportOptions) {
    if (!options.dateRange?.start || !options.dateRange?.end) {
      throw new Error("Please select a date range for the PDF report.");
    }

    const filters = {
      startDate: options.dateRange.start,
      endDate: options.dateRange.end,
    };

    const sessions: SessionRow[] = await safeIpcInvoke(
      "get-sessions",
      [filters],
      {
        fallback: [],
        rethrow: true,
        errorMessage: "Failed to fetch sessions for PDF export",
      },
    );

    const projectSummaryMap = new Map<
      string,
      { projectName: string; totalSeconds: number; sessions: number }
    >();
    let totalSeconds = 0;
    let unassignedSeconds = 0;

    for (const session of sessions) {
      const seconds = session.duration || 0;
      totalSeconds += seconds;

      const projectName = session.project_name?.trim();
      if (projectName) {
        const entry = projectSummaryMap.get(projectName) || {
          projectName,
          totalSeconds: 0,
          sessions: 0,
        };
        entry.totalSeconds += seconds;
        entry.sessions += 1;
        projectSummaryMap.set(projectName, entry);
      } else {
        unassignedSeconds += seconds;
      }
    }

    const projectSummary = Array.from(projectSummaryMap.values()).sort(
      (a, b) => b.totalSeconds - a.totalSeconds,
    );

    return {
      sessions,
      projectSummary,
      totalSeconds,
      totalSessions: sessions.length,
      unassignedSeconds,
      averageSessionSeconds: sessions.length
        ? totalSeconds / sessions.length
        : 0,
      dateRange: options.dateRange,
    };
  }

  private async exportAsCSV(data: Record<string, unknown[]>): Promise<boolean> {
    const { filePath } = await ipcRenderer.invoke("show-save-dialog", {
      title: "Export as CSV",
      defaultPath: `dev-tracker-export-${
        new Date().toISOString().split("T")[0]
      }.zip`,
      filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
    });

    if (!filePath) return false;

    await ipcRenderer.invoke("export-custom-csv", data, filePath);
    return true;
  }

  private async exportAsJSON(
    data: Record<string, unknown[]>,
  ): Promise<boolean> {
    const { filePath } = await ipcRenderer.invoke("show-save-dialog", {
      title: "Export as JSON",
      defaultPath: `dev-tracker-export-${
        new Date().toISOString().split("T")[0]
      }.json`,
      filters: [{ name: "JSON File", extensions: ["json"] }],
    });

    if (!filePath) return false;

    await ipcRenderer.invoke("export-custom-json", data, filePath);
    return true;
  }

  private async exportAsPDF(reportData: {
    sessions: SessionRow[];
    projectSummary: Array<{
      projectName: string;
      totalSeconds: number;
      sessions: number;
    }>;
    totalSeconds: number;
    totalSessions: number;
    unassignedSeconds: number;
    averageSessionSeconds: number;
    dateRange: { start: string; end: string };
  }): Promise<boolean> {
    const { filePath } = await ipcRenderer.invoke("show-save-dialog", {
      title: "Export PDF Report",
      defaultPath: `dev-tracker-report-${reportData.dateRange.start}-to-${reportData.dateRange.end}.pdf`,
      filters: [{ name: "PDF File", extensions: ["pdf"] }],
    });

    if (!filePath) return false;

    const doc = buildPersonalReportPDF(reportData);
    doc.save(filePath);
    return true;
  }
}

export function createExportModal(): void {
  createExportModalInternal({
    title: "Export Data",
    defaultFormat: "csv",
    allowPdf: false,
  });
}

export function createPersonalExportModal(): void {
  createExportModalInternal({
    title: "Export My Data",
    defaultFormat: "pdf",
    allowPdf: true,
  });
}

function createExportModalInternal(config: {
  title: string;
  defaultFormat: "csv" | "json" | "pdf";
  allowPdf: boolean;
}): void {
  const exporter = new SessionExporter();
  const defaultRange = getDefaultDateRange();
  const startDateValue = config.allowPdf ? defaultRange.start : "";
  const endDateValue = config.allowPdf ? defaultRange.end : "";

  const modal = document.createElement("div");
  modal.className = "chart-modal-overlay";
  modal.innerHTML = `
    <div class="chart-modal-content export-modal">
      <div class="chart-modal-header">
        <h3>${config.title}</h3>
        <button class="chart-modal-close">&times;</button>
      </div>
      <div class="chart-modal-body">
        <form id="exportForm">
          <div class="form-group">
            <label for="exportFormat">Export Format:</label>
            <div id="exportFormat-container"></div>
          </div>
          
          <div class="form-group">
            <label>Date Range (Optional):</label>
            <div class="date-range-inputs">
              <input type="date" name="startDate" placeholder="Start Date" title="Start Date" value="${startDateValue}">
              <span class="date-separator">to</span>
              <input type="date" name="endDate" placeholder="End Date" title="End Date" value="${endDateValue}">
            </div>
          </div>

          <div id="export-pdf-note" class="info-note" style="display: none; margin-bottom: 12px;">
            PDF reports include time tracking details and project hours for the selected date range.
          </div>
          
          <div id="export-data-types" class="form-group">
            <label>Include Data Types:</label>
            <div class="checkbox-grid">
              <label class="checkbox-item">
                <input type="checkbox" name="sessions" checked> 
                <span class="checkbox-label">Sessions</span>
                <span class="checkbox-description">Your recorded coding sessions with durations and tags</span>
              </label>
              <label class="checkbox-item">
                <input type="checkbox" name="dailySummary" checked> 
                <span class="checkbox-label">Daily Summary</span>
                <span class="checkbox-description">Time spent per application and language by date</span>
              </label>
              <label class="checkbox-item">
                <input type="checkbox" name="tags"> 
                <span class="checkbox-label">Tags</span>
                <span class="checkbox-description">All your custom tags with colors</span>
              </label>
              <label class="checkbox-item">
                <input type="checkbox" name="goals"> 
                <span class="checkbox-label">Daily Goals</span>
                <span class="checkbox-description">Your daily productivity goals and completion status</span>
              </label>
            </div>
          </div>
          
          <div class="form-group">
            <label for="minDuration">Filters (Optional):</label>
            <div class="filter-inputs">
              <input type="number" id="minDuration" name="minDuration" placeholder="Minimum duration (seconds)" min="0">
              <small class="field-hint">Only include sessions longer than this duration</small>
            </div>
          </div>
        </form>
      </div>
      <div class="chart-modal-footer">
        <button type="button" class="chart-modal-cancel">Cancel</button>
        <button type="button" class="chart-modal-submit">Export Data</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Create custom dropdown for export format
  const { createCustomDropdown } = require("../components/CustomDropdown");
  const exportFormatDropdown = createCustomDropdown({
    id: "exportFormat",
    name: "format",
    value: config.defaultFormat,
    options: [
      { value: "csv", label: "CSV (ZIP Archive)" },
      { value: "json", label: "JSON File" },
      ...(config.allowPdf ? [{ value: "pdf", label: "PDF Report" }] : []),
    ],
    onChange: () => {
      syncFormatUI();
    },
  });
  document
    .getElementById("exportFormat-container")
    ?.appendChild(exportFormatDropdown.getElement());

  const exportDataTypes = modal.querySelector(
    "#export-data-types",
  ) as HTMLElement | null;
  const exportPdfNote = modal.querySelector(
    "#export-pdf-note",
  ) as HTMLElement | null;

  const syncFormatUI = () => {
    const currentFormat =
      exportFormatDropdown.getValue() as ExportOptions["format"];
    const isPdf = currentFormat === "pdf";
    if (exportDataTypes) {
      exportDataTypes.style.display = isPdf ? "none" : "block";
    }
    if (exportPdfNote) {
      exportPdfNote.style.display = isPdf ? "block" : "none";
    }
  };

  syncFormatUI();

  const form = modal.querySelector("#exportForm") as HTMLFormElement;
  const submitBtn = modal.querySelector(
    ".chart-modal-submit",
  ) as HTMLButtonElement;
  const cancelBtn = modal.querySelector(
    ".chart-modal-cancel",
  ) as HTMLButtonElement;
  const closeBtn = modal.querySelector(
    ".chart-modal-close",
  ) as HTMLButtonElement;

  // Handle form submission
  submitBtn.addEventListener("click", async (e) => {
    e.preventDefault();

    const formData = new FormData(form);
    const options: ExportOptions = {
      format: exportFormatDropdown.getValue() as ExportOptions["format"],
      includeFields: {
        sessions: formData.has("sessions"),
        dailySummary: formData.has("dailySummary"),
        tags: formData.has("tags"),
        goals: formData.has("goals"),
      },
    };

    const currentFormat =
      exportFormatDropdown.getValue() as ExportOptions["format"];
    if (currentFormat === "pdf") {
      options.includeFields = {
        sessions: true,
        dailySummary: false,
        tags: false,
        goals: false,
      };
    }

    // Add date range if specified
    const startDate = formData.get("startDate") as string;
    const endDate = formData.get("endDate") as string;
    if (startDate && endDate) {
      options.dateRange = { start: startDate, end: endDate };
    } else if (currentFormat === "pdf") {
      showNotification("Please choose a date range for the PDF report.");
      return;
    }

    // Add filters if specified
    const minDuration = formData.get("minDuration") as string;
    if (minDuration) {
      options.filters = {
        minDuration: parseInt(minDuration),
      };
    }

    // Disable button and show loading state
    submitBtn.textContent = "Exporting...";
    submitBtn.disabled = true;

    try {
      await exporter.exportData(options);
      modal.remove();
    } catch (error) {
      showNotification("Export failed. Please try again.");
      submitBtn.textContent = "Export Data";
      submitBtn.disabled = false;
    }
  });

  // Handle cancel/close
  const closeModal = () => modal.remove();
  cancelBtn.addEventListener("click", closeModal);
  closeBtn.addEventListener("click", closeModal);

  // Close on overlay click
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  // Prevent modal content clicks from bubbling up
  const modalContent = modal.querySelector(".chart-modal-content");
  if (modalContent) {
    modalContent.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }

  // Close on Escape key
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      closeModal();
      document.removeEventListener("keydown", handleEscape);
    }
  };
  document.addEventListener("keydown", handleEscape);
}

function getDefaultDateRange(daysBack = 30): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - daysBack);

  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  };
}

function buildPersonalReportPDF(reportData: {
  sessions: SessionRow[];
  projectSummary: Array<{
    projectName: string;
    totalSeconds: number;
    sessions: number;
  }>;
  totalSeconds: number;
  totalSessions: number;
  unassignedSeconds: number;
  averageSessionSeconds: number;
  dateRange: { start: string; end: string };
}): jsPDF {
  const doc = new jsPDF({ orientation: "landscape" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  let y = margin;

  const ensureSpace = (space: number) => {
    if (y + space > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  const formatTime = (dateString: string) =>
    new Date(dateString).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

  const drawSectionTitle = (title: string) => {
    ensureSpace(12);
    doc.setFontSize(14);
    doc.setTextColor(43, 43, 60);
    doc.text(title, margin, y);
    y += 6;
  };

  const drawStat = (x: number, label: string, value: string) => {
    doc.setFillColor(245, 247, 250);
    doc.setDrawColor(220, 224, 230);
    doc.roundedRect(x, y, 60, 18, 3, 3, "FD");
    doc.setTextColor(90, 90, 90);
    doc.setFontSize(9);
    doc.text(label, x + 4, y + 6);
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(14);
    doc.text(value, x + 4, y + 13);
  };

  doc.setFillColor(43, 43, 60);
  doc.rect(0, 0, pageWidth, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.text("Personal Activity Report", margin, 18);

  y = 38;
  doc.setTextColor(90, 90, 90);
  doc.setFontSize(10);
  doc.text(
    `Period: ${formatDate(reportData.dateRange.start)} to ${formatDate(reportData.dateRange.end)}`,
    margin,
    y,
  );
  y += 10;

  const trackedHours = (reportData.totalSeconds / 3600).toFixed(1);
  const avgMinutes = (reportData.averageSessionSeconds / 60).toFixed(1);
  const unassignedHours = (reportData.unassignedSeconds / 3600).toFixed(1);

  drawStat(margin, "Sessions", String(reportData.totalSessions));
  drawStat(margin + 66, "Tracked Hours", `${trackedHours}h`);
  drawStat(margin + 132, "Avg Session", `${avgMinutes}m`);
  drawStat(margin + 198, "Unassigned", `${unassignedHours}h`);
  y += 26;

  drawSectionTitle("Time Tracking");

  const sessionColumns = {
    date: 22,
    start: 20,
    duration: 20,
    project: 55,
    title: 136,
  };
  const sessionX = {
    date: margin,
    start: margin + sessionColumns.date + 2,
    duration: margin + sessionColumns.date + sessionColumns.start + 4,
    project:
      margin +
      sessionColumns.date +
      sessionColumns.start +
      sessionColumns.duration +
      6,
    title:
      margin +
      sessionColumns.date +
      sessionColumns.start +
      sessionColumns.duration +
      sessionColumns.project +
      8,
  };

  const headerHeight = 7;
  ensureSpace(headerHeight + 6);
  doc.setFillColor(69, 69, 90);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.rect(margin - 1, y - 4, 253, headerHeight, "F");
  doc.text("Date", sessionX.date, y);
  doc.text("Start", sessionX.start, y);
  doc.text("Duration", sessionX.duration, y);
  doc.text("Project", sessionX.project, y);
  doc.text("Session Title", sessionX.title, y);
  y += 8;

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(8.5);

  if (reportData.sessions.length === 0) {
    doc.setTextColor(110, 110, 110);
    doc.text("No sessions found for the selected range.", margin, y + 6);
    y += 12;
  } else {
    for (const session of reportData.sessions) {
      const durationHours = formatTimeSpent(session.duration || 0);
      const projectName = session.project_name || "Unassigned";
      const titleLines = doc.splitTextToSize(
        session.title || "(No title)",
        sessionColumns.title - 2,
      );
      const projectLines = doc.splitTextToSize(
        projectName,
        sessionColumns.project - 2,
      );
      const rowHeight =
        Math.max(titleLines.length, projectLines.length, 1) * 4.5;

      ensureSpace(rowHeight + 3);

      doc.text(formatDate(session.date), sessionX.date, y);
      doc.text(formatTime(session.start_time), sessionX.start, y);
      doc.text(durationHours, sessionX.duration, y);
      doc.text(projectLines, sessionX.project, y);
      doc.text(titleLines, sessionX.title, y);
      y += rowHeight + 2;
    }
  }

  drawSectionTitle("Project Hours");
  ensureSpace(14);
  doc.setFillColor(69, 69, 90);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.rect(margin - 1, y - 4, 253, headerHeight, "F");
  doc.text("Project", margin + 2, y);
  doc.text("Hours", margin + 140, y);
  doc.text("Sessions", margin + 180, y);
  y += 8;

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(8.5);

  if (reportData.projectSummary.length === 0) {
    doc.setTextColor(110, 110, 110);
    doc.text("No project sessions were found in this range.", margin, y + 6);
  } else {
    for (const project of reportData.projectSummary) {
      ensureSpace(7);
      doc.text(project.projectName, margin + 2, y);
      doc.text((project.totalSeconds / 3600).toFixed(1) + "h", margin + 140, y);
      doc.text(String(project.sessions), margin + 180, y);
      y += 6;
    }
  }

  doc.setFontSize(8);
  doc.setTextColor(130, 130, 130);
  doc.text("Generated by Dev Time Tracker", pageWidth / 2, pageHeight - 8, {
    align: "center",
  });

  return doc;
}
