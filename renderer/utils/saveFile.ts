/**
 * Saving files from the renderer. The renderer has no file system access:
 * main shows the save dialog and writes the bytes (see "save-file" in
 * src/ipc/exportHandlers.ts). Don't use jsPDF's doc.save() — without Node it
 * falls back to a browser download.
 */
import type jsPDF from "jspdf";
import { ipcRenderer } from "../ipc";

/**
 * Ask where to save the PDF and write it. Resolves to false if the user
 * cancelled; throws if writing failed.
 */
export async function savePdf(
  doc: jsPDF,
  options: { title: string; defaultPath: string },
): Promise<boolean> {
  const data = new Uint8Array(doc.output("arraybuffer"));
  const result = await ipcRenderer.invoke("save-file", {
    ...options,
    filters: [{ name: "PDF File", extensions: ["pdf"] }],
    data,
  });
  if (result?.error) throw new Error(result.error);
  return !!result?.filePath;
}
