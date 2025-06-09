/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ipcRenderer } from 'electron';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function escapeHtml(text: string) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function renderEditorUsage(container: HTMLElement) {
  const usage = await ipcRenderer.invoke('get-editor-usage');
  if (!usage || usage.length === 0) {
    container.innerHTML = '<p>No data available.</p>';
    return;
  }
  const config = await ipcRenderer.invoke('get-editor-colors');
  const defaultColors = ['#4f8cff', '#ffb347', '#7ed957', '#ff6961', '#b19cd9'];
  const colorMap: { [key: string]: string } = {};
  usage.forEach((row: any, i: number) => {
    colorMap[row.app] = config[row.app] || defaultColors[i % defaultColors.length];
  });
  usage.sort((a: any, b: any) => b.total_time - a.total_time);
  const total = usage.reduce((sum: number, row: any) => sum + row.total_time, 0);
  container.innerHTML = `
    <h2>Editor Usage Breakdown</h2>
    <div style="display: flex; height: 32px; border-radius: 8px; overflow: hidden; border: 1px solid #ccc; margin-bottom: 12px;">
      ${usage.map((row: any) => {
        const percent = ((row.total_time / total) * 100).toFixed(1);
        const color = colorMap[row.app];
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
    <h3>Customize Colors</h3>
    ${usage.map((row: any) => {
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
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const app = target.dataset.app!;
      const color = target.value;
      ipcRenderer.invoke('set-editor-color', app, color);
      refreshProfile();
    });
  });
}

async function renderLanguageUsage(container: HTMLElement) {
  const usage = await ipcRenderer.invoke('get-language-usage');
  if (!usage || usage.length === 0) {
    container.innerHTML = '<p>No data available.</p>';
    return;
  }
  usage.sort((a: any, b: any) => b.total_time - a.total_time);
  const total = usage.reduce((sum: number, row: any) => sum + row.total_time, 0);
  const defaultColors = ['#4f8cff', '#ffb347', '#7ed957', '#ff6961', '#b19cd9', '#f67280', '#355c7d'];
  container.innerHTML = `
    <h2>Language Usage Breakdown</h2>
    <div style="display: flex; height: 32px; border-radius: 8px; overflow: hidden; border: 1px solid #ccc; margin-bottom: 12px;">
      ${usage.map((row: any, i: number) => {
        const percent = ((row.total_time / total) * 100).toFixed(1);
        const color = defaultColors[i % defaultColors.length];
        return `<div title="${row.language}: ${percent}%" style="width:${percent}%;background:${color};display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;">
          ${parseFloat(percent) > 10 ? row.language : ''}
        </div>`;
      }).join('')}
    </div>
    <ul>
      ${usage.map((row: any) => {
        const percent = ((row.total_time / total) * 100).toFixed(1);
        return `<li><b>${row.language}</b>: ${percent}%</li>`;
      }).join('')}
    </ul>
  `;
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
      showChapter((btn as HTMLButtonElement).dataset.chapter!);
    });
  });
}