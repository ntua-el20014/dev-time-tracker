/* eslint-disable @typescript-eslint/no-explicit-any */
import { ipcRenderer } from 'electron';
import { renderLogs } from './logsTab';
import { refreshProfile } from './profileTab';
import { renderSummary } from './summaryTab';
import { renderDashboard } from './dashboardTab';
import { initTheme, updateRecordBtn, updatePauseBtn } from './theme';
import { displayOSInfo, showModal, showNotification } from './components';
import './styles/base.css';
import './styles/layout.css';
import './styles/table.css';
import './styles/modal.css';
import './styles/calendar.css';
import './styles/timeline.css';
import './styles/profile.css';
import './styles/theme.css';

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
      if (tabId === 'dashboard') renderDashboard();
      if (tabId === 'today') renderLogs();
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
    // Only refresh logs if Today tab is active
    const todayTab = document.querySelector('.tab[data-tab="today"]') as HTMLButtonElement;
    const todayContent = document.getElementById('tab-today');
    if (todayTab?.classList.contains('active') && todayContent?.classList.contains('active')) {
      renderLogs(localToday);
    }
  });

  setupTabs();

  // --- Make Dashboard tab active by default ---
  const tabs = Array.from(document.querySelectorAll('.tab')) as HTMLButtonElement[];
  const tabContents = Array.from(document.querySelectorAll('.tab-content')) as HTMLDivElement[];
  tabs.forEach(t => t.classList.remove('active'));
  tabContents.forEach(tc => {
    tc.classList.remove('active');
    tc.style.display = 'none';
  });

  const dashboardTab = document.querySelector('.tab[data-tab="dashboard"]') as HTMLButtonElement;
  const dashboardContent = document.getElementById('tab-dashboard');
  if (dashboardTab && dashboardContent) {
    dashboardTab.classList.add('active');
    dashboardContent.classList.add('active');
    dashboardContent.style.display = '';
    renderDashboard();
  }
}

let isRecording = false;
let isPaused = false;

function setupRecordAndPauseBtns() {
  const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement;
  const recordIcon = document.getElementById('recordIcon') as HTMLImageElement;
  const pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement;
  const pauseIcon = document.getElementById('pauseIcon') as HTMLImageElement;

  if (!recordBtn || !recordIcon || !pauseBtn || !pauseIcon) return;

  recordBtn.addEventListener('click', async () => {
    if (!isRecording) {
      isRecording = true;
      isPaused = false;
      pauseBtn.style.display = '';
      updatePauseBtn(pauseBtn, pauseIcon, isPaused);
      await ipcRenderer.invoke('start-tracking');
    } else {
      isRecording = false;
      isPaused = false;
      pauseBtn.style.display = 'none';
      await ipcRenderer.invoke('stop-tracking');
    }
    updateRecordBtn(recordBtn, recordIcon, isRecording);
  });

  pauseBtn.addEventListener('click', async () => {
    if (!isPaused) {
      isPaused = true;
      await ipcRenderer.invoke('pause-tracking');
    } else {
      isPaused = false;
      await ipcRenderer.invoke('resume-tracking');
    }
    updatePauseBtn(pauseBtn, pauseIcon, isPaused);
  });

  updateRecordBtn(recordBtn, recordIcon, isRecording);
  updatePauseBtn(pauseBtn, pauseIcon, isPaused);
  pauseBtn.style.display = 'none';
}

function setupHotkeys() {
  document.addEventListener('keydown', (e) => {
    // Ignore if typing in an input or textarea
    if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

    // Ctrl+R: Start/Stop recording
    if (e.ctrlKey && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement;
      if (recordBtn) recordBtn.click();
    }

    // Ctrl+1: Today tab
    if (e.ctrlKey && e.key === '1') {
      e.preventDefault();
      document.querySelector('.tab[data-tab="today"]')?.dispatchEvent(new Event('click'));
    }
    // Ctrl+2: Summary tab
    if (e.ctrlKey && e.key === '2') {
      e.preventDefault();
      document.querySelector('.tab[data-tab="summary"]')?.dispatchEvent(new Event('click'));
    }
    // Ctrl+3: Profile tab
    if (e.ctrlKey && e.key === '3') {
      e.preventDefault();
      document.querySelector('.tab[data-tab="profile"]')?.dispatchEvent(new Event('click'));
    }
    // Ctrl+P: Pause/Resume
    if (e.ctrlKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      const pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement;
      if (pauseBtn && pauseBtn.style.display !== 'none') pauseBtn.click();
    }
  });
}

ipcRenderer.on('get-session-info', () => {
  showModal({
    title: 'Session Info',
    fields: [
      { name: 'title', label: 'Title:', type: 'text', required: true },
      { name: 'description', label: 'Description (optional):', type: 'textarea' }
    ],
    submitText: 'Save',
    cancelText: 'Discard',
    onSubmit: (values) => {
      ipcRenderer.send('session-info-reply', {
        title: values.title || 'Coding Session',
        description: values.description
      });
    },
    onCancel: () => {
      if (confirm('Session will be discarded. Are you sure?')) {
        ipcRenderer.send('session-info-reply', { title: '', description: '' });
      }
    }
  });
});

ipcRenderer.on('notify', (_event, data) => {
  if (data && data.message) showNotification(data.message);
});

ipcRenderer.on('auto-paused', () => {
  isPaused = true;
  const pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement;
  const pauseIcon = document.getElementById('pauseIcon') as HTMLImageElement;
  if (pauseBtn && pauseIcon) {
    updatePauseBtn(pauseBtn, pauseIcon, isPaused);
  }
});

ipcRenderer.on('auto-resumed', () => {
  isPaused = false;
  const pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement;
  const pauseIcon = document.getElementById('pauseIcon') as HTMLImageElement;
  if (pauseBtn && pauseIcon) {
    updatePauseBtn(pauseBtn, pauseIcon, isPaused);
  }
});

export async function applyAccentColor() {
  const theme = document.body.classList.contains('light') ? 'light' : 'dark';
  const accentColor = await ipcRenderer.invoke('get-accent-color', theme);

  if (theme === 'light') {
    document.body.style.setProperty('--accent', accentColor);
    // Remove from dark theme root so it falls back to config when switching
    document.documentElement.style.removeProperty('--accent');
  } else {
    document.documentElement.style.setProperty('--accent', accentColor);
    // Remove from light theme body so it falls back to config when switching
    document.body.style.removeProperty('--accent');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initUI();
  applyAccentColor();
  setupRecordAndPauseBtns();
  setupHotkeys();
});