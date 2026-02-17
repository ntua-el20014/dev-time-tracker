/**
 * Export handlers for session-level data exports.
 * These are generic file I/O handlers used by the renderer's SessionExporter.
 * Extracted from the old dbHandler.ts (which handled SQLite-specific operations).
 */
import { ipcMain, dialog } from "electron";
import * as fs from "fs";
import AdmZip from "adm-zip";
import { addCsvToZip } from "../utils/fileOps";
import { logError } from "../utils/errorHandler";

// Show a save dialog and return the selected file path
ipcMain.handle("show-save-dialog", async (_event, options) => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(options);
    if (canceled || !filePath) return { canceled: true };
    return { filePath };
  } catch (err) {
    logError("show-save-dialog", err);
    return { canceled: true };
  }
});

// Export data as a ZIP of CSV files
ipcMain.handle(
  "export-custom-csv",
  async (_event, data: Record<string, unknown[]>, filePath: string) => {
    try {
      const zip = new AdmZip();

      for (const [tableName, tableData] of Object.entries(data)) {
        if (tableData && tableData.length > 0) {
          addCsvToZip(zip, tableData, tableName);
        }
      }

      zip.writeZip(filePath);
      return { status: "success" };
    } catch (err) {
      logError("export-custom-csv", err);
      return {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  },
);

// Export data as JSON
ipcMain.handle(
  "export-custom-json",
  async (_event, data: Record<string, unknown[]>, filePath: string) => {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return { status: "success" };
    } catch (err) {
      logError("export-custom-json", err);
      return {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  },
);
