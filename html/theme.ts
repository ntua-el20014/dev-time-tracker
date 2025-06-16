import themeLight from '../data/toggle_light.png';
import themeDark from '../data/toggle_dark.png';
import startBtn from '../data/start-button.png';
import stopBtn from '../data/stop-button.png';
import pauseIconImg from '../data/pause-button.png';
import playIconImg from '../data/play-button.png';
import { applyAccentColor } from './renderer';
import { getCurrentUserId } from './utils';
import { ipcRenderer } from 'electron';

// --- User Theme Preference Helpers ---

export async function initTheme() {
  const toggleBtn = document.getElementById('toggleTheme');
  const themeIcon = document.getElementById('themeIcon') as HTMLImageElement;
  const userId = getCurrentUserId();

  if (toggleBtn && themeIcon) {
    toggleBtn.addEventListener('click', async () => {
      const isLight = !document.body.classList.contains('light');
      document.body.classList.toggle('light', isLight);
      await ipcRenderer.invoke('set-user-theme', isLight ? 'light' : 'dark', userId);
      updateThemeIcon(themeIcon);
      await applyAccentColor();
      window.dispatchEvent(new Event('theme-changed'));
    });

    // Load theme from config
    const savedTheme = await ipcRenderer.invoke('get-user-theme', userId) as 'light' | 'dark';
    if (savedTheme === 'light') {
      document.body.classList.add('light');
    } else {
      document.body.classList.remove('light');
    }
    updateThemeIcon(themeIcon);
    applyAccentColor();
  }
}

export async function setUserTheme(theme: 'light' | 'dark') {
  const userId = getCurrentUserId();
  await ipcRenderer.invoke('set-user-theme', theme, userId);
}

export function updateThemeIcon(themeIcon: HTMLImageElement) {
  if (!themeIcon) return;
  if (document.body.classList.contains('light')) {
    themeIcon.src = themeDark;
  } else {
    themeIcon.src = themeLight;
  }
}

// --- Record Button Logic ---

export function updateRecordIcon(recordIcon: HTMLImageElement, isRecording: boolean) {
  if (!recordIcon) return;
  if (isRecording) {
    recordIcon.src = stopBtn;
    recordIcon.alt = 'Stop Recording';
  } else {
    recordIcon.src = startBtn;
    recordIcon.alt = 'Start Recording';
  }
}

export function updateRecordBtn(recordBtn: HTMLButtonElement, recordIcon: HTMLImageElement, isRecording: boolean) {
  if (!recordBtn || !recordIcon) return;
  updateRecordIcon(recordIcon, isRecording);
  recordBtn.title = isRecording ? 'Finish Recording' : 'Start Recording';
  recordBtn.style.background = isRecording ? 'crimson' : 'var(--accent)';
  recordBtn.style.color = isRecording ? '#fff' : '#222';
}

// --- Pause Button Logic ---

export function updatePauseIcon(pauseIcon: HTMLImageElement, isPaused: boolean) {
  if (!pauseIcon) return;
  if (isPaused) {
    pauseIcon.src = playIconImg;
    pauseIcon.alt = 'Resume';
    pauseIcon.classList.add('paused');
  } else {
    pauseIcon.src = pauseIconImg;
    pauseIcon.alt = 'Pause';
  }
}

export function updatePauseBtn(pauseBtn: HTMLButtonElement, pauseIcon: HTMLImageElement, isPaused: boolean) {
  if (!pauseBtn || !pauseIcon) return;
  updatePauseIcon(pauseIcon, isPaused);
  pauseBtn.title = isPaused ? 'Resume Session' : 'Pause Session';
  pauseBtn.classList.toggle('paused', isPaused);
}

/**
 * Returns the image path for a given hotkey name.
 * Example: loadHotkey('ctrl') => require('../data/ctrl-key.png')
 */
export function loadHotkey(key: string): string {
  // You can add more mappings if you use special names
  return require(`../data/${key}.png`);
}