/**
 * Export handlers must only write where the user chose in a save dialog —
 * the renderer is untrusted and must not pick arbitrary paths.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const registeredHandlers: Record<string, Function> = {};
const showSaveDialog = vi.fn();

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      registeredHandlers[channel] = handler;
    }),
  },
  dialog: { showSaveDialog: (...args: unknown[]) => showSaveDialog(...args) },
  BrowserWindow: { fromWebContents: () => null },
}));

const writeFileSync = vi.fn();
vi.mock("fs", () => ({
  writeFileSync: (...args: unknown[]) => writeFileSync(...args),
}));

const writeZip = vi.fn();
vi.mock("adm-zip", () => ({
  default: vi.fn().mockImplementation(() => ({ writeZip })),
}));
vi.mock("../../src/utils/fileOps", () => ({ addCsvToZip: vi.fn() }));
vi.mock("../../src/utils/errorHandler", () => ({ logError: vi.fn() }));

const event = { sender: {} };
const invoke = (channel: string, ...args: unknown[]) =>
  registeredHandlers[channel](event, ...args);

describe("exportHandlers", () => {
  beforeAll(async () => {
    await import("../../src/ipc/exportHandlers");
  });

  beforeEach(() => {
    showSaveDialog.mockReset();
    writeFileSync.mockReset();
    writeZip.mockReset();
  });

  it("refuses to write to a path that wasn't chosen in a save dialog", async () => {
    const res = await invoke("export-custom-json", { a: [1] }, "C:\\evil.json");
    expect(res.status).toBe("error");
    expect(writeFileSync).not.toHaveBeenCalled();

    const zipRes = await invoke("export-custom-csv", { a: [1] }, "C:\\evil.zip");
    expect(zipRes.status).toBe("error");
    expect(writeZip).not.toHaveBeenCalled();
  });

  it("writes to a dialog-approved path exactly once", async () => {
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: "C:\\out.json" });
    expect(await invoke("show-save-dialog", { title: "Export" })).toEqual({
      filePath: "C:\\out.json",
    });

    expect((await invoke("export-custom-json", { a: [1] }, "C:\\out.json")).status).toBe(
      "success",
    );
    expect(writeFileSync).toHaveBeenCalledWith("C:\\out.json", expect.any(String));

    // The approval is single-use
    expect((await invoke("export-custom-json", { a: [1] }, "C:\\out.json")).status).toBe(
      "error",
    );
  });

  it("save-file writes bytes to the chosen path, or nothing when cancelled", async () => {
    showSaveDialog.mockResolvedValueOnce({ canceled: true });
    expect(await invoke("save-file", { data: new Uint8Array([1]) })).toEqual({
      canceled: true,
    });
    expect(writeFileSync).not.toHaveBeenCalled();

    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: "C:\\r.pdf" });
    const res = await invoke("save-file", {
      title: "Save",
      data: new Uint8Array([37, 80, 68, 70]), // %PDF
    });
    expect(res).toEqual({ filePath: "C:\\r.pdf" });
    const [path, bytes] = writeFileSync.mock.calls[0];
    expect(path).toBe("C:\\r.pdf");
    expect(Buffer.from(bytes).toString()).toBe("%PDF");
  });
});
