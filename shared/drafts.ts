/**
 * Drafts (Phase D): always-on segments waiting in the review inbox. Pure,
 * so merging can be tested without Supabase.
 */
import { addAppUsage, type AppUsageEntry } from "./appUsage";
import type { RepoCodeStats } from "./codeStats";

export interface DraftRow {
  id: string;
  client_id: string | null;
  title: string | null;
  start_time: string;
  end_time: string | null;
  duration: number | null;
  project_id: string | null;
  supervising_seconds: number | null;
  supervising_spans: [string, string][] | null;
  code_stats: RepoCodeStats[] | null;
  app_usage: AppUsageEntry[] | null;
}

/** What the kept draft becomes when drafts are merged. */
export interface MergedDraft {
  /** The earliest draft is kept and updated; the others are deleted */
  keepId: string;
  deleteIds: string[];
  fields: {
    title: string | null;
    start_time: string;
    end_time: string;
    duration: number;
    project_id: string | null;
    supervising_seconds: number;
    supervising_spans: [string, string][];
    code_stats: RepoCodeStats[];
    app_usage: AppUsageEntry[];
  };
}

const ms = (iso: string) => new Date(iso).getTime();

/** The value whose drafts add up to the most time (ties: earliest). */
function weightedPick<T>(
  rows: DraftRow[],
  valueOf: (row: DraftRow) => T | null,
): T | null {
  const totals = new Map<T, number>();
  for (const row of rows) {
    const value = valueOf(row);
    if (value === null || value === "") continue;
    totals.set(value, (totals.get(value) ?? 0) + (row.duration ?? 0));
  }
  let best: T | null = null;
  let bestSeconds = -1;
  for (const [value, seconds] of totals) {
    if (seconds > bestSeconds) {
      best = value;
      bestSeconds = seconds;
    }
  }
  return best;
}

/** Code stats per repo, summed. Files changed in several drafts may count more than once. */
export function mergeCodeStats(lists: (RepoCodeStats[] | null)[]): RepoCodeStats[] {
  const byRepo = new Map<string, RepoCodeStats>();
  for (const list of lists) {
    for (const s of list ?? []) {
      const t = byRepo.get(s.repo_key) ?? {
        repo_key: s.repo_key,
        repo_name: s.repo_name,
        commits: 0,
        files_changed: 0,
        lines_added: 0,
        lines_removed: 0,
        languages: {},
      };
      t.commits += s.commits || 0;
      t.files_changed += s.files_changed || 0;
      t.lines_added += s.lines_added || 0;
      t.lines_removed += s.lines_removed || 0;
      for (const [lang, n] of Object.entries(s.languages ?? {})) {
        const l = (t.languages[lang] ??= { added: 0, removed: 0 });
        l.added += n.added || 0;
        l.removed += n.removed || 0;
      }
      byRepo.set(s.repo_key, t);
    }
  }
  return [...byRepo.values()];
}

/**
 * Merge drafts into one: from the first start to the last end, active and
 * supervising time added up (the gaps between them don't count), code and
 * app usage summed. Title and project are those with the most time.
 */
export function mergeDrafts(rows: DraftRow[]): MergedDraft {
  if (rows.length < 2) throw new Error("Pick at least two drafts to merge");
  const sorted = [...rows].sort((a, b) => ms(a.start_time) - ms(b.start_time));
  const end = Math.max(...sorted.map((r) => ms(r.end_time ?? r.start_time)));
  const duration = sorted.reduce((sum, r) => sum + (r.duration ?? 0), 0);
  const appUsage: AppUsageEntry[] = [];
  for (const r of sorted) {
    for (const e of r.app_usage ?? []) addAppUsage(appUsage, e, e.seconds);
  }
  return {
    keepId: sorted[0].id,
    deleteIds: sorted.slice(1).map((r) => r.id),
    fields: {
      title: weightedPick(sorted, (r) => r.title),
      start_time: sorted[0].start_time,
      end_time: new Date(end).toISOString(),
      duration,
      project_id: weightedPick(sorted, (r) => r.project_id),
      supervising_seconds: Math.min(
        duration,
        sorted.reduce((sum, r) => sum + (r.supervising_seconds ?? 0), 0),
      ),
      supervising_spans: sorted
        .flatMap((r) => r.supervising_spans ?? [])
        .sort((a, b) => ms(a[0]) - ms(b[0])),
      code_stats: mergeCodeStats(sorted.map((r) => r.code_stats)),
      app_usage: appUsage,
    },
  };
}
