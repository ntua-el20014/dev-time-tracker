import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types";
import { SUPABASE_CONFIG } from "./env";

// Create a custom storage adapter for Electron
const electronStorage = {
  getItem: (key: string) => {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage.getItem(key);
    }
    return null;
  },
  setItem: (key: string, value: string) => {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  },
  removeItem: (key: string) => {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  },
};

// Initialize Supabase client with configuration from env
export const createSupabaseClient = () => {
  return createClient<Database>(SUPABASE_CONFIG.URL, SUPABASE_CONFIG.ANON_KEY, {
    auth: {
      persistSession: true,
      storage: electronStorage,
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
