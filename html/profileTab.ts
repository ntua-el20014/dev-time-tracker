/* eslint-disable @typescript-eslint/no-explicit-any */
import { ipcRenderer } from 'electron';
import { applyAccentColor } from './renderer';
import { renderPercentBar, renderPieChartJS } from './components';
import { loadHotkey, setUserTheme } from './theme';
import { getCurrentUserId } from './utils';
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
    <ul style="list-style:none;padding:0;margin:0;">
      ${usage.map((row: EditorUsageRow) => {
        const percent = ((row.total_time / total) * 100).toFixed(1);
        const color = colorMap[row.app];
        return `<li style="margin-bottom:4px;">
          <b style="color:${color};">${row.app}</b>: ${percent}%
        </li>`;
      }).join('')}
    </ul>
    <h3>Customize Colors</h3>
    ${usage.map((row: EditorUsageRow) => {
      const color = colorMap[row.app];
      return `
        <div style="margin-bottom: 10px; display: flex; align-items: center; gap: 12px;">
          <label style="min-width: 80px;">${row.app}</label>
          <div class="color-picker-wrapper" data-app="${row.app}" style="
            width: 32px;
            height: 32px;
            border-radius: 50%;
            border: 2px solid #aaa;
            background-color: ${color};
            cursor: pointer;
            position: relative;
          ">
            <input type="color" value="${color}" data-app="${row.app}" style="
              opacity: 0;
              width: 100%;
              height: 100%;
              position: absolute;
              top: 0;
              left: 0;
              cursor: pointer;
            " />
          </div>
        </div>
      `;
    }).join('')}
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

  // Prepare container for Chart.js pie chart
  container.innerHTML = `
    <h2>Language Usage Breakdown</h2>
    <div id="languagePieChart" style="width:180px;height:180px;margin-bottom:16px;"></div>
    <ul style="list-style:none;padding:0;margin:0;">
      ${usage.map((row: LanguageUsageRow, i: number) => {
        const percent = ((row.total_time / total) * 100).toFixed(1);
        const color = defaultColors[i % defaultColors.length];
        return `<li style="margin-bottom:4px;">
          <b style="color:${color};">${row.language}</b>: ${percent}%
        </li>`;
      }).join('')}
    </ul>
    <div style="margin-top:24px;padding:14px 18px;background:var(--row-odd);border-radius:10px;">
      <b>How to map unknown file extensions to languages:</b><br>
      Edit the file <code>lang.json</code> in your app data folder:<br>
      <code style="user-select:all;">%APPDATA%/dev-time-tracker/lang.json</code>
      <button id="openLangJsonBtn" style="margin-left:12px;padding:4px 12px;border-radius:6px;border:none;background:var(--accent);color:#222;cursor:pointer;">
        Open lang.json
      </button>
      <br>
      Example content:
      <pre style="background:var(--row-hover);padding:8px 12px;border-radius:6px;margin:8px 0 0 0;">
{
  ".foo": "My Custom Language",
  ".bar": "AnotherLang"
}
      </pre>
      <span style="font-size:0.97em;color:#888;">
        After saving, your changes will be applied automatically.
      </span>
    </div>
  `;

  // Render the Chart.js pie chart
  renderPieChartJS('languagePieChart', items, 180);

  // Remove previous listener to avoid duplicates
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
    <div style="margin-bottom:24px;">
      <label for="idleTimeoutRange" style="font-weight:bold;">Idle Timeout:</label>
      <input type="range" id="idleTimeoutRange" min="60" max="300" step="30" value="${idleTimeout}" style="vertical-align:middle; accent-color: var(--accent);">
      <span id="idleTimeoutValue" style="margin-left:8px;">${(idleTimeout/60).toFixed(1)} min</span>
    </div>
    
    <div style="margin-bottom:24px;">
      <label style="font-weight:bold;">Theme:</label>
      <button id="themeToggleBtn" style="margin-left:12px; padding:6px 12px; border:none; border-radius:6px; background:var(--accent); color:#222; cursor:pointer;">
        Switch to ${currentTheme === 'dark' ? 'Light' : 'Dark'} Mode
      </button>
    </div>
  `;

  // --- Tag management ---
  const tags: Tag[] = await ipcRenderer.invoke('get-all-tags', getCurrentUserId());
  container.innerHTML += `
    <h2 style="margin-top:32px;">Manage Tags</h2>
    ${
      tags.length === 0
        ? `<p>No tags added yet.</p>`
        : `<ul id="tag-list-settings" style="list-style:none;padding:0;">
            ${tags.map(tag => `
              <li style="margin-bottom:8px;display:flex;align-items:center;gap:12px;">
                <span style="background:var(--accent);color:#222;padding:2px 12px;border-radius:12px;">${escapeHtml(tag.name)}</span>
                <button class="delete-tag-btn" data-tag="${escapeHtml(tag.name)}" style="background:#d32f2f;color:#fff;border:none;border-radius:6px;padding:2px 10px;cursor:pointer;">Delete</button>
              </li>
            `).join('')}
          </ul>`
    }
  `;

  // --- Accent color management ---
  const theme: 'dark' | 'light' = document.body.classList.contains('light') ? 'light' : 'dark';
  const accentColor: string = await ipcRenderer.invoke('get-accent-color', theme, getCurrentUserId());

  container.innerHTML += `
    <h2 style="margin-top:32px;">Accent Color</h2>
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">
      <div style="width:32px;height:32px;border-radius:50%;border:2px solid #aaa;background:${accentColor};position:relative;">
        <input type="color" id="accentColorInput" value="${accentColor}" style="
          opacity: 0;
          width: 100%;
          height: 100%;
          position: absolute;
          top: 0;
          left: 0;
          cursor: pointer;
        " />
      </div>
      <button id="saveAccentColorBtn" style="padding:6px 12px;border:none;border-radius:6px;background:var(--accent);color:#222;cursor:pointer;">Save</button>
    </div>
    <div style="margin-bottom:24px;">
      <button id="resetAccentColorsBtn" style="padding:6px 18px;border:none;border-radius:6px;background:#eee;color:#222;cursor:pointer;">Reset Defaults</button>
    </div>
  `;
  const range = container.querySelector('#idleTimeoutRange') as HTMLInputElement;
  const valueSpan = container.querySelector('#idleTimeoutValue') as HTMLSpanElement;

  const accentInput = container.querySelector('#accentColorInput') as HTMLInputElement;
  const saveAccentBtn = container.querySelector('#saveAccentColorBtn') as HTMLButtonElement;
  const resetAccentBtn = container.querySelector('#resetAccentColorsBtn') as HTMLButtonElement;

  // Attach all event listeners

  // Add theme toggle handler
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

   // Attach delete handlers
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
}
  
export async function refreshProfile() {
  const profileDiv = document.getElementById('profileContent');
  if (!profileDiv) return;

  // Layout: sidebar + content
  profileDiv.innerHTML = `
  <div style="display: flex; min-height: 400px;">
    <nav id="profileSidebar" style="min-width:180px;max-width:180px;padding:24px 0 0 0;">
      <ul style="list-style:none;padding:0;margin:0;">
        <li><button class="profile-chapter-btn" data-chapter="editor" style="width:100%;padding:12px 0;border:none;font-size:1em;cursor:pointer;">Editors</button></li>
        <li><button class="profile-chapter-btn" data-chapter="language" style="width:100%;padding:12px 0;border:none;font-size:1em;cursor:pointer;">Languages</button></li>
        <li><button class="profile-chapter-btn" data-chapter="settings" style="width:100%;padding:12px 0;border:none;font-size:1em;cursor:pointer;">Settings</button></li>
        <li><button class="profile-chapter-btn" data-chapter="hotkeys" style="width:100%;padding:12px 0;border:none;font-size:1em;cursor:pointer;">Hotkeys</button></li>
      </ul>
    </nav>
    <div id="profileChapterContent" style="flex:1;padding:0 0 0 32px;"></div>
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

  // Logout button
  const logoutBtn = document.createElement('button');
  logoutBtn.id = 'logoutBtn';
  logoutBtn.textContent = 'Log Out';
  logoutBtn.style.cssText = `
    display: block;
    margin: 0 auto 24px auto;
    padding: 10px 32px;
    background: linear-gradient(90deg, #ff5858 0%, #f09819 100%);
    color: #fff;
    border: none;
    border-radius: 24px;
    font-size: 1.1em;
    font-weight: bold;
    cursor: pointer;
    box-shadow: 0 2px 8px #0002;
    transition: background 0.2s, box-shadow 0.2s;
  `;
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

  profileDiv.insertBefore(logoutBtn, profileDiv.firstChild);
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
      <li>${keyImg('ctrl')} + ${keyImg('r')}   Start/Stop recording</li>
      <li>${keyImg('ctrl')} + ${keyImg('p')}   Pause/Resume recording</li>
      <li>${keyImg('ctrl')} + ${keyImg('hashtag')}   Switch Tabs [# = 1, 2, 3, 4]</li>
    </ul>
    <p style="margin-top:16px;color:#888;font-size:0.98em;">
      <i>Shortcuts work globally except when typing in an input or textarea.</i>
    </p>
  `;
}