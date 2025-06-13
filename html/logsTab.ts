import { ipcRenderer } from 'electron';
import { formatTimeSpent } from '../src/utils/timeFormat';
import type { LogEntry } from '../src/logger';

function escapeHtml(text: string) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export async function renderLogs(date?: string) {
  const container = document.querySelector('#logTable')?.parentElement;
  if (!container) return;

  // Remove any existing custom title or today title
  const oldMainTitle = container.querySelector('.main-title');
  if (oldMainTitle) oldMainTitle.remove();
  const oldTodayTitle = container.querySelector('.today-title');
  if (oldTodayTitle) oldTodayTitle.remove();

  // Insert TODAY title
  const todayTitle = document.createElement('h2');
  todayTitle.textContent = 'TODAY';
  todayTitle.className = 'today-title';
  todayTitle.style.margin = '12px 0 8px 0';
  todayTitle.style.fontSize = '1.1em';
  todayTitle.style.letterSpacing = '2px';
  todayTitle.style.color = 'var(--accent)';
  container.insertBefore(todayTitle, container.firstChild);

  const logs = await ipcRenderer.invoke('get-logs', date) as LogEntry[];
  const tbody = document.querySelector('#logTable tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  logs.forEach((log) => {
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