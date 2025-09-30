import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types";
import { SUPABASE_CONFIG } from "./env";

// Initialize Supabase client with configuration from env
export const createSupabaseClient = () => {
  // Create memory storage for non-browser environments
  const memoryStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    length: 0,
    clear: () => {},
    key: () => null,
  };

  return createClient<Database>(SUPABASE_CONFIG.URL, SUPABASE_CONFIG.ANON_KEY, {
    auth: {
      persistSession: true,
      // Use localStorage if available (renderer process), otherwise use memory storage
      storage:
        typeof window !== "undefined" ? window.localStorage : memoryStorage,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
};

export const supabase = createSupabaseClient();
