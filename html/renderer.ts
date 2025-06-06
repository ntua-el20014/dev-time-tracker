import { ipcRenderer } from 'electron';
import './index.css';
import themeLight from '../data/toggle_light.png';
import themeDark from '../data/toggle_dark.png';

async function renderLogs() {
  const logs = await ipcRenderer.invoke('get-logs');
  const tbody = document.querySelector('#logTable tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logs.forEach((log: any) => {
    const minutes = (log.time_spent / 60).toFixed(1);
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><img src="${log.icon}" alt="${escapeHtml(log.app)} icon" class="icon" /></td>
      <td>${escapeHtml(log.app)}</td>
      <td>${escapeHtml(log.language)}</td>
      <td>${escapeHtml(minutes)}</td>
    `;
    tbody.appendChild(row);
  });
}
//<td>${escapeHtml(log.title)}</td>

function escapeHtml(text: string) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Theme toggle support
const toggleBtn = document.getElementById('toggleTheme');
const themeIcon = document.getElementById('themeIcon') as HTMLImageElement;

function updateThemeIcon() {
  if (!themeIcon) return;
  if (document.body.classList.contains('light')) {
    themeIcon.src = themeDark; // Use imported variable
  } else {
    themeIcon.src = themeLight;
  }
}

if (toggleBtn) {
  toggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('light');
    // Optionally store preference
    const isLight = document.body.classList.contains('light');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    updateThemeIcon();
  });

  // Set initial theme
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') {
    document.body.classList.add('light');
  }
  updateThemeIcon();
}

function displayOSInfo(os: string) {
  let osDiv = document.getElementById('os-info') as HTMLDivElement | null;
  if (!osDiv) {
    osDiv = document.createElement('div');
    osDiv.id = 'os-info';
    osDiv.style.position = 'fixed';
    osDiv.style.right = '20px';
    osDiv.style.bottom = '20px';
    osDiv.style.opacity = '0.7';
    osDiv.style.fontSize = '14px';
    document.body.appendChild(osDiv);
  }
  osDiv.textContent = `OS: ${os}`;
}
// Initial load
renderLogs();

// Listen for OS info once at startup
ipcRenderer.on('os-info', (_event, data) => {
  if (data && data.os) {
    displayOSInfo(data.os);
  }
});

// Listen for real-time updates
ipcRenderer.on('window-tracked', () => {
  renderLogs();
});