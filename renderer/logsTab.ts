import { formatTimeSpent } from "../src/utils/timeFormat";
import { escapeHtml } from "./utils/domUtils";
import { withLoading, getLogsCached } from "./utils";
import { getLangIconUrl } from "../src/utils/langIconUrl";

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
        <td>${escapeHtml(log.app)}</td>
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
