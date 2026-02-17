import { showModal } from "./Modals";
import { showInAppNotification } from "./Notifications";
import {
  signInWithEmail,
  signUpWithEmail,
  getCurrentSession,
  resetPasswordForEmail,
  resendVerificationEmail,
} from "../../src/supabase/api";
import {
  validatePassword,
  attachPasswordStrengthIndicator,
} from "../utils/passwordValidator";
import {
  signInWithGitHubElectron,
  initializeOAuthListener,
} from "../utils/oauthHandler";

interface AuthFormData {
  email: string;
  password: string;
  username?: string;
}

/**
 * Enhanced Landing Page with proper authentication flow for Electron app
 */
export async function renderLandingPage(
  container: HTMLElement,
  onAuthSuccess?: (session: any) => void,
) {
  // Initialize OAuth listener for callback handling
  if (onAuthSuccess) {
    initializeOAuthListener(onAuthSuccess);
  }

  // Check for existing session
  try {
    const session = await getCurrentSession();
    if (session && onAuthSuccess) {
      onAuthSuccess(session);
      return;
    }
  } catch (error: any) {
    // Session check failed, continue with normal auth flow
    // If it's a fetch error, show a warning
    if (error.message && error.message.includes("fetch")) {
      showInAppNotification(
        "Warning: Unable to connect to authentication service. Using offline mode.",
      );
    }
  }

  container.innerHTML = `
    <div class="auth-landing">
      <h2>Welcome to Dev Time Tracker</h2>
      <div class="auth-options">
        <div class="auth-option" id="loginOption">
          <div class="icon">👤</div>
          <div class="label">Login</div>
          <div class="description">Already have an account? Sign in to continue tracking your development time</div>
        </div>
        <div class="auth-option" id="signupOption">
          <div class="icon">✨</div>
          <div class="label">Sign Up</div>
          <div class="description">Create a new account to start tracking your coding sessions</div>
        </div>
      </div>
      <div id="authError" class="error-message" style="display: none;"></div>
    </div>
  `;

  const errorDiv = container.querySelector("#authError") as HTMLElement;

  const showError = (message: string) => {
    errorDiv.textContent = message;
    errorDiv.style.display = "block";
    setTimeout(() => {
      errorDiv.style.display = "none";
    }, 5000);
  };

  // Handle login option click
  const loginOption = container.querySelector("#loginOption");
  loginOption?.addEventListener("click", () => {
    showAuthModal("login", onAuthSuccess, showError);
  });

  // Handle signup option click
  const signupOption = container.querySelector("#signupOption");
  signupOption?.addEventListener("click", () => {
    showAuthModal("signup", onAuthSuccess, showError);
  });
}

async function showAuthModal(
  type: "login" | "signup",
  onSuccess?: (session: any) => void,
  onError?: (message: string) => void,
) {
  const title = type === "login" ? "Login" : "Sign Up";
  const fields: any[] = [
    {
      name: "email",
      label: "Email",
      type: "text" as const,
      required: true,
    },
    {
      name: "password",
      label: "Password",
      type: "password" as const,
      required: true,
    },
  ];

  if (type === "signup") {
    fields.splice(1, 0, {
      name: "username",
      label: "Username",
      type: "text" as const,
      required: true,
    });

    // Add password strength indicator for signup
    fields.push({
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
    });
  } else {
    // Add forgot password link for login
    fields.push({
      name: "forgotPassword",
      label: "",
      type: "custom" as const,
      render: () => {
        const container = document.createElement("div");
        container.style.cssText =
          "margin-top: 8px; margin-bottom: 8px; text-align: right;";

        const link = document.createElement("a");
        link.href = "#";
        link.textContent = "Forgot password?";
        link.style.cssText =
          "color: var(--accent); font-size: 0.9em; text-decoration: none; cursor: pointer;";

        link.onmouseenter = () => {
          link.style.textDecoration = "underline";
        };
        link.onmouseleave = () => {
          link.style.textDecoration = "none";
        };

        link.onclick = (e) => {
          e.preventDefault();
          showPasswordResetModal();
        };

        container.appendChild(link);
        return container;
      },
    });
  }

  // Add OAuth section for both login and signup
  fields.push({
    name: "oauthSection",
    label: "",
    type: "custom" as const,
    render: () => {
      const container = document.createElement("div");
      container.className = "oauth-section";

      // Add divider
      const divider = document.createElement("div");
      divider.className = "oauth-divider";
      divider.innerHTML = "<span>or continue with</span>";
      container.appendChild(divider);

      // Add GitHub button
      const githubBtn = document.createElement("button");
      githubBtn.type = "button";
      githubBtn.className = "oauth-button";
      githubBtn.innerHTML = `
        <span class="icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
        </span>
        <span>GitHub</span>
      `;

      githubBtn.onclick = async (e) => {
        e.preventDefault();

        // Close the modal before redirecting
        const modal = document.getElementById("customModal");
        const overlay = document.getElementById("customModalOverlay");
        if (modal) {
          modal.classList.remove("active");
          modal.remove();
        }
        if (overlay) {
          overlay.remove();
        }

        try {
          await signInWithGitHubElectron();
          // The OAuth listener will handle the callback
        } catch (error: any) {
          // eslint-disable-next-line no-console
          console.error("GitHub OAuth error:", error);
          const errorMessage = getAuthErrorMessage(error);
          if (onError) {
            onError(errorMessage);
          } else {
            showInAppNotification(errorMessage);
          }
        }
      };

      container.appendChild(githubBtn);
      return container;
    },
  });

  showModal({
    title,
    fields,
    submitText: title,
    onSubmit: async (values) => {
      try {
        const authData = values as unknown as AuthFormData;

        // Validate password for signup
        if (type === "signup") {
          const validation = validatePassword(authData.password);
          if (!validation.isValid) {
            throw new Error(validation.errors.join(". "));
          }
        }

        if (type === "login") {
          const result = await signInWithEmail(
            authData.email,
            authData.password,
          );

          // Store user ID in localStorage
          if (result.session?.user?.id) {
            localStorage.setItem("currentUserId", result.session.user.id);
          }

          if (onSuccess) {
            onSuccess(result.session);
          }

          showInAppNotification("Successfully logged in!");
        } else {
          const result = await signUpWithEmail(
            authData.email,
            authData.password,
            authData.username!,
          );

          // User profile is automatically created by database trigger
          // Store user ID if session exists
          if (result.session?.user?.id) {
            localStorage.setItem("currentUserId", result.session.user.id);
          }

          if (onSuccess && result.session) {
            onSuccess(result.session);
          }

          showInAppNotification(
            result.session
              ? "Account created successfully!"
              : "Account created! Please check your email for verification.",
          );
        }
      } catch (error: any) {
        const errorMessage = getAuthErrorMessage(error);
        if (errorMessage === "EMAIL_NOT_CONFIRMED") {
          // Show verification needed message with resend option
          const email = (values as unknown as AuthFormData).email;
          showEmailVerificationPrompt(email);
        } else if (onError) {
          onError(errorMessage);
        } else {
          showInAppNotification(errorMessage);
        }
      }
    },
  });

  // Add real-time password validation for signup using the reusable utility
  if (type === "signup") {
    attachPasswordStrengthIndicator(
      'input[name="password"]',
      "passwordStrengthIndicator",
    );
  }
}

