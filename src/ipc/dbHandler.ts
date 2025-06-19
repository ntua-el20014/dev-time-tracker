import { ipcMain, dialog, app } from 'electron';
import * as fs from 'fs';
import AdmZip from 'adm-zip';
import * as fileops from '../utils/fileOps';
import path from 'path';

export const DB_PATH = path.join(app.getPath('userData'), 'usage.db');

ipcMain.handle('export-database', async () => {
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Export Database',
    defaultPath: 'dev-time-tracker-backup.db',
    filters: [{ name: 'SQLite Database', extensions: ['db'] }]
  });
  if (canceled || !filePath) return { status: 'cancelled' };
  try {
    fs.copyFileSync(DB_PATH, filePath);
    return { status: 'success' };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('export-database-json', async () => {
  try {
    const data = fileops.getAllDatabaseData();

    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Export Database as JSON',
      defaultPath: 'dev-time-tracker-export.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (canceled || !filePath) return { status: 'cancelled' };

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return { status: 'success' };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('export-database-csv', async () => {
  try {
    const data = fileops.getAllDatabaseData();

    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Export Database as CSV (ZIP)',
      defaultPath: 'dev-time-tracker-export.zip',
      filters: [{ name: 'ZIP', extensions: ['zip'] }]
    });
    if (canceled || !filePath) return { status: 'cancelled' };

    const zip = new AdmZip();
    fileops.addCsvToZip(zip, data.users, 'users');
    fileops.addCsvToZip(zip, data.sessions, 'sessions');
    fileops.addCsvToZip(zip, data.usage, 'usage');
    fileops.addCsvToZip(zip, data.tags, 'tags');
    fileops.addCsvToZip(zip, data.session_tags, 'session_tags');
    fileops.addCsvToZip(zip, data.usage_summary, 'usage_summary');
    fileops.addCsvToZip(zip, data.daily_goals, 'daily_goals');
    zip.writeZip(filePath);

    return { status: 'success' };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('import-database', async (_event, filePath: string) => {
    if (!filePath) return { status: 'cancelled' };

    const backupPath = fileops.backupDatabase(DB_PATH);
    try {
      fs.copyFileSync(filePath, DB_PATH);
      return { status: 'success' };
    } catch (err) {
      fileops.restoreDatabase(backupPath, DB_PATH);
      return { status: 'error', message: err instanceof Error ? err.message : String(err) };
    }
});

ipcMain.handle('import-database-json', async (_event, filePath: string) => {
    if (!filePath) return { status: 'cancelled' };

    try {
      const data = fileops.readJsonFile(filePath);
      fileops.backupDatabase(DB_PATH);

      fileops.clearAndImportAllTables(data);

      return { status: 'success' };
    } catch (err) {
      return { status: 'error', message: err instanceof Error ? err.message : String(err) };
    }
});

ipcMain.handle('import-database-csv', async (_event, filePath: string) => {
    if (!filePath) return { status: 'cancelled' };

    try {
      const tables = await fileops.readZipCsvs(filePath);
      fileops.backupDatabase(DB_PATH);

      fileops.clearAndImportAllTables(tables);

      return { status: 'success' };
    } catch (err) {
      return { status: 'error', message: err instanceof Error ? err.message : String(err) };
    }
});

ipcMain.handle('show-import-dialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Import Database',
        filters: [
            { name: 'Supported', extensions: ['db', 'json', 'zip'] }
        ],
        properties: ['openFile']
    });
    if (canceled || !filePaths[0]) return { cancelled: true };
    return { filePath: filePaths[0] };
});

ipcMain.handle('rollback-database', async () => {
  try {
    const latestBackup = fileops.getLatestBackupFile(DB_PATH);
    if (!latestBackup) {
      return { status: 'error', message: 'No backup found.' };
    }
    fs.copyFileSync(latestBackup, DB_PATH);
    return { status: 'success' };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('backup-database', async () => {
  try {
    const backupPath = fileops.backupDatabase(DB_PATH);
    return { status: 'success', backupPath };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
});