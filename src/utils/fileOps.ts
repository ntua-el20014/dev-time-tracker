/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs';
import AdmZip from 'adm-zip';
import { parse as json2csv } from 'json2csv';
import { parse as csvParse} from 'csv-parse';
import * as users from '../backend/users';
import * as sessions from '../backend/sessions';
import * as usage from '../backend/usage';
import path from 'path';

export function getAllDatabaseData() {
  const usersData = users.getAllUsers();
  const sessionsData = sessions.getAllSessionsData();
  const usageData = usage.getAllUsageData();

  const tagsData = sessions.getAllTagsData();
  const sessionTagsData = sessions.getAllSessionTagsData();
  const usageSummaryData = usage.getAllUsageSummaryData();
  const dailyGoalsData = usage.getAllDailyGoalsData();

  return {
    users: usersData,
    sessions: sessionsData,
    usage: usageData,
    tags: tagsData,
    session_tags: sessionTagsData,
    usage_summary: usageSummaryData,
    daily_goals: dailyGoalsData,
  };
}

export function clearAndImportAllTables(data: Record<string, any[]>) {
  users.clearUsers();
  sessions.clearSessions();
  sessions.clearTags();
  sessions.clearSessionTags();
  usage.clearUsage();
  usage.clearUsageSummary();
  usage.clearDailyGoals();

  if (data.users) users.importUsers(data.users);
  if (data.sessions) sessions.importSessions(data.sessions);
  if (data.tags) sessions.importTags(data.tags);
  if (data.session_tags) sessions.importSessionTags(data.session_tags);
  if (data.usage) usage.importUsage(data.usage);
  if (data.usage_summary) usage.importUsageSummary(data.usage_summary);
  if (data.daily_goals) usage.importDailyGoals(data.daily_goals);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function addCsvToZip(zip: AdmZip, data: any[], name: string) {
  if (data.length === 0) return;
  const csv = json2csv(data, { fields: Object.keys(data[0]) });
  zip.addFile(`${name}.csv`, Buffer.from(csv, 'utf-8'));
}

export function readJsonFile(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export async function readZipCsvs(filePath: string): Promise<Record<string, any[]>> {
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();
  const result: Record<string, any[]> = {};

  for (const entry of entries) {
    if (entry.entryName.endsWith('.csv')) {
      const table = entry.entryName.replace('.csv', '');
      const csvStr = entry.getData().toString('utf-8');
      result[table] = await new Promise((resolve, reject) => {
        csvParse(csvStr, { columns: true, skip_empty_lines: true }, (err, records) => {
          if (err) reject(err);
          else resolve(records);
        });
      });
    }
  }
  return result;
}

export function backupDatabase(dbPath: string) {
  const backupPath = `${dbPath.replace('.db', '')}-backup-${Date.now()}.db`;
  const backupDir = path.dirname(backupPath);
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

export function restoreDatabase(backupPath: string, dbPath: string) {
  fs.copyFileSync(backupPath, dbPath);
}

export function getLatestBackupFile(dbPath: string): string | null {
  const dir = path.dirname(dbPath);
  const base = path.basename(dbPath, '.db');
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith(base + '-backup-') && f.endsWith('.db'))
    .map(f => ({
      file: path.join(dir, f),
      time: Number(f.match(/backup-(\d+)\.db$/)?.[1] || 0)
    }))
    .filter(f => f.time > 0)
    .sort((a, b) => b.time - a.time);

  return files.length > 0 ? files[0].file : null;
}