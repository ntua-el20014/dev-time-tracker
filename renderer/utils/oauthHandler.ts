import { supabase } from "../../src/supabase/client";
import { showInAppNotification } from "../components/Notifications";

// Declare ipcRenderer for Electron
declare const ipcRenderer: any;

/**
 * Initialize OAuth callback listener for Electron
 * This handles the deep link callback after OAuth authentication
 */
export function initializeOAuthListener(onSuccess: (session: any) => void) {
  // Listen for OAuth callback from main process
  if (typeof ipcRenderer !== "undefined") {
    ipcRenderer.on("oauth-callback", async (_event: any, hash: string) => {
      try {
        // Parse the hash parameters
        const params = new URLSearchParams(hash);
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");
        const type = params.get("type");

        if (access_token && type === "signup") {
          // Set the session using the tokens
          const { data, error } = await supabase.auth.setSession({
            access_token,
            refresh_token: refresh_token || "",
          });

          if (error) {
            throw error;
          }

          if (data.session) {
            // Store user ID
            if (data.session.user?.id) {
              localStorage.setItem("currentUserId", data.session.user.id);
            }

            showInAppNotification("Successfully signed in with GitHub!");

            // Call success callback
            if (onSuccess) {
              onSuccess(data.session);
            }
          }
        } else if (params.get("error")) {
          throw new Error(
            params.get("error_description") || "OAuth authentication failed"
          );
        }
      } catch (error: any) {
        // eslint-disable-next-line no-console
        console.error("OAuth callback error:", error);
        showInAppNotification(
          `OAuth Error: ${error.message || "Authentication failed"}`
        );
      }
    });
  }
}

/**
 * Sign in with GitHub using external browser
 */
export async function signInWithGitHubElectron() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: "dev-time-tracker://oauth-callback",
      skipBrowserRedirect: true, // We'll handle it manually
    },
  });

  if (error) {
    throw error;
  }

  // Open OAuth URL in external browser via IPC
  if (data.url && typeof ipcRenderer !== "undefined") {
    await ipcRenderer.invoke("open-oauth-url", data.url);
    showInAppNotification("Opening GitHub in your browser...");
  }

  return data;
}
