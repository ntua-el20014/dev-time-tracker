import { ipcRenderer } from 'electron';
import { formatTimeSpent } from '../src/utils/timeFormat';
import type { LogEntry } from '../src/backend/types';
import { getCurrentUserId } from './utils';
import { getLangIconUrl } from '../src/utils/extractData';
import { showModal, showInAppNotification } from './components';

function escapeHtml(text: string) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export async function renderLogs(date?: string) {
  const container = document.querySelector('#logTable')?.parentElement;
  if (!container) return;

  // --- Daily Goal UI ---
  let dailyGoalDiv = container.querySelector('.daily-goal-div') as HTMLDivElement | null;
  if (!dailyGoalDiv) {
    dailyGoalDiv = document.createElement('div');
    dailyGoalDiv.className = 'daily-goal-div';
    dailyGoalDiv.style.marginBottom = '12px';
    container.insertBefore(dailyGoalDiv, container.firstChild);
  }

  const userId = getCurrentUserId();
  const today = date || new Date().toLocaleDateString('en-CA');
  const dailyGoal = await ipcRenderer.invoke('get-daily-goal', userId, today);

  dailyGoalDiv.innerHTML = '';

  if (dailyGoal) {
    // Show goal info and delete button
    const completed = dailyGoal.isCompleted;
    dailyGoalDiv.innerHTML = `
      <span class="daily-goal-info${completed ? ' completed' : ''}">
        <span class="goal-label">🎯 Daily goal</span>
        <b>${dailyGoal.time}</b> mins${dailyGoal.description ? ': ' + escapeHtml(dailyGoal.description) : ''}
        ${completed ? '<span class="goal-completed">(Completed)</span>' : ''}
      </span>
      <button id="deleteDailyGoalBtn" class="goal-btn">Delete</button>
    `;
    dailyGoalDiv.querySelector('#deleteDailyGoalBtn')?.addEventListener('click', async () => {
      await ipcRenderer.invoke('delete-daily-goal', userId, today);
      showInAppNotification('Daily goal deleted.');
      renderLogs(date);
    });
  } else {
    // Show add button
    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add Daily Goal';
    addBtn.className = 'goal-btn';
    addBtn.onclick = () => {
      showModal({
        title: 'Set Daily Goal',
        fields: [
          { name: 'time', label: 'Time (minutes):', type: 'text', required: true },
          { name: 'description', label: 'Description:', type: 'text' }
        ],
        submitText: 'Set Goal',
        onSubmit: async (values) => {
          const mins = Number(values.time);
          const now = new Date();
          const endOfDay = new Date(now);
          endOfDay.setHours(23,59,59,999);
          const maxMins = Math.floor((endOfDay.getTime() - now.getTime()) / 60000);
          if (isNaN(mins) || mins < 5 || mins > maxMins) {
            showInAppNotification(`Goal must be between 5 and ${maxMins} minutes.`);
            return;
          }
          else if (maxMins <= 5) {
            showInAppNotification('You have no time left today to set a goal.');
            return;
          }
            
          await ipcRenderer.invoke('set-daily-goal', userId, today, mins, values.description || '');
          showInAppNotification('Daily goal set!');
          renderLogs(date);
        }
      });
    };
    dailyGoalDiv.appendChild(addBtn);
  }

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

  const logs = await ipcRenderer.invoke('get-logs', getCurrentUserId(), date) as LogEntry[];
  const tbody = document.querySelector('#logTable tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  logs.forEach((log) => {
    const timeSpent = formatTimeSpent(log.time_spent);
    const langIcon = getLangIconUrl(log.lang_ext);
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><img src="${log.icon}" alt="${escapeHtml(log.app)} icon" class="icon" /></td>
      <td>${escapeHtml(log.app)}</td>
      <td>${langIcon ? `<img src="${langIcon}" alt="${escapeHtml(log.language)}" class="lang-icon" />` : ''}</td>
      <td>${escapeHtml(log.language)}</td>
      <td>${escapeHtml(timeSpent)}</td>
    `;
    tbody.appendChild(row);
  });
}