const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escapes text for use in HTML — both element content and quoted attribute
 * values. Quotes must be escaped too: the renderer runs with Node access, so
 * a value breaking out of an attribute (e.g. a crafted username) means code
 * execution. This is the only escapeHtml in the renderer; don't add copies.
 */
export function escapeHtml(text: string | number | null | undefined): string {
  return String(text ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// =====================================================
// Loading State Helpers
// =====================================================

/**
 * Show a spinner inside a container. Replaces existing content or appends.
 * Returns the spinner element so it can be removed later.
 */
export function showTabLoading(
  container: HTMLElement,
  message = "Loading…",
  replace = false,
): HTMLElement {
  const spinner = document.createElement("div");
  spinner.className = "tab-loading";
  spinner.setAttribute("data-loading", "true");
  spinner.innerHTML = `
    <div class="tab-loading-spinner"></div>
    <span class="tab-loading-text">${escapeHtml(message)}</span>
  `;

  if (replace) {
    container.innerHTML = "";
  }
  container.appendChild(spinner);
  return spinner;
}

/**
 * Remove all loading spinners from a container.
 */
export function hideTabLoading(container: HTMLElement): void {
  container
    .querySelectorAll('[data-loading="true"]')
    .forEach((el) => el.remove());
  container.classList.remove("is-loading");
}

/**
 * Run an async function while showing a loading spinner.
 * Handles showing/hiding automatically.
 *
 * @example
 * await withLoading(container, "Loading sessions…", async () => {
 *   const data = await safeIpcInvoke("get-sessions", [userId], { fallback: [] });
 *   renderSessions(data);
 * });
 */
export async function withLoading<T>(
  container: HTMLElement,
  message: string,
  fn: () => Promise<T>,
): Promise<T> {
  const spinner = showTabLoading(container, message);
  try {
    const result = await fn();
    return result;
  } finally {
    spinner.remove();
  }
}
