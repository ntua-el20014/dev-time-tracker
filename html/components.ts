import { Chart } from 'chart.js/auto';

/* eslint-disable @typescript-eslint/no-non-null-assertion */
export function displayOSInfo(os: string) {
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

export interface ModalOptions {
  title: string;
  fields: { name: string; label: string; type: 'text' | 'textarea'; value?: string; required?: boolean }[];
  submitText?: string;
  cancelText?: string;
  cancelClass?: string;
  onSubmit?: (values: Record<string, string>) => void;
  onCancel?: () => void;
  show?: boolean;
}

export function showModal(options: ModalOptions) {
  let modal = document.getElementById('customModal') as HTMLDivElement | null;
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'customModal';
    modal.innerHTML = `
      <div class="session-modal-content">
        <h2></h2>
        <form id="customModalForm"></form>
      </div>
    `;
    document.body.appendChild(modal);
  }
  const content = modal.querySelector('.session-modal-content') as HTMLDivElement;
  const h2 = content.querySelector('h2')!;
  const form = content.querySelector('form') as HTMLFormElement;

  h2.textContent = options.title;
  form.innerHTML = options.fields.map(f => `
    <label for="modal-${f.name}">${f.label}</label><br>
    ${f.type === 'textarea'
      ? `<textarea id="modal-${f.name}" name="${f.name}" ${f.required ? 'required' : ''}>${f.value || ''}</textarea><br>`
      : `<input id="modal-${f.name}" name="${f.name}" type="text" value="${f.value || ''}" ${f.required ? 'required' : ''}><br>`
    }
  `).join('') + `
  <div class="session-modal-actions">
    <button type="button" id="customModalCancelBtn" class="${options.cancelClass || ''}">${options.cancelText || 'Cancel'}</button>
    ${options.submitText ? `<button type="submit">${options.submitText}</button>` : ''}
  </div>
`;

  modal.classList.add('active');
  setTimeout(() => {
    const firstInput = form.querySelector('input,textarea') as HTMLElement;
    if (firstInput) firstInput.focus();
  }, 100);

  // Remove previous listeners
  form.onsubmit = null;
  const cancelBtn = form.querySelector('#customModalCancelBtn') as HTMLButtonElement;
  if (cancelBtn) cancelBtn.onclick = null;

  // Submit handler
  form.onsubmit = (e) => {
    e.preventDefault();
    if (!options.onSubmit) return;
    const values: Record<string, string> = {};
    options.fields.forEach(f => {
      const el = form.querySelector(`[name="${f.name}"]`) as HTMLInputElement | HTMLTextAreaElement;
      values[f.name] = el.value.trim();
    });
    modal!.classList.remove('active');
    modal.remove();
    options.onSubmit(values);
  };

  // Cancel handler
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      modal!.classList.remove('active');
      modal.remove();
      if (options.onCancel) options.onCancel();
    };
  }
}

/**
 * Shows a custom notification popup with sound.
 * @param message The message to display.
 * @param durationMs How long to show (default 3500ms).
 */
export function showNotification(message: string, durationMs = 3500) {
  // Remove any existing notification
  let notif = document.getElementById('custom-notification') as HTMLDivElement | null;
  if (notif) notif.remove();

  notif = document.createElement('div');
  notif.id = 'custom-notification';
  notif.textContent = message;
  notif.className = 'custom-notification'; // Use CSS class for styling

  document.body.appendChild(notif);

  // Play system notification sound (if possible)
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Dev Time Tracker', { body: message });
    } else {
      // Fallback: play a short beep using Web Audio API
      const audioCtxCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const ctx = new audioCtxCtor();
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 880;
      o.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.15);
      o.onended = () => ctx.close();
    }
  } catch {
    // Fallback if sound cannot be played
  }

  setTimeout(() => {
    notif!.style.opacity = '0';
    setTimeout(() => notif?.remove(), 350);
  }, durationMs);
}

/**
 * Renders a horizontal percentage bar.
 * @param items Array of { label: string, percent: number, color: string }
 * @param height Height in px (default 32)
 * @param borderRadius Border radius in px (default 8)
 * @returns HTML string for the bar
 */
export function renderPercentBar(
  items: { label: string; percent: number; color: string }[],
  height = 32,
  borderRadius = 8
): string {
  return `
    <div style="display: flex; height: ${height}px; border-radius: ${borderRadius}px; overflow: hidden; border: 1px solid #ccc; margin-bottom: 12px;">
      ${items.map(item => `
        <div title="${item.label}: ${item.percent.toFixed(1)}%" 
             style="width:${item.percent}%;background:${item.color};display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;">
          ${item.percent > 10 ? item.label : ''}
        </div>
      `).join('')}
    </div>
  `;
}

type PieChartContainer = HTMLElement & { _pieChartInstance?: Chart };

export function renderPieChartJS(
  containerId: string,
  items: { label: string; percent: number; color: string }[],
  size = 160
) {
  const container = document.getElementById(containerId) as PieChartContainer | null;
  if (!container) return;
  container.innerHTML = '';

  // Create and append canvas
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  container.appendChild(canvas);

  // Destroy previous chart instance if any
  if (container._pieChartInstance) {
    container._pieChartInstance.destroy();
  }

  // Use CSS variable for legend label color
  const legendLabelColor = getComputedStyle(document.body).getPropertyValue('--fg').trim() || '#fff';

  // Prepare data
  const data = {
    labels: items.map(i => i.label),
    datasets: [{
      data: items.map(i => i.percent),
      backgroundColor: items.map(i => i.color),
      borderWidth: 1,
      borderColor: '#fff'
    }]
  };

  // Create Chart.js pie chart
  const chart = new Chart(canvas, {
    type: 'pie',
    data,
    options: {
      responsive: false,
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            color: legendLabelColor,
            font: { size: 14 }
          }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const label = ctx.label || '';
              const value = ctx.parsed || 0;
              return `${label}: ${value.toFixed(1)}%`;
            }
          }
        }
      }
    }
  });

  // Store chart instance for later cleanup
  container._pieChartInstance = chart;
}

