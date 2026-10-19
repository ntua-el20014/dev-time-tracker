/**
 * On sign-in: is the database at least at the migration this build needs?
 * A build ahead of its database otherwise fails only where a missing column
 * or function is used, which looks like a bug. When it's behind, this is
 * logged, reported to Sentry and shown in the app.
 */
import {
  getSchemaVersion,
  REQUIRED_SCHEMA_VERSION,
} from "../supabase/schemaVersion";
import { classifyError, logError } from "./errorHandler";
import { reportError } from "../sentryMain";

export interface DatabaseOutdated {
  /** The database's migration (0: before migration 2) */
  version: number;
  required: number;
}

export async function checkDatabaseVersion(
  notify: (info: DatabaseOutdated) => void,
): Promise<DatabaseOutdated | null> {
  let version: number;
  try {
    version = await getSchemaVersion();
  } catch (err) {
    // Offline: the next sign-in checks again
    if (classifyError(err) !== "network") logError("checkDatabaseVersion", err);
    return null;
  }
  if (version >= REQUIRED_SCHEMA_VERSION) return null;

  const info = { version, required: REQUIRED_SCHEMA_VERSION };
  const error = new Error(
    `Database is at migration ${version || "1 or older"}; this build needs ${REQUIRED_SCHEMA_VERSION}`,
  );
  logError("checkDatabaseVersion", error);
  reportError(error, { ...info });
  notify(info);
  return info;
}
