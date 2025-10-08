/**
 * Password validation utility for client-side validation
 * Since Supabase free tier doesn't allow server-side password requirements,
 * we implement them on the client side
 */

export interface PasswordRequirements {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
}

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
  strength: "weak" | "medium" | "strong";
}

export const DEFAULT_PASSWORD_REQUIREMENTS: PasswordRequirements = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: false,
};

export function validatePassword(
  password: string,
  requirements: PasswordRequirements = DEFAULT_PASSWORD_REQUIREMENTS
): PasswordValidationResult {
  const errors: string[] = [];

  // Check minimum length
  if (password.length < requirements.minLength) {
    errors.push(
      `Password must be at least ${requirements.minLength} characters long`
    );
  }

  // Check uppercase
  if (requirements.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }

  // Check lowercase
  if (requirements.requireLowercase && !/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }

  // Check numbers
  if (requirements.requireNumbers && !/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number");
  }

  // Check special characters
  if (
    requirements.requireSpecialChars &&
    !/[!@#$%^&*(),.?":{}|<>]/.test(password)
  ) {
    errors.push("Password must contain at least one special character");
  }

  // Calculate strength
  let strength: "weak" | "medium" | "strong" = "weak";
  const strengthScore =
    (password.length >= requirements.minLength ? 1 : 0) +
    (/[A-Z]/.test(password) ? 1 : 0) +
    (/[a-z]/.test(password) ? 1 : 0) +
    (/[0-9]/.test(password) ? 1 : 0) +
    (/[!@#$%^&*(),.?":{}|<>]/.test(password) ? 1 : 0) +
    (password.length >= 12 ? 1 : 0);

  if (strengthScore >= 5) {
    strength = "strong";
  } else if (strengthScore >= 3) {
    strength = "medium";
  }

  return {
    isValid: errors.length === 0,
    errors,
    strength,
  };
}

export function getPasswordStrengthColor(
  strength: "weak" | "medium" | "strong"
): string {
  switch (strength) {
    case "weak":
      return "#ff6b6b";
    case "medium":
      return "#ffa500";
    case "strong":
      return "#51cf66";
  }
}

export function getPasswordStrengthText(
  strength: "weak" | "medium" | "strong"
): string {
  switch (strength) {
    case "weak":
      return "Weak";
    case "medium":
      return "Medium";
    case "strong":
      return "Strong";
  }
}

/**
 * Attaches a real-time password strength indicator to a password input field
 * @param passwordInputSelector - CSS selector for the password input field
 * @param strengthIndicatorId - ID of the element where the strength indicator will be displayed
 * @param delay - Optional delay in ms before attaching (useful for modal rendering)
 */
export function attachPasswordStrengthIndicator(
  passwordInputSelector: string,
  strengthIndicatorId: string,
  delay: number = 100
): void {
  setTimeout(() => {
    const passwordInput = document.querySelector(
      passwordInputSelector
    ) as HTMLInputElement;
    const strengthIndicator = document.getElementById(strengthIndicatorId);

    if (passwordInput && strengthIndicator) {
      passwordInput.addEventListener("input", () => {
        const password = passwordInput.value;
        if (password) {
          const validation = validatePassword(password);
          const color = getPasswordStrengthColor(validation.strength);
          const text = getPasswordStrengthText(validation.strength);

          strengthIndicator.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="flex: 1; height: 4px; background: #e0e0e0; border-radius: 2px; overflow: hidden;">
                <div style="height: 100%; width: ${
                  validation.strength === "weak"
                    ? "33%"
                    : validation.strength === "medium"
                    ? "66%"
                    : "100%"
                }; background: ${color}; transition: all 0.3s;"></div>
              </div>
              <span style="color: ${color}; font-weight: 600;">${text}</span>
            </div>
            ${
              validation.errors.length > 0
                ? `<div style="color: #ff6b6b; margin-top: 4px; font-size: 0.8em;">${validation.errors.join(
                    "<br>"
                  )}</div>`
                : ""
            }
          `;
        } else {
          strengthIndicator.innerHTML = "";
        }
      });
    }
  }, delay);
}
