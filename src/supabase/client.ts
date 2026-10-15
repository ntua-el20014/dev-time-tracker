import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types";
import { SUPABASE_CONFIG } from "./env";
import { authStorage } from "./authStorage";

// Initialize Supabase client with configuration from env
export const createSupabaseClient = () => {
  return createClient<Database>(SUPABASE_CONFIG.URL, SUPABASE_CONFIG.ANON_KEY, {
    auth: {
      persistSession: true,
      // The main process is the only Supabase client (the renderer talks to
      // it over IPC), so it alone keeps and refreshes the session
      storage: authStorage,
      autoRefreshToken: true,
      detectSessionInUrl: false, // Important for Electron
      flowType: "pkce", // Use PKCE flow for better security
    },
    global: {
      headers: {
        "X-Client-Info": "dev-time-tracker-electron",
      },
    },
  });
};

export const supabase = createSupabaseClient();
