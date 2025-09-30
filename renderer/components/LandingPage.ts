import { showModal } from "./Modals";
import { showInAppNotification } from "./Notifications";
import {
  signInWithEmail,
  signUpWithEmail,
  createUserProfile,
  getCurrentSession,
} from "../../src/supabase/api";

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
  onAuthSuccess?: (session: any) => void
) {
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
        "Warning: Unable to connect to authentication service. Using offline mode."
      );
    }
  }

  // Add necessary styles
  const style = document.createElement("style");
  style.textContent = `
    .auth-landing {
      max-width: 700px;
      margin: 40px auto;
      padding: 32px 0;
    }

    .auth-landing h2 {
      text-align: center;
      margin-bottom: 32px;
      font-size: 2em;
      color: var(--accent, #ffe066);
    }

    .auth-options {
      display: flex;
      gap: 24px;
      justify-content: center;
      flex-wrap: wrap;
    }

    .auth-option {
      width: 180px;
      border-radius: 18px;
      box-shadow: 0 2px 12px #0001;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 24px 12px;
      cursor: pointer;
      transition: box-shadow 0.2s, transform 0.15s;
      background: var(--bg-light);
    }

    .auth-option:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 16px #0002;
    }

    .auth-option .icon {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
      font-size: 1.8em;
    }

    .auth-option .label {
      font-size: 1.2em;
      color: var(--fg);
      margin-bottom: 8px;
    }

    .auth-option .description {
      font-size: 0.9em;
      color: var(--fg-muted);
      text-align: center;
      line-height: 1.4;
    }

    .loading {
      opacity: 0.7;
      pointer-events: none;
    }

    .error-message {
      color: #ff6b6b;
      text-align: center;
      margin-top: 16px;
      padding: 8px;
      border-radius: 4px;
      background: #ff6b6b20;
    }
  `;
  document.head.appendChild(style);

  // Render the landing page
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
        <div class="auth-option" id="testUserLandingOption" style="border: 2px dashed #ff6b6b; opacity: 0.8;">
          <div class="icon">🧪</div>
          <div class="label">Test Users</div>
          <div class="description">Testing only - Go to user landing page</div>
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

  // Handle test user landing option click (temporary testing button)
  const testUserLandingOption = container.querySelector(
    "#testUserLandingOption"
  );
  testUserLandingOption?.addEventListener("click", async () => {
    // Import UserLanding component dynamically
    const { renderUserLanding } = await import("./UserLanding");
    container.innerHTML = "";
    renderUserLanding(container, (userId) => {
      if (onAuthSuccess) {
        const fakeSession = {
          user: {
            id: userId,
            email: "test@local.dev",
          },
        };
        onAuthSuccess(fakeSession);
      }
    });
  });
}

async function showAuthModal(
  type: "login" | "signup",
  onSuccess?: (session: any) => void,
  onError?: (message: string) => void
) {
  const title = type === "login" ? "Login" : "Sign Up";
  const fields = [
    {
      name: "email",
      label: "Email",
      type: "text" as const,
      required: true,
    },
    {
      name: "password",
      label: "Password",
      type: "text" as const,
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
  }

  showModal({
    title,
    fields,
    submitText: title,
    onSubmit: async (values) => {
      try {
        const authData = values as unknown as AuthFormData;

        if (type === "login") {
          const result = await signInWithEmail(
            authData.email,
            authData.password
          );

          if (onSuccess) {
            onSuccess(result.session);
          }

          showInAppNotification("Successfully logged in!");
        } else {
          const result = await signUpWithEmail(
            authData.email,
            authData.password,
            authData.username!
          );

          // Create user profile after successful signup
          if (result.user) {
            try {
              await createUserProfile({
                id: result.user.id,
                username: authData.username!,
                // org_id will be handled by the database trigger
              });
            } catch (profileError) {
              // Don't throw here - the user account was created successfully
              // Profile creation will be handled by database trigger if this fails
            }
          }

          if (onSuccess && result.session) {
            onSuccess(result.session);
          }

          showInAppNotification(
            result.session
              ? "Account created successfully!"
              : "Account created! Please check your email for verification."
          );
        }
      } catch (error: any) {
        const errorMessage = getAuthErrorMessage(error);
        if (onError) {
          onError(errorMessage);
        } else {
          showInAppNotification(errorMessage);
        }
      }
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
    return "Please verify your email address before logging in";
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
