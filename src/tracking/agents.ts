/**
 * AI agent sessions (C3, passive): every minute, while signed in and enabled,
 * reads new lines of Claude Code / Codex transcripts (agentIngest.ts) and
 * uploads one metadata row per agent session. On by default; the user can
 * turn it off and delete what was uploaded (Settings → Integrations).
 *
 * Local files (userData): agent-ingest-<uid>.json (read offsets and
 * aggregates) and integrations-<uid>.json ({ agentSessions: boolean }).
 */
import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import {
  createAgentIngest,
  type IngestState,
  type IngestResult,
} from "./agentIngest";
import {
  getAgentTranscripts,
  getTrackingUserId,
  linkedProjectFor,
  onRepoLinksChanged,
  resolveRepoForDir,
} from "./tracker";
import {
  assignAgentSessionsProject,
  deleteAgentSessions,
  upsertAgentSessions,
} from "../supabase/agentSessions";
import { getLanguageDataFromTitle } from "../utils/extractData";
import { classifyError, logError } from "../utils/errorHandler";

const INGEST_MS = 60_000;
const FIRST_RUN_MS = 15_000;

export interface AgentIntegrationStatus {
  enabled: boolean;
  /** Session transcripts found on this machine (last 30 days or older) */
  transcriptsFound: number;
  lastRunAt: string | null;
  /** Rows waiting to upload */
  pending: number;
  /** "offline" for network errors, else a short message */
  lastError: string | null;
}

const userFile = (name: string, uid: string) =>
  path.join(app.getPath("userData"), `${name}-${uid}.json`);

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.promises.readFile(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

/** Write via a temp file so a crash can't leave half a JSON file. */
async function writeJson(file: string, value: unknown) {
  const tmp = `${file}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(value), "utf-8");
  await fs.promises.rename(tmp, file);
}

let current: {
  uid: string;
  ingest: ReturnType<typeof createAgentIngest>;
} | null = null;
let lastRunAt: string | null = null;
let lastResult: IngestResult | null = null;

function ingestFor(uid: string) {
  if (current?.uid === uid) return current.ingest;
  const ingest = createAgentIngest({
    listTranscripts: async () => getAgentTranscripts(),
    async size(p) {
      try {
        return (await fs.promises.stat(p)).size;
      } catch {
        return null;
      }
    },
    async read(p, offset, length) {
      let handle: fs.promises.FileHandle | null = null;
      try {
        handle = await fs.promises.open(p, "r");
        const buf = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buf, 0, length, offset);
        return buf.subarray(0, bytesRead);
      } catch {
        return null;
      } finally {
        await handle?.close();
      }
    },
    loadState: () => readJson<IngestState>(userFile("agent-ingest", uid)),
    saveState: (state) => writeJson(userFile("agent-ingest", uid), state),
    repoForDir: (dir) => {
      const repo = resolveRepoForDir(dir);
      return repo ? { key: repo.key, name: repo.name } : null;
    },
    projectFor: linkedProjectFor,
    upload: (rows) => upsertAgentSessions(uid, rows),
    languageOf: (file) =>
      getLanguageDataFromTitle(path.basename(file))?.language ?? null,
  });
  current = { uid, ingest };
  lastResult = null;
  lastRunAt = null;
  return ingest;
}

export async function isAgentIngestEnabled(uid: string): Promise<boolean> {
  const settings = await readJson<{ agentSessions?: boolean }>(
    userFile("integrations", uid),
  );
  return settings?.agentSessions !== false;
}

export async function setAgentIngestEnabled(uid: string, enabled: boolean) {
  const file = userFile("integrations", uid);
  const settings = (await readJson<Record<string, unknown>>(file)) ?? {};
  await writeJson(file, { ...settings, agentSessions: enabled });
  if (enabled) void runAgentIngest();
}

/** One ingest pass for the signed-in user, if enabled. */
export async function runAgentIngest(): Promise<void> {
  const uid = getTrackingUserId();
  if (!uid || !(await isAgentIngestEnabled(uid))) return;
  try {
    lastResult = await ingestFor(uid).run();
    lastRunAt = new Date().toISOString();
    const err = lastResult.error;
    if (err && classifyError(err) !== "network") logError("agentIngest", err);
  } catch (err) {
    logError("agentIngest", err);
  }
}

export async function getAgentIntegrationStatus(
  uid: string,
): Promise<AgentIntegrationStatus> {
  const err = current?.uid === uid ? lastResult?.error : null;
  return {
    enabled: await isAgentIngestEnabled(uid),
    transcriptsFound: getAgentTranscripts().length,
    lastRunAt: current?.uid === uid ? lastRunAt : null,
    pending: current?.uid === uid ? (lastResult?.pending ?? 0) : 0,
    lastError: err
      ? classifyError(err) === "network"
        ? "offline"
        : String((err as any)?.message ?? err).slice(0, 200)
      : null,
  };
}

/** Turn it off, delete the uploaded rows and forget local progress. */
export async function deleteAgentData(uid: string) {
  await setAgentIngestEnabled(uid, false);
  await deleteAgentSessions(uid);
  await ingestFor(uid).reset();
  lastResult = null;
}

export function initAgentIngest() {
  // Linking a repo attributes its agent sessions, here and on other devices
  onRepoLinksChanged((link) => {
    const uid = getTrackingUserId();
    if (!uid || current?.uid !== uid) return;
    void current.ingest.markAllDirty().then(runAgentIngest);
    if (link) {
      assignAgentSessionsProject(uid, link.repoKey, link.projectId).catch(
        (err) => {
          if (classifyError(err) !== "network") {
            logError("assignAgentSessionsProject", err);
          }
        },
      );
    }
  });
  setTimeout(() => void runAgentIngest(), FIRST_RUN_MS);
  setInterval(() => void runAgentIngest(), INGEST_MS);
}
