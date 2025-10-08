import { supabase } from "../../src/supabase/client";
import { showInAppNotification } from "../components/Notifications";
import { showModal } from "../components/Modals";
import {
  validatePassword,
  attachPasswordStrengthIndicator,
} from "./passwordValidator";

// Safely get ipcRenderer only in renderer context
const getIpcRenderer = () => {
  if (typeof window !== "undefined" && (window as any).require) {
    return (window as any).require("electron").ipcRenderer;
  }
  return null;
};

/**
 * Initialize OAuth callback listener for Electron
 * This handles the deep link callback after OAuth authentication
 */
export function initializeOAuthListener(onSuccess: (session: any) => void) {
  // eslint-disable-next-line no-console
  console.log("Initializing OAuth listener");

  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) {
    // eslint-disable-next-line no-console
    console.error("ipcRenderer not available - not in renderer context");
    return;
  }

  // Remove all existing listeners to prevent duplicates
  ipcRenderer.removeAllListeners("oauth-callback");

  // Listen for OAuth callback from main process
  ipcRenderer.on("oauth-callback", async (_event: any, hash: string) => {
    // eslint-disable-next-line no-console
    console.log("OAuth callback received:", hash);

    try {
      // Parse the hash parameters
      const params = new URLSearchParams(hash);
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      const code = params.get("code");
      const type = params.get("type");

      // eslint-disable-next-line no-console
      console.log("Parsed OAuth params:", {
        access_token: !!access_token,
        refresh_token: !!refresh_token,
        code: !!code,
        type,
        allParams: Object.fromEntries(params.entries()),
      });

      // Handle password recovery
      // Check for both 'recovery' type and if we're in a recovery flow
      if (
        (type === "recovery" || params.get("error_code") === "401") &&
        access_token
      ) {
        // eslint-disable-next-line no-console
        console.log("Password recovery detected - showing modal");

        // Set the session with the recovery token
        const { data, error } = await supabase.auth.setSession({
          access_token,
          refresh_token: refresh_token || "",
        });

        if (error) {
          throw error;
        }

        // Show password reset modal
        showInAppNotification("Please enter your new password");
        await showPasswordUpdateModal();

        // After password update, call success callback
        if (data.session && onSuccess) {
          onSuccess(data.session);
        }
        return;
      }

      // If we have an authorization code, exchange it for tokens
      if (code) {
        // eslint-disable-next-line no-console
        console.log("Exchanging authorization code for tokens...");

        const { data, error } = await supabase.auth.exchangeCodeForSession(
          code
        );

        if (error) {
          throw error;
        }

        if (data.session) {
          // eslint-disable-next-line no-console
          console.log("Session established successfully!");
          // eslint-disable-next-line no-console
          console.log(
            "Session user recovery:",
            data.session.user.recovery_sent_at
          );

          // Store user ID
          if (data.session.user?.id) {
            localStorage.setItem("currentUserId", data.session.user.id);
          }

          // Check if this is a password recovery session
          // Supabase indicates recovery via the recovery_sent_at field on the user object
          const isRecovery =
            type === "recovery" || data.session.user.recovery_sent_at;

          if (isRecovery) {
            // eslint-disable-next-line no-console
            console.log(
              "Password recovery detected via code exchange - showing modal"
            );
            showInAppNotification("Please enter your new password");
            await showPasswordUpdateModal();

            // Call success callback after password update
            if (onSuccess) {
              onSuccess(data.session);
            }
            return;
          }

          // Check if this is email confirmation
          if (type === "signup" || type === "email") {
            showInAppNotification("Email confirmed! Welcome!");
          } else {
            showInAppNotification("Successfully signed in with GitHub!");
          }

          // Call success callback
          if (onSuccess) {
            onSuccess(data.session);
          }
        }
      }
      // If we already have tokens (direct hash redirect), use them
      else if (access_token) {
        // eslint-disable-next-line no-console
        console.log("Setting session with access token...");

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

          // Check if this is a password recovery session
          // Supabase indicates recovery via the recovery_sent_at field on the user object
          const isRecovery =
            type === "recovery" || data.session.user.recovery_sent_at;

          if (isRecovery) {
            // eslint-disable-next-line no-console
            console.log(
              "Password recovery detected via access token - showing modal"
            );
            showInAppNotification("Please enter your new password");
            await showPasswordUpdateModal();

            // Call success callback after password update
            if (onSuccess) {
              onSuccess(data.session);
            }
            return;
          }

          // Check if this is email confirmation
          if (type === "signup" || type === "email") {
            showInAppNotification("Email confirmed! Welcome!");
          } else {
            showInAppNotification("Successfully signed in!");
          }

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

/**
 * Sign in with GitHub using external browser
 */
export async function signInWithGitHubElectron() {
  // eslint-disable-next-line no-console
  console.log("signInWithGitHubElectron called");

  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: "dev-time-tracker://oauth-callback",
        skipBrowserRedirect: true, // We'll handle it manually
      },
    });

    // eslint-disable-next-line no-console
    console.log("OAuth response:", { data, error });

    if (error) {
      // eslint-disable-next-line no-console
      console.error("OAuth error:", error);
      throw error;
    }

    // Open OAuth URL in external browser via IPC
    if (data.url) {
      const ipcRenderer = getIpcRenderer();
      if (ipcRenderer) {
        // eslint-disable-next-line no-console
        console.log("Opening OAuth URL:", data.url);
        await ipcRenderer.invoke("open-oauth-url", data.url);
        showInAppNotification("Opening GitHub in your browser...");
      } else {
        // eslint-disable-next-line no-console
        console.error("ipcRenderer not available");
        showInAppNotification("Error: Cannot open browser in this context");
      }
    } else {
      // eslint-disable-next-line no-console
      console.warn("No OAuth URL received");
    }

    return data;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error in signInWithGitHubElectron:", error);
    throw error;
  }
}

/**
 * Show modal for updating password after password reset
 */
async function showPasswordUpdateModal(): Promise<void> {
  return new Promise((resolve, reject) => {
    showModal({
      title: "Reset Your Password",
      dismissible: false, // User must complete password reset
      fields: [
        {
          name: "newPassword",
          label: "New Password",
          type: "password" as const,
          required: true,
        },
        {
          name: "confirmPassword",
          label: "Confirm Password",
          type: "password" as const,
          required: true,
        },
        {
          name: "passwordStrength",
          label: "",
          type: "custom" as const,
          render: () => {
            const container = document.createElement("div");
            container.id = "passwordStrengthIndicator";
            container.style.cssText =
              "margin-top: -10px; margin-bottom: 10px; font-size: 0.85em;";
            return container;
          },
        },
      ],
      submitText: "Update Password",
      onSubmit: async (values) => {
        try {
          const newPassword = values.newPassword as string;
          const confirmPassword = values.confirmPassword as string;

          // Validate passwords match
          if (newPassword !== confirmPassword) {
            throw new Error("Passwords do not match");
          }

          // Validate password strength
          const validation = validatePassword(newPassword);
          if (!validation.isValid) {
            throw new Error(validation.errors.join(". "));
          }

          // Update password
          const { error } = await supabase.auth.updateUser({
            password: newPassword,
          });

          if (error) {
            throw error;
          }

          showInAppNotification("Password updated successfully!");
          resolve();
        } catch (error: any) {
          showInAppNotification(
            `Error: ${error.message || "Failed to update password"}`
          );
          reject(error);
        }
      },
    });

    // Add real-time password validation using the reusable utility
    attachPasswordStrengthIndicator(
      'input[name="newPassword"]',
      "passwordStrengthIndicator"
    );
  });
}
