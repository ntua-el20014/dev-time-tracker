/* eslint-disable @typescript-eslint/no-explicit-any */
import { ipcRenderer } from 'electron';
import './index.css';
import { renderLogs } from './logsTab';
import { refreshProfile } from './profileTab';
import { renderSummary } from './summaryTab';
import { initTheme, updateRecordBtn } from './theme';
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

let isRecording = false;

function setupRecordBtn() {
  const btn = document.getElementById('recordBtn') as HTMLButtonElement;
  const icon = document.getElementById('recordIcon') as HTMLImageElement;
  if (!btn || !icon) return;
  btn.addEventListener('click', async () => {
    isRecording = !isRecording;
    updateRecordBtn(btn, icon, isRecording);
    if (isRecording) {
      await ipcRenderer.invoke('start-tracking');
    } else {
      await ipcRenderer.invoke('stop-tracking');
    }
  });
  updateRecordBtn(btn, icon, isRecording);
}

document.addEventListener('DOMContentLoaded', () => {
  initUI();
  setupRecordBtn();
});