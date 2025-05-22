import { ipcRenderer } from 'electron';
import './index.css';

async function renderLogs() {
  const logs = await ipcRenderer.invoke('get-logs');
  const tbody = document.querySelector('#logTable tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  logs.forEach(log => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${escapeHtml(log.app)}</td>
      <td>${escapeHtml(log.language)}</td>
      <td>${escapeHtml(log.title)}</td>
      <td>${new Date(log.timestamp).toLocaleString()}</td>
    `;
    tbody.appendChild(row);
  });
}

function escapeHtml(text: string) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Theme toggle support
const toggleBtn = document.getElementById('toggleTheme');
if (toggleBtn) {
  toggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('light');
    // Optionally store preference
    const isLight = document.body.classList.contains('light');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
  });

  // Set initial theme
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') {
    document.body.classList.add('light');
  }
}

// Initial load
renderLogs();

// Listen for real-time updates
ipcRenderer.on('window-tracked', () => {
  renderLogs();
});
