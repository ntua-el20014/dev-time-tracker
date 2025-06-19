/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ipcRenderer } from 'electron';
import { formatTimeSpent } from '../src/utils/timeFormat';
import edit from '../data/edit.png';
import { escapeHtml, getLocalDateString, getWeekDates, getMonday, filterDailyDataForWeek, getCurrentUserId, prettyDate } from './utils';
import { showModal } from './components';
import type { DailySummaryRow, SessionRow, Tag } from '../src/backend/types';

// Store the current week start date (Monday)
let currentWeekMonday = getMonday(new Date());
// Store all daily data for all dates (for client-side week switching, for the chart only)
let allDailyData: DailySummaryRow[] = [];

// Store filtered data for each view
let filteredByDateData: DailySummaryRow[] = [];
let filteredSessions: SessionRow[] = [];

// render timeline
function renderTimelineChart(dailyData: DailySummaryRow[], weekMonday: Date) {
  const timelineContainer = document.createElement('div');
  timelineContainer.className = 'timeline-container';

  // Group data by date and calculate total time per day (in seconds)
  const timeByDate: Record<string, number> = {};
  dailyData.forEach((row: DailySummaryRow) => {
    const date = row.date;
    timeByDate[date] = (timeByDate[date] || 0) + row.total_time;
  });

  // Get week dates (Monday to Sunday)
  const weekDays = getWeekDates(weekMonday);
  const todayDateStr = getLocalDateString(new Date());

  // Find maximum time for scaling (in seconds)
  const weekDateStrs = weekDays.map(d => getLocalDateString(d));
  const maxSeconds = Math.max(
    1,
    ...weekDateStrs.map(dateStr => timeByDate[dateStr] || 0)
  );
  const maxBarHeight = 70;

  // Create chart HTML
  timelineContainer.innerHTML = `
    <div class="timeline-header" style="display: flex; align-items: center; justify-content: space-between;">
      <button id="week-prev-btn" style="font-size:1.5em; background:none; border:none; cursor:pointer;">&#8592;</button>
      <h3 style="flex:1; text-align:center; margin:0;">
        ${prettyDate(weekDays[0])} - 
        ${prettyDate(weekDays[6])}
      </h3>
      ${
        // Hide right arrow if at current week
        (() => {
          const todayMonday = getMonday(new Date());
          if (weekMonday >= todayMonday) {
            return `<span style="display:inline-block;width:2.5em;"></span>`;
          }
          return `<button id="week-next-btn" style="font-size:1.5em; background:none; border:none; cursor:pointer;">&#8594;</button>`;
        })()
      }
    </div>
    <div class="timeline-chart">
      ${weekDays.map(day => {
        const dateStr = getLocalDateString(day);
        const dayName = day.toLocaleDateString('en-US', { weekday: 'short' });
        const seconds = timeByDate[dateStr] || 0;
        const height = seconds > 0 ? (seconds / maxSeconds * maxBarHeight) : 0;
        const isToday = dateStr === todayDateStr;
        const timeText = seconds > 0 ? formatTimeSpent(seconds) : '';
        return `
          <div class="timeline-day ${isToday ? 'today' : ''}">
            <div class="timeline-bar-container">
              ${seconds > 0 ? `
                <div class="timeline-bar" style="height: ${height}px"></div>
                <div class="timeline-hours">${timeText}</div>
              ` : `
                <div class="timeline-bar" style="height: 0; visibility: hidden;"></div>
                <div class="timeline-hours"></div>
              `}
            </div>
            <div class="timeline-day-label">${dayName}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  return timelineContainer;
}

// Utility to create a filter bar for a view
function createFilterBar(options: {
  filters: { [key: string]: { type: 'select' | 'date', label: string, options?: string[] } },
  onApply: (filterValues: Record<string, string>) => void,
  onClear: () => void
}) {
  const filterBar = document.createElement('div');
  filterBar.className = 'summary-filter-bar';

  // Build filter controls
  filterBar.innerHTML = Object.entries(options.filters).map(([key, filter]) => {
    if (filter.type === 'select') {
      return `<label>${filter.label}: <select id="filter-${key}"><option value="">All</option>${(filter.options || []).map(opt => `<option value="${opt}">${opt}</option>`).join('')}</select></label>`;
    }
    if (filter.type === 'date') {
      return `<label>${filter.label}: <input type="date" id="filter-${key}"></label>`;
    }
    return '';
  }).join(' ') + `
    <button id="filter-apply" class="filter-btn apply">Apply</button>
    <button id="filter-clear" class="filter-btn clear" type="button">Clear</button>
  `;

  // Attach handlers
  setTimeout(() => {
    const applyBtn = filterBar.querySelector('#filter-apply') as HTMLButtonElement;
    const clearBtn = filterBar.querySelector('#filter-clear') as HTMLButtonElement;
    if (applyBtn) {
      applyBtn.onclick = () => {
        const filterValues: Record<string, string> = {};
        Object.keys(options.filters).forEach(key => {
          const el = filterBar.querySelector(`#filter-${key}`) as HTMLInputElement | HTMLSelectElement;
          filterValues[key] = el?.value || '';
        });
        options.onApply(filterValues);
      };
    }
    if (clearBtn) {
      clearBtn.onclick = () => {
        Object.keys(options.filters).forEach(key => {
          const el = filterBar.querySelector(`#filter-${key}`) as HTMLInputElement | HTMLSelectElement;
          if (el) el.value = '';
        });
        options.onClear();
      };
    }
  }, 0);

  return filterBar;
}