async function showPasswordResetModal() {
  showModal({
    title: "Reset Password",
    fields: [
      {
        name: "email",
        label: "Email",
        type: "text" as const,
        required: true,
      },
    ],
    submitText: "Send Reset Link",
    onSubmit: async (values) => {
      try {
        await resetPasswordForEmail(values.email as string);
        showInAppNotification(
          "Password reset link sent! Please check your email.",
        );
      } catch (error: any) {
        showInAppNotification(
          `Error: ${error.message || "Failed to send reset email"}`,
        );
      }
    },
  });
}

function showEmailVerificationPrompt(email: string) {
  showModal({
    title: "Email Verification Required",
    fields: [
      {
        name: "info",
        label: "",
        type: "custom" as const,
        render: () => {
          const container = document.createElement("div");
          container.style.cssText =
            "text-align: center; padding: 10px 0; line-height: 1.6;";
          container.innerHTML = `
            <p style="margin-bottom: 12px;">Your email address <strong>${email}</strong> has not been verified yet.</p>
            <p style="margin-bottom: 16px; color: var(--text-secondary);">Please check your inbox (and spam folder) for the verification link.</p>
          `;

          const resendBtn = document.createElement("button");
          resendBtn.type = "button";
          resendBtn.className = "oauth-button";
          resendBtn.style.cssText =
            "width: 100%; justify-content: center; margin-top: 4px;";
          resendBtn.innerHTML = `<span>📧</span><span>Resend Verification Email</span>`;
          resendBtn.onclick = async () => {
            resendBtn.disabled = true;
            resendBtn.innerHTML = `<span>⏳</span><span>Sending...</span>`;
            try {
              await resendVerificationEmail(email);
              showInAppNotification(
                "Verification email sent! Please check your inbox.",
              );
              resendBtn.innerHTML = `<span>✅</span><span>Email Sent!</span>`;
              setTimeout(() => {
                resendBtn.disabled = false;
                resendBtn.innerHTML = `<span>📧</span><span>Resend Verification Email</span>`;
              }, 30000); // Re-enable after 30 seconds
            } catch (err: any) {
              resendBtn.disabled = false;
              resendBtn.innerHTML = `<span>📧</span><span>Resend Verification Email</span>`;
              if (
                err.message?.includes("rate limit") ||
                err.message?.includes("60 seconds")
              ) {
                showInAppNotification(
                  "Please wait before requesting another email.",
                );
              } else {
                showInAppNotification(
                  `Error: ${err.message || "Failed to resend email"}`,
                );
              }
            }
          };

          container.appendChild(resendBtn);
          return container;
        },
      },
    ],
    submitText: "OK",
    onSubmit: () => {
      // Just dismiss the modal
    },
  });
}

function getAuthErrorMessage(error: any): string {
  if (!error.message) return "Authentication failed";

  // Handle fetch/network errors
  if (
    error.message.includes("Failed to fetch") ||
    error.message.includes("fetch")
  ) {
    return "Network error: Please check your internet connection and try again. If the problem persists, the authentication service may be unavailable.";
  }

  // Handle CORS errors
  if (error.message.includes("CORS") || error.name === "TypeError") {
    return "Connection error: Unable to reach authentication service. Please try again.";
  }

  if (error.message.includes("Invalid login credentials")) {
    return "Invalid email or password";
  } else if (error.message.includes("Email not confirmed")) {
    return "EMAIL_NOT_CONFIRMED";
  } else if (error.message.includes("User already registered")) {
    return "An account with this email already exists";
  } else if (error.message.includes("Password should be at least")) {
    return "Password is too weak. Please use a stronger password";
  } else if (error.message.includes("Email rate limit exceeded")) {
    return "Too many attempts. Please try again later";
  }

  return error.message || "Authentication failed";
}

// Export helper functions for main app
export { checkAuthStatus, onAuthStateChange } from "../../src/supabase/api";
