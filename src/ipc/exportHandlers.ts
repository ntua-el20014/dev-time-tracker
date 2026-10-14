/**
 * File export handlers.
 *
 * The renderer is untrusted (no Node access), so main only writes to paths
 * the user just picked in a save dialog — never to a path the renderer makes
 * up.
 */
import {
  ipcMain,
  dialog,
  BrowserWindow,
  type FileFilter,
  type IpcMainInvokeEvent,
} from "electron";
import * as fs from "fs";
import AdmZip from "adm-zip";
import { addCsvToZip } from "../utils/fileOps";
import { logError } from "../utils/errorHandler";

/** Paths returned by show-save-dialog, each usable for one export. */
const approvedSavePaths = new Set<string>();

interface SaveDialogRequest {
  title?: string;
  defaultPath?: string;
  filters?: FileFilter[];
}

async function askSavePath(
  event: IpcMainInvokeEvent,
  { title, defaultPath, filters }: SaveDialogRequest,
): Promise<string | null> {
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = { title, defaultPath, filters };
  const { canceled, filePath } = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options);
  return canceled || !filePath ? null : filePath;
}

function takeApprovedPath(filePath: string): boolean {
  return approvedSavePaths.delete(filePath);
}

// Show a save dialog and return the selected file path (for the CSV/JSON
// exports below, which receive the path back)
ipcMain.handle(
  "show-save-dialog",
  async (event, options: SaveDialogRequest = {}) => {
    try {
      const filePath = await askSavePath(event, options);
      if (!filePath) return { canceled: true };
      approvedSavePaths.add(filePath);
      return { filePath };
    } catch (err) {
      logError("show-save-dialog", err);
      return { canceled: true };
    }
  },
);

// Ask where to save, then write the given bytes/text there (used for PDFs)
ipcMain.handle(
  "save-file",
  async (
    event,
    request: SaveDialogRequest & { data: Uint8Array | string },
  ) => {
    try {
      const filePath = await askSavePath(event, request);
      if (!filePath) return { canceled: true };
      fs.writeFileSync(
        filePath,
        typeof request.data === "string"
          ? request.data
          : Buffer.from(request.data),
      );
      return { filePath };
    } catch (err) {
      logError("save-file", err);
      return {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
);

// Export data as a ZIP of CSV files
ipcMain.handle(
  "export-custom-csv",
  async (_event, data: Record<string, unknown[]>, filePath: string) => {
    try {
      if (!takeApprovedPath(filePath)) {
        throw new Error("Export path was not chosen in a save dialog");
      }
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
      if (!takeApprovedPath(filePath)) {
        throw new Error("Export path was not chosen in a save dialog");
      }
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
