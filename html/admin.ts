import { showInAppNotification, showNotification } from "./components";

export function createExportDbButton(type: 'db' | 'json' | 'csv'): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'goal-btn';
    if (type === 'db') {
        btn.textContent = 'Export Database (.db)';
    } else if (type === 'json') {
        btn.textContent = 'Export as JSON';
    } else if (type === 'csv') {
        btn.textContent = 'Export as CSV';
    }

    btn.onclick = async () => {
        const { ipcRenderer } = window.require('electron');
        let channel = '';
        if (type === 'db') channel = 'export-database';
        else if (type === 'json') channel = 'export-database-json';
        else if (type === 'csv') channel = 'export-database-csv';

        const result = await ipcRenderer.invoke(channel);
        if (result && result.status === 'success') {
            showNotification(
                type === 'db'
                    ? 'Database exported successfully!'
                    : type === 'json'
                        ? 'Exported as JSON successfully!'
                        : 'Exported as CSV successfully!'
            );
        } else if (result && result.status === 'cancelled') {
            showInAppNotification('Export cancelled.');
        } else {
            showInAppNotification('Export failed.' + (result && result.message ? ` (${result.message})` : ''));
        }
    };
    return btn;
}

export function renderAdminPanel(container: HTMLElement) {
    container.innerHTML = '';

    const title = document.createElement('h2');
    title.style.marginBottom = '30px';
    title.textContent = 'Admin Panel';
    container.appendChild(title);

    container.appendChild(createExportDbButton('db'));
    container.appendChild(createExportDbButton('json'));
    container.appendChild(createExportDbButton('csv'));

    return container;
}