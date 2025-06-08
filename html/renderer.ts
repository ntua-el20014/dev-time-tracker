/* eslint-disable @typescript-eslint/no-explicit-any */
import { ipcRenderer } from 'electron';
import './index.css';
import { renderLogs } from './logsTab';
import { refreshProfile } from './profileTab';
import { renderSummary } from './summaryTab';
import { initTheme } from './theme';
import { displayOSInfo } from './osInfo';

function setupTabs() {
  const tabs = Array.from(document.querySelectorAll('.tab')) as HTMLButtonElement[];
  const tabContents = Array.from(document.querySelectorAll('.tab-content')) as HTMLDivElement[];

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(tc => {
        tc.classList.remove('active');
        tc.style.display = 'none';
      });

      tab.classList.add('active');
      const tabId = tab.getAttribute('data-tab');
      const content = document.getElementById(`tab-${tabId}`);
      if (content) {
        content.classList.add('active');
        content.style.display = '';
      }

      if (tabId === 'profile') refreshProfile();
      if (tabId === 'summary') renderSummary();
    });
  });
}

function initUI() {
  const localToday = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD format
  initTheme();

  ipcRenderer.on('os-info', (_event, data) => {
    if (data && data.os) displayOSInfo(data.os);
  });

  ipcRenderer.on('window-tracked', () => {
    renderLogs(localToday);
  });

  renderLogs(localToday);
  setupTabs();
}

document.addEventListener('DOMContentLoaded', initUI);