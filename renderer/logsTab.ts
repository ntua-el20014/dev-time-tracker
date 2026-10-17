import { formatTimeSpent } from "../src/utils/timeFormat";
import { escapeHtml } from "./utils/domUtils";
import { withLoading, getLogsCached } from "./utils";
import { getLangIconUrl } from "../src/utils/langIconUrl";
import { browserCategoryLabel } from "../shared/browserCategories";
import type { LogEntry } from "../shared/types";

/** "Code review 40m · Docs 30m · Other browsing 1h" under a browser (C5). */
function categoryLine(log: LogEntry): string {
  if (!log.categories?.length) return "";
  const text = log.categories
    .map((c) => `${browserCategoryLabel(c.category)} ${formatTimeSpent(c.seconds)}`)
    .join(" · ");
  return `<div class="log-categories">${escapeHtml(text)}</div>`;
}

/** Home → "App activity today": time per app and language for a day. */
export async function renderLogs(date?: string) {
  // Fetch logs with loading indicator
  const tbody = document.querySelector("#logTable tbody");
  if (!tbody) return;
  const tbodyParent = tbody.parentElement!;
  await withLoading(tbodyParent, "Loading logs…", async () => {
    const logs = await getLogsCached(date);

    tbody.innerHTML = "";
    const fragment = document.createDocumentFragment();
    logs.forEach((log) => {
      const timeSpent = formatTimeSpent(log.time_spent);
      const langIcon = getLangIconUrl(log.lang_ext);
      const row = document.createElement("tr");
      row.innerHTML = `
        <td><img src="${log.icon}" alt="${escapeHtml(
          log.app,
        )} icon" class="icon" /></td>
        <td>${escapeHtml(log.app)}${categoryLine(log)}</td>
        <td>${
          langIcon
            ? `<img src="${langIcon}" alt="${escapeHtml(
                log.language,
              )}" class="lang-icon" />`
            : ""
        }</td>
        <td>${escapeHtml(log.language)}</td>
        <td>${escapeHtml(timeSpent)}</td>
      `;
      fragment.appendChild(row);
    });
    tbody.appendChild(fragment);
  });
}
