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

export function createImportDbButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'goal-btn';
    btn.textContent = 'Import Database';

    btn.onclick = async () => {
        const { ipcRenderer } = window.require('electron');
        // Use dialog from main process via IPC
        const result = await ipcRenderer.invoke('show-import-dialog');
        if (!result || !result.filePath) {
            showInAppNotification('Import cancelled.');
            return;
        }
        const filePath = result.filePath;
        const ext = filePath.split('.').pop()?.toLowerCase();
        let channel = '';
        if (ext === 'db') channel = 'import-database';
        else if (ext === 'json') channel = 'import-database-json';
        else if (ext === 'zip') channel = 'import-database-csv';
        else {
            showInAppNotification('Unsupported file type for import.');
            return;
        }
        const importResult = await ipcRenderer.invoke(channel, filePath);
        if (importResult && importResult.status === 'success') {
            showNotification('Database imported successfully!');
        } else if (importResult && importResult.status === 'cancelled') {
            showInAppNotification('Import cancelled.');
        } else {
            showInAppNotification('Import failed.' + (importResult && importResult.message ? ` (${importResult.message})` : ''));
        }
    };
    return btn;
}

export function createRollbackDbButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'goal-btn';
    btn.textContent = 'Rollback to Latest Backup';
    btn.onclick = async () => {
        const { ipcRenderer } = window.require('electron');
        if (!confirm('Are you sure you want to rollback to the latest backup? This will overwrite your current database.')) return;
        const result = await ipcRenderer.invoke('rollback-database');
        if (result && result.status === 'success') {
            showNotification('Database rolled back to latest backup!');
        } else {
            showInAppNotification('Rollback failed.' + (result && result.message ? ` (${result.message})` : ''));
        }
    };
    return btn;
}

export function createBackupDbButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'goal-btn';
    btn.textContent = 'Create Backup';
    btn.onclick = async () => {
        const { ipcRenderer } = window.require('electron');
        const result = await ipcRenderer.invoke('backup-database');
        if (result && result.status === 'success') {
            showNotification('Backup created successfully!');
        } else {
            showInAppNotification('Backup failed.' + (result && result.message ? ` (${result.message})` : ''));
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
    container.appendChild(document.createElement('hr'));
    container.appendChild(createImportDbButton());
    container.appendChild(createBackupDbButton());
    container.appendChild(createRollbackDbButton());

    return container;
}