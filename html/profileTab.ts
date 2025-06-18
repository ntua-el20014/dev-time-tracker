/* eslint-disable @typescript-eslint/no-explicit-any */
import { ipcRenderer } from 'electron';
import { applyAccentColor } from './renderer';
import { renderPercentBar, renderPieChartJS, showColorGridPicker } from './components';
import { loadHotkey, setUserTheme } from './theme';
import { getCurrentUserId, prettyDate} from './utils';
import type { Tag } from '../src/logger';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function escapeHtml(text: string) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function renderEditorUsage(container: HTMLElement) {
  type EditorUsageRow = { app: string; total_time: number };
  const usage: EditorUsageRow[] = await ipcRenderer.invoke('get-editor-usage', getCurrentUserId());
  if (!usage || usage.length === 0) {
    container.innerHTML = '<p>No data available.</p>';
    return;
  }
  const config = await ipcRenderer.invoke('get-editor-colors');
  const defaultColors = ['#4f8cff', '#ffb347', '#7ed957', '#ff6961', '#b19cd9'];
  const colorMap: { [key: string]: string } = {};
  usage.forEach((row: EditorUsageRow, i: number) => {
    colorMap[row.app] = config[row.app] || defaultColors[i % defaultColors.length];
  });
  usage.sort((a: EditorUsageRow, b: EditorUsageRow) => b.total_time - a.total_time);
  const total = usage.reduce((sum: number, row: EditorUsageRow) => sum + row.total_time, 0);
  const items = usage.map((row: EditorUsageRow) => ({
    label: row.app,
    percent: (row.total_time / total) * 100,
    color: colorMap[row.app]
  }));
  container.innerHTML = `
    <h2>Editor Usage Breakdown</h2>
    ${renderPercentBar(items)}
    <ul class="editor-usage-list">
      ${usage.map((row: EditorUsageRow) => {
        const percent = ((row.total_time / total) * 100).toFixed(1);
        const color = colorMap[row.app];
        return `<li class="editor-usage-item">
          <span class="editor-usage-app" style="color:${color};">${row.app}</span>
          <span class="editor-usage-percent">${percent}%</span>
          <div class="color-picker-wrapper" data-app="${row.app}" style="background-color: ${color};">
            <input type="color" value="${color}" data-app="${row.app}" class="editor-color-input" />
          </div>
        </li>`;
      }).join('')}
    </ul>
    <div class="info-note">
      Pick your color for each editor and press <b>Enter</b>.
    </div>
  `;

  container.querySelectorAll('input[type="color"]').forEach(input => {
    input.addEventListener('change', (e: Event) => {
      const target = e.target as HTMLInputElement;
      const app = target.dataset.app;
      const color = target.value;
      ipcRenderer.invoke('set-editor-color', app, color);
      refreshProfile();
    });
  });
}

async function renderLanguageUsage(container: HTMLElement) {
  type LanguageUsageRow = { language: string; total_time: number };
  const usage: LanguageUsageRow[] = await ipcRenderer.invoke('get-language-usage', getCurrentUserId());
  if (!usage || usage.length === 0) {
    container.innerHTML = '<p>No data available.</p>';
    return;
  }
  usage.sort((a: LanguageUsageRow, b: LanguageUsageRow) => b.total_time - a.total_time);
  const total = usage.reduce((sum: number, row: LanguageUsageRow) => sum + row.total_time, 0);
  const defaultColors = ['#4f8cff', '#ffb347', '#7ed957', '#ff6961', '#b19cd9', '#f67280', '#355c7d'];
  const items = usage.map((row: LanguageUsageRow, i: number) => ({
    label: row.language,
    percent: (row.total_time / total) * 100,
    color: defaultColors[i % defaultColors.length]
  }));

  container.innerHTML = `
  <h2>Language Usage Breakdown</h2>
  <div class="language-usage-flex">
    <div>
      <div id="languagePieChart" class="language-pie-chart"></div>
    </div>
  </div>
  <div class="language-pie-info">
    <b>How to map unknown file extensions to languages:</b><br>
    Edit the file <code>lang.json</code> in your app data folder:<br>
    <div class="centered-btn">
      <button id="openLangJsonBtn" class="open-lang-json-btn">
        Open lang.json
      </button>
    </div>
    Example content:
    <pre>
{
  ".foo": "My Custom Language",
  ".bar": "AnotherLang"
}</pre>
    <div class="info-note">
      After saving, your changes will be applied automatically.
    </div>
  </div>
  `;

  renderPieChartJS('languagePieChart', items, 420);

  window.removeEventListener('theme-changed', rerenderPieChartOnThemeChange);

  function rerenderPieChartOnThemeChange() {
    renderPieChartJS('languagePieChart', items, 180);
  }
  window.addEventListener('theme-changed', rerenderPieChartOnThemeChange);

  const openBtn = container.querySelector('#openLangJsonBtn');
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      ipcRenderer.invoke('open-lang-json', getCurrentUserId());
    });
  }
}

