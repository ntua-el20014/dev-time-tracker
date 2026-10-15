import { ipcRenderer } from "../ipc";
import { showInAppNotification } from "../components/Notifications";
import { showModal } from "../components/Modals";
import {
  validatePassword,
  attachPasswordStrengthIndicator,
} from "./passwordValidator";
import { signInWithGitHub, updatePassword } from "../auth";

/**
 * OAuth and email-link callbacks (GitHub sign-in, email confirmation,
 * password reset) are finished by the main process, which owns the session.
 * The renderer only shows what main reports: notices, and the new-password
 * form after a reset link. Signing in itself arrives on "auth-state".
 */
export function initializeOAuthListener() {
  ipcRenderer.removeAllListeners("auth-notice");
  ipcRenderer.removeAllListeners("auth-password-recovery");

  ipcRenderer.on(
    "auth-notice",
    (_event: unknown, notice: { message?: string; type?: "info" | "error" }) => {
      if (notice?.message) {
        showInAppNotification(notice.message, 4000, notice.type === "error" ? "error" : "info");
      }
    },
  );

  ipcRenderer.on("auth-password-recovery", () => {
    showInAppNotification("Please enter your new password");
    void showPasswordUpdateModal().catch(() => {});
  });
}

/**
 * Sign in with GitHub: main opens the browser; the result comes back
 * through the dev-time-tracker:// link.
 */
export async function signInWithGitHubElectron() {
  await signInWithGitHub();
  showInAppNotification("Opening GitHub in your browser...");
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

          await updatePassword(newPassword);

          showInAppNotification("Password updated successfully!");
          resolve();
        } catch (error: any) {
          showInAppNotification(
            `Error: ${error.message || "Failed to update password"}`,
          );
          reject(error);
        }
      },
    });

    // Add real-time password validation using the reusable utility
    attachPasswordStrengthIndicator(
      'input[name="newPassword"]',
      "passwordStrengthIndicator",
    );
  });
}