type LineChartDataPoint = {
  title: string;
  date: string;   // YYYY-MM-DD
  name?: string;   // Editor or language
  usage: number;  // Usage in seconds or minutes
  color?: string; // Optional: for custom series color
};

type LineChartOptions = {
  containerId: string;
  data: LineChartDataPoint[];
  width?: number;
  height?: number;
  yLabel?: string;
  dateSpan?: string[]; // Optional: array of dates to use as x-axis (for missing days)
};

type LineChartContainer = HTMLElement & { _lineChartInstance?: Chart };

export function renderLineChartJS(opts: LineChartOptions) {
  const { containerId, data, width = 400, height = 200, yLabel = 'Usage', dateSpan } = opts;
  const container = document.getElementById(containerId) as LineChartContainer | null;
  if (!container) return;
  container.innerHTML = '';

  // Destroy previous chart instance if any
  if (container._lineChartInstance) {
    container._lineChartInstance.destroy();
  }

  // If all data points are missing 'name', use a default name (from title or 'Usage')
  const names = Array.from(new Set(data.map(d => d.name).filter(Boolean)));
  if (names.length === 0) {
    const defaultName = data[0]?.title || 'Usage';
    names.push(defaultName);
    data.forEach(d => (d.name = defaultName));
  }

  // Get all unique dates (x-axis)
  const dates = dateSpan
    ? dateSpan
    : Array.from(new Set(data.map(d => d.date))).sort();

  // Assign colors (fallback palette)
  const palette = ['#4f8cff', '#ffb347', '#7ed957', '#ff6961', '#b19cd9', '#f67280', '#355c7d'];
  const colorMap: { [name: string]: string } = {};
  names.forEach((name, i) => {
    const custom = data.find(d => d.name === name && d.color)?.color;
    colorMap[name] = custom || palette[i % palette.length];
  });

  // Build datasets for Chart.js
  const datasets = names.map(name => ({
    label: name,
    data: dates.map(date => {
      const found = data.find(d => d.name === name && d.date === date);
      return found ? found.usage : 0;
    }),
    borderColor: colorMap[name],
    backgroundColor: colorMap[name] + '33', // semi-transparent fill
    tension: 0.2,
    fill: false,
    pointRadius: 3,
    pointHoverRadius: 5,
  }));

  // Create and append canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  container.appendChild(canvas);

  // Use CSS variable for axis/label color
  const axisColor = getComputedStyle(document.body).getPropertyValue('--fg').trim() || '#fff';

  // Create Chart.js line chart
  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: dates,
      datasets,
    },
    options: {
      responsive: false,
      plugins: {
        legend: {
          labels: {
            color: axisColor,
            font: { size: 13 }
          }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const label = ctx.dataset.label || '';
              const value = ctx.parsed.y || 0;
              return `${label}: ${value}`;
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Date', color: axisColor },
          ticks: {
            color: axisColor,
            font: { size: 10 }, // smaller font
            maxRotation: 45,    // rotate diagonally
            minRotation: 45
          }
        },
        y: {
          title: { display: true, text: yLabel, color: axisColor },
          ticks: { color: axisColor }
        }
      }
    }
  });

  // Store chart instance for later cleanup
  container._lineChartInstance = chart;
}

export function showColorGridPicker(options: {
  colors: string[],
  selected: string,
  onSelect: (color: string) => void,
  anchorEl: HTMLElement
}) {
  // Remove any existing picker
  document.querySelectorAll('.color-grid-picker').forEach(e => e.remove());

  const picker = document.createElement('div');
  picker.className = 'color-grid-picker';
  picker.style.position = 'absolute';
  picker.style.zIndex = '9999';
  picker.style.background = '#fff';
  picker.style.border = '1px solid #ccc';
  picker.style.borderRadius = '8px';
  picker.style.padding = '8px';
  picker.style.display = 'grid';
  picker.style.gridTemplateColumns = 'repeat(5, 24px)';
  picker.style.gridGap = '6px';

  options.colors.forEach(color => {
    const swatch = document.createElement('div');
    swatch.style.width = '24px';
    swatch.style.height = '24px';
    swatch.style.borderRadius = '6px';
    swatch.style.background = color;
    swatch.style.cursor = 'pointer';
    swatch.style.border = color === options.selected ? '2px solid #222' : '2px solid #fff';
    swatch.onclick = () => {
      options.onSelect(color);
      picker.remove();
    };
    picker.appendChild(swatch);
  });

  // Position below anchorEl
  const rect = options.anchorEl.getBoundingClientRect();
  picker.style.left = `${rect.left + window.scrollX}px`;
  picker.style.top = `${rect.bottom + window.scrollY + 4}px`;

  document.body.appendChild(picker);

  // Remove on click outside
  setTimeout(() => {
    const remove = (e: MouseEvent) => {
      if (!picker.contains(e.target as Node)) picker.remove();
      document.removeEventListener('mousedown', remove);
    };
    document.addEventListener('mousedown', remove);
  }, 10);
}