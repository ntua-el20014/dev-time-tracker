import { getCurrentUserId } from "./utils";

interface OnboardingStep {
  title: string;
  content: string;
  icon?: string;
  action?: string;
}

const onboardingSteps: OnboardingStep[] = [
  {
    title: "Welcome to Dev Time Tracker!",
    content:
      "Track your coding sessions, analyze your productivity, and understand your development workflow - all while keeping your data completely private and local.",
    icon: "🚀",
  },
  {
    title: "Start Tracking Your Time",
    content:
      "Use the record button or press Ctrl+R to start tracking your coding sessions. The app automatically detects which editors and programming languages you're using.",
    icon: "⏱️",
    action: "Click the record button to begin!",
  },
  {
    title: "Set Daily Goals",
    content:
      "Set daily coding time goals to stay motivated and track your consistency. Goals help you maintain regular coding habits.",
    icon: "🎯",
    action: "Try setting a goal in the Today tab",
  },
  {
    title: "Analyze Your Data",
    content:
      "View detailed analytics in the Summary tab - see which languages you use most, track your productivity patterns, and create custom charts.",
    icon: "📊",
    action: "Explore the Summary tab when you have some data",
  },
  {
    title: "Customize Your Experience",
    content:
      "Personalize themes, set up global hotkeys, manage tags, and configure idle timeouts in your Profile settings.",
    icon: "⚙️",
    action: "Check out the Profile tab for customization options",
  },
];

export function showOnboarding(): void {
  const currentStep = 0;

  function showStep(stepIndex: number) {
    const step = onboardingSteps[stepIndex];
    const isLastStep = stepIndex === onboardingSteps.length - 1;

    const modal = document.createElement("div");
    modal.className = "onboarding-modal-overlay";

    modal.innerHTML = `
      <div class="onboarding-modal-content">
        <div class="onboarding-header">
          <h2>${step.title}</h2>
          <div class="onboarding-progress">
            <span>${stepIndex + 1} of ${onboardingSteps.length}</span>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${
                ((stepIndex + 1) / onboardingSteps.length) * 100
              }%"></div>
            </div>
          </div>
        </div>
        
        <div class="onboarding-body">
          ${step.icon ? `<div class="onboarding-icon">${step.icon}</div>` : ""}
          <p class="onboarding-text">${step.content}</p>
          ${
            step.action
              ? `<div class="onboarding-action">${step.action}</div>`
              : ""
          }
        </div>
        
        <div class="onboarding-footer">
          <button type="button" class="onboarding-skip">Skip Tour</button>
          <div class="onboarding-nav">
            ${
              stepIndex > 0
                ? '<button type="button" class="onboarding-prev">Previous</button>'
                : ""
            }
            <button type="button" class="onboarding-next">
              ${isLastStep ? "Get Started!" : "Next"}
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Event handlers
    const skipBtn = modal.querySelector(
      ".onboarding-skip"
    ) as HTMLButtonElement;
    const prevBtn = modal.querySelector(
      ".onboarding-prev"
    ) as HTMLButtonElement;
    const nextBtn = modal.querySelector(
      ".onboarding-next"
    ) as HTMLButtonElement;

    skipBtn.addEventListener("click", () => {
      modal.remove();
      markOnboardingComplete();
    });

    if (prevBtn) {
      prevBtn.addEventListener("click", () => {
        modal.remove();
        showStep(stepIndex - 1);
      });
    }

    nextBtn.addEventListener("click", () => {
      modal.remove();
      if (isLastStep) {
        markOnboardingComplete();
      } else {
        showStep(stepIndex + 1);
      }
    });
  }

  showStep(currentStep);
}

function markOnboardingComplete(): void {
  const userId = getCurrentUserId();
  localStorage.setItem(`onboarding-completed-${userId}`, "true");
}

export function shouldShowOnboarding(): boolean {
  const userId = getCurrentUserId();
  return !localStorage.getItem(`onboarding-completed-${userId}`);
}

export function resetOnboarding(): void {
  const userId = getCurrentUserId();
  // Reset onboarding for this specific user
  localStorage.removeItem(`onboarding-completed-${userId}`);
}

// Utility function to clear all onboarding data (for testing/admin purposes)
export function clearAllOnboardingData(): void {
  const keys = Object.keys(localStorage);
  keys.forEach((key) => {
    if (key.startsWith("onboarding-completed-")) {
      localStorage.removeItem(key);
    }
  });
}
