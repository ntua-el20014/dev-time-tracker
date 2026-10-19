import { supabase } from "./config";

/**
 * The migrations this build needs: the highest file in database/migrations/
 * (tests/supabase/schemaVersion.test.ts keeps the two in step).
 */
export const REQUIRED_SCHEMA_VERSION = 2;

/**
 * Which migration the database is at (get_schema_version). 0 when it
 * predates that function (migration 2), i.e. it's at migration 1 or the
 * baseline.
 */
export async function getSchemaVersion(): Promise<number> {
  const { data, error } = await (supabase as any).rpc("get_schema_version");
  if (error) {
    // No such function: PostgREST's PGRST202, or Postgres' 42883
    if (error.code === "PGRST202" || error.code === "42883") return 0;
    throw error;
  }
  return Number(data) || 0;
}
