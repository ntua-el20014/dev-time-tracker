/* eslint-disable @typescript-eslint/no-explicit-any */
import { ipcRenderer } from 'electron';
import './index.css';
import themeLight from '../data/toggle_light.png';
import themeDark from '../data/toggle_dark.png';

function escapeHtml(text: string) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function updateThemeIcon(themeIcon: HTMLImageElement) {
  if (!themeIcon) return;
  if (document.body.classList.contains('light')) {
    themeIcon.src = themeDark;
  } else {
    themeIcon.src = themeLight;
  }
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

async function refreshProfile() {
  const profileDiv = document.getElementById('profileContent');
  if (!profileDiv) return;

  const usage = await ipcRenderer.invoke('get-editor-usage');
  if (!usage || usage.length === 0) {
    profileDiv.innerHTML = '<p>No data available.</p>';
    return;
  }

  const total = usage.reduce((sum: number, row: any) => sum + row.total_time, 0);
  profileDiv.innerHTML = `
    <h2>Editor Usage Breakdown</h2>
    <div style="display: flex; height: 32px; border-radius: 8px; overflow: hidden; border: 1px solid #ccc; margin-bottom: 12px;">
      ${usage.map((row: any, i: number) => {
        const percent = ((row.total_time / total) * 100).toFixed(1);
        const color = ['#4f8cff', '#ffb347', '#7ed957', '#ff6961', '#b19cd9'][i % 5];
        return `<div title="${row.app}: ${percent}%" style="width:${percent}%;background:${color};display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;">
          ${parseFloat(percent) > 10 ? row.app : ''}
        </div>`;
      }).join('')}
    </div>
    <ul>
      ${usage.map((row: any) => {
        const percent = ((row.total_time / total) * 100).toFixed(1);
        return `<li><b>${row.app}</b>: ${percent}%</li>`;
      }).join('')}
    </ul>
  `;
}

function setupTabs() {
  const tabs = Array.from(document.querySelectorAll('.tab')) as HTMLButtonElement[];
  const tabContents = Array.from(document.querySelectorAll('.tab-content')) as HTMLDivElement[];

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active from all and hide all tab contents
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(tc => {
        tc.classList.remove('active');
        tc.style.display = 'none'; // Hide all
      });

      // Add active to selected and show selected tab content
      tab.classList.add('active');
      const tabId = tab.getAttribute('data-tab');
      const content = document.getElementById(`tab-${tabId}`);
      if (content) {
        content.classList.add('active');
        content.style.display = ''; // Show selected
      }

      // Only refresh profile when "My Profile" tab is clicked
      if (tabId === 'profile') {
        refreshProfile();
      }
    });
  });
}

function initUI() {
  const toggleBtn = document.getElementById('toggleTheme');
  const themeIcon = document.getElementById('themeIcon') as HTMLImageElement;

  if (toggleBtn && themeIcon) {
    toggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('light');
      // Optionally store preference
      const isLight = document.body.classList.contains('light');
      localStorage.setItem('theme', isLight ? 'light' : 'dark');
      updateThemeIcon(themeIcon);
    });

    // Set initial theme
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      document.body.classList.add('light');
    }
    updateThemeIcon(themeIcon);
  }

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

  // Initial load
  renderLogs();
  setupTabs();
}

document.addEventListener('DOMContentLoaded', initUI);