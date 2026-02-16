/**
 * Generic file I/O utilities for data export (CSV, JSON, ZIP).
 * SQLite-specific functions have been removed — all data now comes from Supabase.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from "fs";
import AdmZip from "adm-zip";
import { parse as json2csv } from "json2csv";
import { parse as csvParse } from "csv-parse";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function addCsvToZip(zip: AdmZip, data: any[], name: string) {
  if (data.length === 0) return;
  const csv = json2csv(data, { fields: Object.keys(data[0]) });
  zip.addFile(`${name}.csv`, Buffer.from(csv, "utf-8"));
}

export function readJsonFile(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export async function readZipCsvs(
  filePath: string,
): Promise<Record<string, any[]>> {
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();
  const result: Record<string, any[]> = {};

  for (const entry of entries) {
    if (entry.entryName.endsWith(".csv")) {
      const table = entry.entryName.replace(".csv", "");
      const csvStr = entry.getData().toString("utf-8");
      result[table] = await new Promise((resolve, reject) => {
        csvParse(
          csvStr,
          { columns: true, skip_empty_lines: true },
          (err, records) => {
            if (err) reject(err);
            else resolve(records);
          },
        );
      });
    }
  }
  return result;
}

export function exportDataToCsv(data: any[], filePath: string) {
  if (!data || data.length === 0) {
    throw new Error("No data to export.");
  }
  const csv = json2csv(data, { fields: Object.keys(data[0]) });
  fs.writeFileSync(filePath, csv, "utf-8");
}