async function renderSettings(container: HTMLElement) {
  let idleTimeout = await ipcRenderer.invoke('get-idle-timeout');
  if (!idleTimeout || typeof idleTimeout !== 'number') idleTimeout = 60;

  // Get current theme
  const currentTheme = document.body.classList.contains('light') ? 'light' : 'dark';
  
  container.innerHTML = `
    <h2>Settings</h2>
    <div class="settings-row">
      <label for="idleTimeoutRange" class="settings-label">Idle Timeout:</label>
      <input type="range" id="idleTimeoutRange" min="60" max="300" step="30" value="${idleTimeout}" class="settings-range">
      <span id="idleTimeoutValue" class="settings-range-value">${(idleTimeout/60).toFixed(1)} min</span>
    </div>
    <div class="settings-row">
      <label class="settings-label">Theme:</label>
      <button id="themeToggleBtn" class="theme-toggle-btn">
        Switch to ${currentTheme === 'dark' ? 'Light' : 'Dark'} Mode
      </button>
    </div>
  `;

  // --- Tag management ---
  const tags: Tag[] = await ipcRenderer.invoke('get-all-tags', getCurrentUserId());
  container.innerHTML += `
    <h2 class="settings-tags-title">Manage Tags</h2>
    ${
      tags.length === 0
        ? `<p>No tags added yet.</p>`
        : `<ul id="tag-list-settings" class="tag-list-settings">
            ${tags.map(tag => `
              <li class="tag-list-item">
                <span class="tag-label" style="background:${tag.color};">
                  ${escapeHtml(tag.name)}
                  <span class="tag-color-chip" data-tag="${escapeHtml(tag.name)}" style="background:${tag.color};"></span>
                </span>
                <button class="delete-tag-btn" data-tag="${escapeHtml(tag.name)}">Delete</button>
              </li>
            `).join('')}
          </ul>`
    }
  `;

  // --- Accent color management ---
  const theme: 'dark' | 'light' = document.body.classList.contains('light') ? 'light' : 'dark';
  const accentColor: string = await ipcRenderer.invoke('get-accent-color', theme, getCurrentUserId());

  container.innerHTML += `
    <div class="accent-color-header">
      <h2 class="accent-color-title">Accent Color</h2>
      <button id="resetAccentColorsBtn" class="reset-accent-btn">Reset</button>
    </div>
    <div class="accent-color-row">
      <div class="accent-color-preview" style="background:${accentColor};">
        <input type="color" id="accentColorInput" value="${accentColor}" class="accent-color-input" />
      </div>
      <button id="saveAccentColorBtn" class="save-accent-btn">Save</button>
    </div>
    <div class="info-note">
      Change the accent color for the current theme and <b>Save</b>.<br>
    </div>
  `;
  const range = container.querySelector('#idleTimeoutRange') as HTMLInputElement;
  const valueSpan = container.querySelector('#idleTimeoutValue') as HTMLSpanElement;

  const accentInput = container.querySelector('#accentColorInput') as HTMLInputElement;
  const saveAccentBtn = container.querySelector('#saveAccentColorBtn') as HTMLButtonElement;
  const resetAccentBtn = container.querySelector('#resetAccentColorsBtn') as HTMLButtonElement;

  // Attach all event listeners

  const themeToggleBtn = container.querySelector('#themeToggleBtn') as HTMLButtonElement;
  themeToggleBtn.addEventListener('click', async () => {
    document.body.classList.toggle('light');
    const newTheme = document.body.classList.contains('light') ? 'light' : 'dark';
    await setUserTheme(newTheme);
    await applyAccentColor();
    window.dispatchEvent(new Event('theme-changed'));
    themeToggleBtn.textContent = `Switch to ${newTheme === 'dark' ? 'Light' : 'Dark'} Mode`;
  });

  if (range && valueSpan) {
    range.addEventListener('input', async () => {
      const seconds = parseInt(range.value, 10);
      valueSpan.textContent = (seconds / 60).toFixed(1) + ' min';
      await ipcRenderer.invoke('set-idle-timeout', seconds);
    });
  } else {
    console.error('Idle timeout slider or value span not found!');
  }

  

  container.querySelectorAll('.delete-tag-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tag = (btn as HTMLButtonElement).dataset.tag;
      if (confirm(`Delete tag "${tag}"? This will remove it from all sessions.`)) {
        await ipcRenderer.invoke('delete-tag', getCurrentUserId(), tag);
        renderSettings(container); // Refresh the list
      }
    });
  });

  accentInput.addEventListener('input', () => {
    accentInput.parentElement.style.background = accentInput.value; // Update preview
  });

  saveAccentBtn.addEventListener('click', async () => {
    const currentTheme: 'dark' | 'light' = document.body.classList.contains('light') ? 'light' : 'dark';
    const colorToSave = accentInput.value;
    const confirmed = confirm(`Apply new accent color ${colorToSave} for ${currentTheme} theme?`);
    if (!confirmed) return;

    await ipcRenderer.invoke('set-accent-color', colorToSave, currentTheme, getCurrentUserId());
    await applyAccentColor();
    window.dispatchEvent(new Event('theme-changed')); // Force UI refresh
    accentInput.value = colorToSave;
  });

  resetAccentBtn.addEventListener('click', async () => {
    if (!confirm('Reset both accent colors to default values?')) return;
    await ipcRenderer.invoke('set-accent-color', '#f0db4f', 'dark', getCurrentUserId());
    await ipcRenderer.invoke('set-accent-color', '#007acc', 'light', getCurrentUserId());
    await applyAccentColor();

    // Always get the current theme at the moment of reset
    const currentTheme: 'dark' | 'light' = document.body.classList.contains('light') ? 'light' : 'dark';
    const newAccent = await ipcRenderer.invoke('get-accent-color', currentTheme, getCurrentUserId());
    accentInput.value = newAccent;
    accentInput.parentElement.style.background = newAccent;
  });

  function updateAccentPickerForTheme() {
    const theme: 'dark' | 'light' = document.body.classList.contains('light') ? 'light' : 'dark';
    ipcRenderer.invoke('get-accent-color', theme, getCurrentUserId()).then((color: string) => {
      accentInput.value = color;
      accentInput.parentElement.style.background = color;
    });
  }

  window.addEventListener('theme-changed', updateAccentPickerForTheme);

    const tagColors = [
    '#f0db4f', '#ff6961', '#7ed957', '#4f8cff', '#ffb347',
    '#b19cd9', '#f67280', '#355c7d', '#ffb6b9', '#c1c8e4',
    '#ffe156', '#6a0572', '#ff6f3c', '#00b8a9', '#f6416c',
    '#43dde6', '#e7e6e1', '#f9f871', '#a28089', '#f7b32b',
    '#2d4059', '#ea5455', '#ffd460', '#40514e', '#11999e'
  ];
  container.querySelectorAll('.tag-color-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      const tagName = (chip as HTMLElement).dataset.tag;
      if (!tagName) {
        console.error('Tag name not found on chip element.');
        return;
      }
      showColorGridPicker({
        colors: tagColors,
        selected: (chip as HTMLElement).style.backgroundColor,
        anchorEl: chip as HTMLElement,
        onSelect: async (color) => {
          await ipcRenderer.invoke('set-tag-color', getCurrentUserId(), tagName, color);
          renderSettings(container); // or rerender tag list
        }
      });
      e.stopPropagation();
    });
  });
}