export async function renderSummary() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).__resetSummaryTabState) {
    currentWeekMonday = getMonday(new Date());
    allDailyData = [];
    filteredByDateData = [];
    filteredSessions = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).__resetSummaryTabState;
  }
  const summaryDiv = document.getElementById('summaryContent');
  if (!summaryDiv) return;
  summaryDiv.innerHTML = '';

  allDailyData = await ipcRenderer.invoke('get-daily-summary', getCurrentUserId());
  if (!allDailyData || allDailyData.length === 0) {
    summaryDiv.innerHTML = '<p>No summary data available.</p>';
    return;
  }

  // --- Weekly Timeline Chart (always unfiltered) ---
  const weeklySummaryContainer = document.createElement('div');
  weeklySummaryContainer.className = 'weekly-summary';

  function updateWeeklySummary() {
    weeklySummaryContainer.innerHTML = '';
    const weekData = filterDailyDataForWeek(allDailyData, currentWeekMonday);
    weeklySummaryContainer.appendChild(renderTimelineChart(weekData, currentWeekMonday));
    attachWeekNavHandlers();
  }

  // Attach navigation button handlers
  function attachWeekNavHandlers() {
    const prevBtn = weeklySummaryContainer.querySelector('#week-prev-btn') as HTMLButtonElement;
    const nextBtn = weeklySummaryContainer.querySelector('#week-next-btn') as HTMLButtonElement;
    if (prevBtn) {
      prevBtn.onclick = () => {
        // Go to previous week
        currentWeekMonday.setDate(currentWeekMonday.getDate() - 7);
        updateWeeklySummary();
      };
    }
    if (nextBtn) {
      nextBtn.onclick = () => {
        // Go to next week (but not future)
        const nextMonday = new Date(currentWeekMonday);
        nextMonday.setDate(nextMonday.getDate() + 7);
        const todayMonday = getMonday(new Date());
        if (nextMonday <= todayMonday) {
          currentWeekMonday = nextMonday;
          updateWeeklySummary();
        }
      };
    }
  }

  updateWeeklySummary();
  summaryDiv.appendChild(weeklySummaryContainer);

  // --- Filter toggle ---
  const filterContainer = document.createElement('div');
  filterContainer.style.margin = '24px 0 8px 0';
  filterContainer.style.display = 'flex';
  filterContainer.style.gap = '16px';
  filterContainer.style.alignItems = 'center';

  const byDateBtn = document.createElement('button');
  byDateBtn.textContent = 'Summary by Date';
  byDateBtn.className = 'summary-filter-btn active';

  const bySessionBtn = document.createElement('button');
  bySessionBtn.textContent = 'Summary by Session';
  bySessionBtn.className = 'summary-filter-btn';

  filterContainer.appendChild(byDateBtn);
  filterContainer.appendChild(bySessionBtn);
  summaryDiv.appendChild(filterContainer);

  // --- Containers for each summary type ---
  const byDateContainer = document.createElement('div');
  const bySessionContainer = document.createElement('div');
  bySessionContainer.style.display = 'none';

  // --- By Date (usage summary) ---
  async function renderByDateView() {
    byDateContainer.innerHTML = '';

    // Get unique languages and editors from allDailyData for dropdowns
    const uniqueLangs = Array.from(new Set(allDailyData.map(r => r.language).filter(Boolean)));
    const uniqueApps = Array.from(new Set(allDailyData.map(r => r.app).filter(Boolean)));

    // Create filter bar
    const filterBar = createFilterBar({
      filters: {
        'language-bydate': { type: 'select', label: 'Language', options: uniqueLangs },
        'app-bydate': { type: 'select', label: 'Editor', options: uniqueApps },
        'start-bydate': { type: 'date', label: 'Start' },
        'end-bydate': { type: 'date', label: 'End' }
      },
      onApply: async (filterValues) => {
        const filters: Record<string, string> = {};
        if (filterValues['language-bydate']) filters.language = filterValues['language-bydate'];
        if (filterValues['app-bydate']) filters.app = filterValues['app-bydate'];
        if (filterValues['start-bydate']) filters.startDate = filterValues['start-bydate'];
        if (filterValues['end-bydate']) filters.endDate = filterValues['end-bydate'];
        filteredByDateData = await ipcRenderer.invoke('get-daily-summary', getCurrentUserId(), filters);
        renderByDateTable(filteredByDateData);
      },
      onClear: async () => {
        filteredByDateData = await ipcRenderer.invoke('get-daily-summary', getCurrentUserId());
        renderByDateTable(filteredByDateData);
      }
    });
    byDateContainer.appendChild(filterBar);

    const detailsTitle = document.createElement('h1');
    detailsTitle.textContent = 'Summary';
    byDateContainer.appendChild(detailsTitle);

    // Initial data load
    if (!filteredByDateData.length) {
      filteredByDateData = await ipcRenderer.invoke('get-daily-summary', getCurrentUserId());
    }
    renderByDateTable(filteredByDateData);
  }

  // Helper to render just the summary table
  function renderByDateTable(data: DailySummaryRow[]) {
    // Remove old table if exists
    const oldTable = byDateContainer.querySelector('.details-container');
    if (oldTable) oldTable.remove();

    
    // Group filtered data by date for detailed view
    const grouped: { [date: string]: DailySummaryRow[] } = {};
    data.forEach((row: DailySummaryRow) => {
      if (!grouped[row.date]) grouped[row.date] = [];
      grouped[row.date].push(row);
    });

    const detailsContainer = document.createElement('div');
    detailsContainer.className = 'details-container';
    detailsContainer.innerHTML = Object.entries(grouped).map(([date, rows]) => `
      <div class="summary-date-header">
        <h3>${prettyDate(date)}</h3>
      </div>
      <table class="summary-table">
        <thead>
          <tr>
            <th></th>
            <th>Editor</th>
            <th>Time Spent</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row: DailySummaryRow) => {
            return `
              <tr>
                <td><img src="${row.icon}" alt="${escapeHtml(row.app)} icon" class="icon" /></td>
                <td>${escapeHtml(row.app)}</td>
                <td>${escapeHtml(formatTimeSpent(row.total_time))}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `).join('');
    byDateContainer.appendChild(detailsContainer);
  }

  // --- By Session ---
  async function renderBySessionView() {
    bySessionContainer.innerHTML = '';

    // Fetch all tags and sessions for dropdowns
    const allTags: Tag[] = await ipcRenderer.invoke('get-all-tags', getCurrentUserId());
    let sessions: SessionRow[];
    if (filteredSessions.length) {
      sessions = filteredSessions;
    } else {
      sessions = await ipcRenderer.invoke('get-sessions', getCurrentUserId());
      filteredSessions = sessions;
    }

    // Unique tags for dropdown
    const uniqueTags = Array.from(new Set(sessions.flatMap(s => s.tags || [])));

    // Create filter bar
    const filterBar = createFilterBar({
      filters: {
        'tag-session': { type: 'select', label: 'Tag', options: uniqueTags },
        'start-session': { type: 'date', label: 'Start' },
        'end-session': { type: 'date', label: 'End' }
      },
      onApply: async (filterValues) => {
        const filters: Record<string, string> = {};
        if (filterValues['tag-session']) filters.tag = filterValues['tag-session'];
        if (filterValues['start-session']) filters.startDate = filterValues['start-session'];
        if (filterValues['end-session']) filters.endDate = filterValues['end-session'];
        const filtered = await ipcRenderer.invoke('get-sessions', getCurrentUserId(), filters);
        filteredSessions = filtered;
        renderSessionRows(filtered);
      },
      onClear: async () => {
        filteredSessions = await ipcRenderer.invoke('get-sessions', getCurrentUserId());
        renderSessionRows(filteredSessions);
      }
    });
    bySessionContainer.appendChild(filterBar);

    const sessionTitle = document.createElement('h1');
    sessionTitle.textContent = 'Sessions';
    bySessionContainer.appendChild(sessionTitle);

    const sessionTable = document.createElement('table');
    sessionTable.className = 'summary-table';
    sessionTable.innerHTML = `
      <thead>
        <tr>
          <th>Name</th>
          <th>Date</th>
          <th>Duration</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="sessionTableBody"></tbody>
    `;
    bySessionContainer.appendChild(sessionTable);

    // Render filtered sessions
    function renderSessionRows(sessionsToRender: SessionRow[]) {
      const sessionTableBody = sessionTable.querySelector('tbody')!;
      sessionTableBody.innerHTML = sessionsToRender.map((session: SessionRow) => {
        const durationSec = session.duration || 0;
        const h = Math.floor(durationSec / 3600);
        const m = Math.floor((durationSec % 3600) / 60);
        const s = durationSec % 60;
        let durationStr = '';
        if (h > 0) durationStr += `${h}h `;
        if (m > 0) durationStr += `${m}m `;
        if (s > 0 || (!h && !m)) durationStr += `${s}s`;
        return `
          <tr data-session-id="${session.id}">
            <td>
              ${escapeHtml(session.title)}
              ${session.tags && session.tags.length ? `<div style="margin-top:2px;font-size:0.9em;">
                ${session.tags.map((t: string) => {
                  const tagObj = allTags.find(tag => tag.name === t);
                  const color = tagObj?.color || getComputedStyle(document.body).getPropertyValue('--accent') || '#f0db4f';
                  return `<span style="background:${color};color:#222;padding:2px 8px;border-radius:8px;margin-right:4px;">${escapeHtml(t)}</span>`;
                }).join('')}
              </div>` : ''}
            </td>
            <td>${prettyDate(session.date)}</td>
            <td>${durationStr.trim()}</td>
            <td>
              <button class="session-edit-btn" title="Edit session">
                <img src="${edit}" alt="Edit" style="width:16px; height:16px;">
              </button>
            </td>
          </tr>
        `;
      }).join('');

      // Attach edit button listeners
      sessionTableBody.querySelectorAll('.session-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const tr = (btn as HTMLElement).closest('tr');
          const sessionId = tr?.getAttribute('data-session-id');
          const session = sessions.find((s: SessionRow) => String(s.id) === String(sessionId));
          if (session) showEditSessionModal(session, async () => {
            const updatedSessions = await ipcRenderer.invoke('get-sessions', getCurrentUserId());
            filteredSessions = updatedSessions;
            // Reset filter UI fields
            const tagSelect = filterBar.querySelector('#filter-tag-session') as HTMLSelectElement;
            const startInput = filterBar.querySelector('#filter-start-session') as HTMLInputElement;
            const endInput = filterBar.querySelector('#filter-end-session') as HTMLInputElement;
            if (tagSelect) tagSelect.value = '';
            if (startInput) startInput.value = '';
            if (endInput) endInput.value = '';
            renderSessionRows(updatedSessions);
          });
        });
      });
    }

    async function showEditSessionModal(session: SessionRow, onChange: () => void) {
      // Fetch all tags for suggestions
      const allTags: Tag[] = await ipcRenderer.invoke('get-all-tags', getCurrentUserId());
      const currentTags: string[] = session.tags || [];

      let selectedTags = [...currentTags];

      showModal({
        title: 'Edit Session',
        fields: [
          { name: 'title', label: 'Title:', type: 'text', value: session.title, required: true },
          { name: 'description', label: 'Description:', type: 'textarea', value: session.description },
          // Add a custom field for tags (will render below)
        ],
        submitText: 'Save',
        cancelText: 'Delete',
        cancelClass: 'delete',
        onSubmit: async (values) => {
          // Get tags from the tag input UI
          const tags = selectedTags;
          await ipcRenderer.invoke('edit-session', {
            userId: getCurrentUserId(),
            id: session.id,
            title: values.title,
            description: values.description,
            tags
          });
          await ipcRenderer.invoke('set-session-tags', getCurrentUserId(), session.id, tags);
          onChange();
        },
        onCancel: async () => {
          if (confirm('Delete this session? This cannot be undone.')) {
            await ipcRenderer.invoke('delete-session', session.id);
            onChange();
          }
        }
      });

      // Render tag input UI below the modal form
      setTimeout(() => {
        const form = document.getElementById('customModalForm');
        if (!form) return;
        const tagDiv = document.createElement('div');
        tagDiv.style.margin = '12px 0';

        tagDiv.innerHTML = `
        <label style="font-weight:bold;">Tags:</label>
        <div id="tag-list" style="margin:6px 0 8px 0; display:flex; flex-wrap:wrap; gap:6px;"></div>
        <input id="tag-input" type="text" placeholder="Add tag and press Enter">
        <select id="tag-select">
          <option value="">-- no tag selected --</option>
          ${allTags
            .filter((t: Tag) => !selectedTags.includes(t.name))
            .map((t: Tag) => `<option value="${t.name}">${t.name}</option>`)
            .join('')}
        </select>
      `;
        form.appendChild(tagDiv);

        const tagList = tagDiv.querySelector('#tag-list') as HTMLDivElement;
        const tagInput = tagDiv.querySelector('#tag-input') as HTMLInputElement;
        const tagSelect = tagDiv.querySelector('#tag-select') as HTMLSelectElement;

        function renderTags() {
          tagList.innerHTML = selectedTags.map(tag =>
            `<span style="background:var(--accent);color:#222;padding:2px 10px;border-radius:12px;display:inline-flex;align-items:center;gap:4px;">
            ${tag}
            <button type="button" data-tag="${tag}" style="background:none;border:none;color:#222;cursor:pointer;font-size:1em;">&times;</button>
          </span>`
          ).join('');
          tagList.querySelectorAll('button[data-tag]').forEach(btn => {
            btn.addEventListener('click', () => {
              const tag = (btn as HTMLButtonElement).dataset.tag!;
              selectedTags = selectedTags.filter(t => t !== tag);
              renderTags();
              // Update dropdown to show removed tag again
              updateTagSelect();
            });
          });
        }

        function updateTagSelect() {
          tagSelect.innerHTML = `<option value="">Add existing tag</option>` +
            allTags
              .filter((t: Tag) => !selectedTags.includes(t.name))
              .map((t: Tag) => `<option value="${t.name}">${t.name}</option>`)
              .join('');
        }

        renderTags();
        updateTagSelect();

        tagInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && tagInput.value.trim()) {
            const tag = tagInput.value.trim();
            if (!selectedTags.includes(tag)) {
              selectedTags.push(tag);
              renderTags();
              updateTagSelect();
            }
            tagInput.value = '';
            e.preventDefault();
          }
        });

        tagSelect.addEventListener('change', () => {
          const tag = tagSelect.value;
          if (tag && !selectedTags.includes(tag)) {
            selectedTags.push(tag);
            renderTags();
            updateTagSelect();
          }
          tagSelect.value = '';
        });
      }, 100);
    }
    renderSessionRows(sessions);
  }

  // Initial render
  await renderByDateView();
  summaryDiv.appendChild(byDateContainer);
  summaryDiv.appendChild(bySessionContainer);

  // --- Toggle logic ---
  byDateBtn.onclick = async () => {
    byDateBtn.classList.add('active');
    bySessionBtn.classList.remove('active');
    byDateContainer.style.display = '';
    bySessionContainer.style.display = 'none';
    filteredByDateData = [];
    await renderByDateView();
  };
  bySessionBtn.onclick = async () => {
    bySessionBtn.classList.add('active');
    byDateBtn.classList.remove('active');
    byDateContainer.style.display = 'none';
    bySessionContainer.style.display = '';
    filteredSessions = [];
    await renderBySessionView();
  };
}