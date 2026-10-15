/**
 * AI agent sessions (C3): status and settings of the transcript ingest, and
 * the user's uploaded agent sessions.
 */
import { ipcMain } from "electron";
import { getCurrentUser } from "../supabase/api";
import { getAgentSessions } from "../supabase/agentSessions";
import {
  deleteAgentData,
  getAgentIntegrationStatus,
  runAgentIngest,
  setAgentIngestEnabled,
} from "../tracking/agents";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function requireUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error("User not authenticated");
  return user.id;
}

ipcMain.handle("get-agent-integration", async () => {
  try {
    return await getAgentIntegrationStatus(await requireUserId());
  } catch {
    return null;
  }
});

ipcMain.handle("set-agent-integration", async (_event, enabled: unknown) => {
  try {
    if (typeof enabled !== "boolean") return null;
    const uid = await requireUserId();
    await setAgentIngestEnabled(uid, enabled);
    return await getAgentIntegrationStatus(uid);
  } catch {
    return null;
  }
});

/** Ingest now (the "Sync now" button), then report the status. */
ipcMain.handle("sync-agent-sessions", async () => {
  try {
    const uid = await requireUserId();
    await runAgentIngest();
    return await getAgentIntegrationStatus(uid);
  } catch {
    return null;
  }
});

ipcMain.handle(
  "get-agent-sessions",
  async (_event, range: { startDate?: unknown; endDate?: unknown }) => {
    try {
      const { startDate, endDate } = range ?? {};
      if (typeof startDate !== "string" || !DATE.test(startDate)) return [];
      if (typeof endDate !== "string" || !DATE.test(endDate)) return [];
      return await getAgentSessions(await requireUserId(), startDate, endDate);
    } catch {
      return [];
    }
  },
);

ipcMain.handle("delete-agent-data", async () => {
  try {
    await deleteAgentData(await requireUserId());
    return true;
  } catch {
    return false;
  }
});
