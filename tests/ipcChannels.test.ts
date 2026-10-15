/**
 * Keeps shared/ipcChannels.ts (the preload's allowlist) in sync with the
 * code: every channel the renderer uses must be listed and handled in main,
 * and nothing is listed that the renderer doesn't use.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  SEND_CHANNELS,
} from "../shared/ipcChannels";

const ROOT = path.resolve(__dirname, "..");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(rel));
    else if (entry.name.endsWith(".ts")) out.push(fs.readFileSync(path.join(ROOT, rel), "utf-8"));
  }
  return out;
}

const main = sources("src").join("\n");
const renderer = sources("renderer").join("\n");
const all = (text: string, re: RegExp) => new Set([...text.matchAll(re)].map((m) => m[1]));

const handled = all(main, /ipcMain\.handle\(\s*"([^"]+)"/g);
const onMain = all(main, /ipcMain\.(?:on|once)\(\s*"([^"]+)"/g);
const invokedByRenderer = all(
  renderer,
  /(?:invoke|safeIpcInvoke|call)(?:<[^>()]*>)?\(\s*"([^"]+)"/g,
);
const sentByRenderer = all(renderer, /ipcRenderer\.send\(\s*"([^"]+)"/g);
const heardByRenderer = all(renderer, /\.(?:on|removeAllListeners)\(\s*"([^"]+)"/g);
const sentByMain = all(main, /(?:webContents\.send|\bsend)\(\s*"([^"]+)"/g);
const rendererStrings = all(renderer, /"([a-z][a-z0-9:-]+)"/g);

describe("IPC channel allowlist", () => {
  it("every listed invoke channel has a handler and is used by the renderer", () => {
    for (const c of INVOKE_CHANNELS) {
      expect(handled.has(c), `no ipcMain.handle("${c}")`).toBe(true);
      expect(rendererStrings.has(c), `"${c}" isn't used by the renderer — remove it`).toBe(true);
    }
  });

  it("every channel the renderer invokes is listed", () => {
    for (const c of invokedByRenderer) {
      expect(INVOKE_CHANNELS as readonly string[], `add "${c}" to INVOKE_CHANNELS`).toContain(c);
    }
  });

  it("send channels match ipcMain.on and the renderer's sends", () => {
    expect([...onMain].sort()).toEqual([...SEND_CHANNELS].sort());
    for (const c of sentByRenderer) expect(SEND_CHANNELS as readonly string[]).toContain(c);
  });

  it("event channels are sent by main and every one the renderer hears is listed", () => {
    for (const c of EVENT_CHANNELS) {
      expect(sentByMain.has(c), `main never sends "${c}"`).toBe(true);
    }
    for (const c of heardByRenderer) {
      expect(EVENT_CHANNELS as readonly string[], `add "${c}" to EVENT_CHANNELS`).toContain(c);
    }
  });

  it("handlers the UI doesn't use stay out of reach (sensitive ones in particular)", () => {
    for (const c of ["delete-user", "set-user-role", "get-or-create-default-users"]) {
      expect(handled.has(c)).toBe(true);
      expect(INVOKE_CHANNELS as readonly string[]).not.toContain(c);
    }
  });
});
