import { ipcRenderer } from 'electron';
import { formatTimeSpent } from '../src/utils/timeFormat';

function escapeHtml(text: string) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export async function renderLogs(date?: string) {
  const logs = await ipcRenderer.invoke('get-logs', date);
  const tbody = document.querySelector('#logTable tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logs.forEach((log: any) => {
    const timeSpent = formatTimeSpent(log.time_spent);
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><img src="${log.icon}" alt="${escapeHtml(log.app)} icon" class="icon" /></td>
      <td>${escapeHtml(log.app)}</td>
      <td>${escapeHtml(log.language)}</td>
      <td>${escapeHtml(timeSpent)}</td>
    `;
    tbody.appendChild(row);
  });
}