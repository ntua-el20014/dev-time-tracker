import { ipcRenderer } from "electron";
import type { SessionRow, DailySummaryRow } from "@shared/types";
import { showNotification } from "../components";

export interface ExportOptions {
  format: "csv" | "json";
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
  async exportData(userId: number, options: ExportOptions): Promise<void> {
    try {
      const data = await this.collectData(userId, options);

      if (options.format === "csv") {
        await this.exportAsCSV(data);
      } else {
        await this.exportAsJSON(data);
      }

      // Show success notification
      showNotification("Data exported successfully!");
    } catch (error) {
      console.error("Export failed:", error);
      showNotification("Export failed. Please try again.");
    }
  }

  private async collectData(userId: number, options: ExportOptions) {
    const data: Record<string, unknown[]> = {};

    if (options.includeFields.sessions) {
      const filters: Record<string, unknown> = {};

      if (options.dateRange) {
        filters.startDate = options.dateRange.start;
        filters.endDate = options.dateRange.end;
      }

      let sessions: SessionRow[] = await ipcRenderer.invoke(
        "get-sessions",
        userId,
        filters
      );

      // Apply additional filters
      if (options.filters) {
        if (options.filters.tags && options.filters.tags.length > 0) {
          sessions = sessions.filter((session) =>
            session.tags?.some((tag: string) =>
              options.filters?.tags?.includes(tag)
            )
          );
        }

        if (options.filters.minDuration) {
          sessions = sessions.filter(
            (session) =>
              (session.duration || 0) >= (options.filters?.minDuration || 0)
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
        durationFormatted: this.formatDuration(session.duration || 0),
        tags: session.tags?.join(", ") || "",
        timestamp: session.timestamp,
      }));
    }

    if (options.includeFields.dailySummary) {
      const dailyData: DailySummaryRow[] = await ipcRenderer.invoke(
        "get-daily-summary",
        userId,
        {
          startDate: options.dateRange?.start,
          endDate: options.dateRange?.end,
        }
      );

      data.dailySummary = dailyData.map((day) => ({
        date: day.date,
        application: day.app,
        language: day.language || "Unknown",
        timeSpent: day.total_time,
        timeSpentFormatted: this.formatDuration(day.total_time),
      }));
    }

    if (options.includeFields.tags) {
      data.tags = await ipcRenderer.invoke("get-all-tags", userId);
    }

    if (options.includeFields.goals) {
      data.goals = await ipcRenderer.invoke("get-all-daily-goals", userId);
    }

    return data;
  }

  private async exportAsCSV(data: Record<string, unknown[]>): Promise<void> {
    const { filePath } = await ipcRenderer.invoke("show-save-dialog", {
      title: "Export as CSV",
      defaultPath: `dev-tracker-export-${
        new Date().toISOString().split("T")[0]
      }.zip`,
      filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
    });

    if (!filePath) return;

    await ipcRenderer.invoke("export-custom-csv", data, filePath);
  }

  private async exportAsJSON(data: Record<string, unknown[]>): Promise<void> {
    const { filePath } = await ipcRenderer.invoke("show-save-dialog", {
      title: "Export as JSON",
      defaultPath: `dev-tracker-export-${
        new Date().toISOString().split("T")[0]
      }.json`,
      filters: [{ name: "JSON File", extensions: ["json"] }],
    });

    if (!filePath) return;

    await ipcRenderer.invoke("export-custom-json", data, filePath);
  }

  private formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }
}

export function createExportModal(userId: number): void {
  const exporter = new SessionExporter();

  const modal = document.createElement("div");
  modal.className = "chart-modal-overlay";
  modal.innerHTML = `
    <div class="chart-modal-content export-modal">
      <div class="chart-modal-header">
        <h3>Export Data</h3>
        <button class="chart-modal-close">&times;</button>
      </div>
      <div class="chart-modal-body">
        <form id="exportForm">
          <div class="form-group">
            <label for="exportFormat">Export Format:</label>
            <select id="exportFormat" name="format" required>
              <option value="csv">CSV (ZIP Archive)</option>
              <option value="json">JSON File</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>Date Range (Optional):</label>
            <div class="date-range-inputs">
              <input type="date" name="startDate" placeholder="Start Date" title="Start Date">
              <span class="date-separator">to</span>
              <input type="date" name="endDate" placeholder="End Date" title="End Date">
            </div>
          </div>
          
          <div class="form-group">
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

  const form = modal.querySelector("#exportForm") as HTMLFormElement;
  const submitBtn = modal.querySelector(
    ".chart-modal-submit"
  ) as HTMLButtonElement;
  const cancelBtn = modal.querySelector(
    ".chart-modal-cancel"
  ) as HTMLButtonElement;
  const closeBtn = modal.querySelector(
    ".chart-modal-close"
  ) as HTMLButtonElement;

  // Handle form submission
  submitBtn.addEventListener("click", async (e) => {
    e.preventDefault();

    const formData = new FormData(form);
    const options: ExportOptions = {
      format: formData.get("format") as "csv" | "json",
      includeFields: {
        sessions: formData.has("sessions"),
        dailySummary: formData.has("dailySummary"),
        tags: formData.has("tags"),
        goals: formData.has("goals"),
      },
    };

    // Add date range if specified
    const startDate = formData.get("startDate") as string;
    const endDate = formData.get("endDate") as string;
    if (startDate && endDate) {
      options.dateRange = { start: startDate, end: endDate };
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
      await exporter.exportData(userId, options);
      modal.remove();
    } catch (error) {
      console.error("Export failed:", error);
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

  // Close on Escape key
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      closeModal();
      document.removeEventListener("keydown", handleEscape);
    }
  };
  document.addEventListener("keydown", handleEscape);
}