async function renderDailyGoalHistory(container: HTMLElement) {
  const userId = getCurrentUserId();
  // Fetch all daily goals for the user, newest first
  const goals: {
    date: string;
    time: number;
    description: string;
    isCompleted: number;
  }[] = await ipcRenderer.invoke('get-all-daily-goals', userId);

  container.innerHTML = `
    <h2>Daily Goal History</h2>
    ${
      goals.length === 0
        ? `<p>No daily goals set yet.</p>`
        : `<table class="goal-history-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time (min)</th>
                <th>Description</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${goals
                .map(
                  (g) => `
                <tr>
                  <td>${prettyDate(g.date)}</td>
                  <td>${g.time}</td>
                  <td>${escapeHtml(g.description || '')}</td>
                  <td>
                    ${
                      g.isCompleted
                        ? '<span style="color:green;">Completed</span>'
                        : '<span style="color:#aaa;">Not completed</span>'
                    }
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>`
    }
    <div class="info-note" style="margin-top:12px;">
      Only one daily goal can be set per day. Completed goals are marked in green.
    </div>
  `;
}

export async function refreshProfile() {
  const profileDiv = document.getElementById('profileContent');
  if (!profileDiv) return;

  profileDiv.innerHTML = `
  <div class="profile-main-flex">
    <nav id="profileSidebar" class="profile-sidebar">
      <ul class="profile-chapter-list">
        <li><button class="profile-chapter-btn" data-chapter="editor">Editors</button></li>
        <li><button class="profile-chapter-btn" data-chapter="language">Languages</button></li>
        <li><button class="profile-chapter-btn" data-chapter="goals">Daily Goals</button></li>
        <li><button class="profile-chapter-btn" data-chapter="settings">Settings</button></li>
        <li><button class="profile-chapter-btn" data-chapter="hotkeys">Hotkeys</button></li>
      </ul>
      <button id="logoutBtn" class="logout-btn">Log Out</button>
    </nav>
    <div id="profileChapterContent" class="profile-chapter-content"></div>
  </div>
  `;

  const contentDiv = profileDiv.querySelector('#profileChapterContent') as HTMLElement;
  const buttons = profileDiv.querySelectorAll('.profile-chapter-btn');

  async function showChapter(chapter: string) {
    if (chapter === 'editor') {
      await renderEditorUsage(contentDiv);
    } else if (chapter === 'language') {
      await renderLanguageUsage(contentDiv);
    } else if (chapter === 'settings') {
      await renderSettings(contentDiv);
    } else if (chapter === 'hotkeys') {
      await renderHotkeys(contentDiv);
    } else if (chapter === 'goals') {
      await renderDailyGoalHistory(contentDiv);
    }
    // Highlight active
    buttons.forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLButtonElement).dataset.chapter === chapter);
    });
  }

  // Default to editor usage
  showChapter('editor');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      showChapter((btn as HTMLButtonElement).dataset.chapter);
    });
  });

  // Logout button logic
  const logoutBtn = profileDiv.querySelector('#logoutBtn') as HTMLButtonElement;
  logoutBtn.onmouseenter = () => {
    logoutBtn.style.background = 'linear-gradient(90deg, #f09819 0%, #ff5858 100%)';
    logoutBtn.style.boxShadow = '0 4px 16px #0003';
  };
  logoutBtn.onmouseleave = () => {
    logoutBtn.style.background = 'linear-gradient(90deg, #ff5858 0%, #f09819 100%)';
    logoutBtn.style.boxShadow = '0 2px 8px #0002';
  };
  logoutBtn.onclick = () => {
    localStorage.removeItem('currentUserId');
    document.body.classList.remove('light');
    document.documentElement.style.setProperty('--accent', '#f0db4f');
    document.body.style.setProperty('--accent', '#f0db4f');
    (window as any).isRecording = false;
    (window as any).isPaused = false;
    const landing = document.getElementById('userLanding');
    const mainUI = document.getElementById('mainUI');
    if (mainUI) mainUI.style.display = 'none';
    if (landing) {
      landing.style.display = '';
      const summaryDiv = document.getElementById('summaryContent');
      if (summaryDiv) summaryDiv.innerHTML = '';
      // Reset summaryTab state
      if (window) {
        (window as any).__resetSummaryTabState = true;
      }
      import('./userLanding').then(mod => {
        mod.renderUserLanding(landing, (userId: number) => {
          (window as any).showMainUIForUser(userId);
        });
      });
    }
  };
}


function renderHotkeys(container: HTMLElement) {

  function keyImg(key: string) {
    const isLight = document.body.classList.contains('light');
    const suffix = isLight ? '' : '-w';
    try {
      return `<img src="${loadHotkey(key + '-key' + suffix)}" alt="${key}" style="height:1.5em;vertical-align:middle;margin:0 2px;">`;
    } catch {
      return `<img src="${loadHotkey(key + '-key')}" alt="${key}" style="height:1.5em;vertical-align:middle;margin:0 2px;">`;
    }
  }

  container.innerHTML = `
    <h2>Keyboard Shortcuts</h2>
    <ul style="list-style:none;padding:0;margin:0;line-height:2;">
      <li><span style="min-width:100px;display:inline-block;">${keyImg('ctrl')} + ${keyImg('r')}</span> Start/Stop recording</li>
      <li><span style="min-width:100px;display:inline-block;">${keyImg('ctrl')} + ${keyImg('p')}</span> Pause/Resume recording</li>
      <li><span style="min-width:100px;display:inline-block;">${keyImg('ctrl')} + ${keyImg('hashtag')}</span> Switch Tabs [# = 1, 2, 3, 4]</li>
    </ul>
    <div class="info-note" style="margin-top:16px;">
      Shortcuts work globally except when typing in an input or textarea.
    </div>
  `;
}