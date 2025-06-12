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
  onSubmit: (values: Record<string, string>) => void;
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
      <button type="submit">${options.submitText || 'Save'}</button>
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
    const values: Record<string, string> = {};
    options.fields.forEach(f => {
      const el = form.querySelector(`[name="${f.name}"]`) as HTMLInputElement | HTMLTextAreaElement;
      values[f.name] = el.value.trim();
    });
    modal!.classList.remove('active');
    options.onSubmit(values);
  };

  // Cancel handler
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      modal!.classList.remove('active');
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