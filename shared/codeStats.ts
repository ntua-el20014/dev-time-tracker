/**
 * What a session produced, from git (C2): per repo, commits made during the
 * session and the lines changed (committed, and uncommitted at Stop).
 * Stored as time_tracking_sessions.code_stats. Counts and language names
 * only — never file paths, commit messages or contents.
 */

export interface LineCounts {
  added: number;
  removed: number;
}

export interface RepoCodeStats {
  repo_key: string;
  repo_name: string;
  /** Commits authored during the session */
  commits: number;
  /** Distinct files changed (committed or not) */
  files_changed: number;
  lines_added: number;
  lines_removed: number;
  /** Lines per language (by file extension) */
  languages: Record<string, LineCounts>;
}

export interface CodeTotals {
  commits: number;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  languages: Record<string, LineCounts>;
}

export function emptyTotals(): CodeTotals {
  return { commits: 0, filesChanged: 0, linesAdded: 0, linesRemoved: 0, languages: {} };
}

/** Add one session's (or several) code stats to running totals. */
export function addCodeStats(
  totals: CodeTotals,
  stats: RepoCodeStats[] | null | undefined,
): CodeTotals {
  if (!Array.isArray(stats)) return totals;
  for (const s of stats) {
    totals.commits += s.commits || 0;
    totals.filesChanged += s.files_changed || 0;
    totals.linesAdded += s.lines_added || 0;
    totals.linesRemoved += s.lines_removed || 0;
    for (const [lang, n] of Object.entries(s.languages ?? {})) {
      const t = (totals.languages[lang] ??= { added: 0, removed: 0 });
      t.added += n.added || 0;
      t.removed += n.removed || 0;
    }
  }
  return totals;
}

/** "+120 −30 · 4 files · 2 commits", or "" when nothing changed. */
export function formatCodeTotals(t: CodeTotals): string {
  if (!t.linesAdded && !t.linesRemoved && !t.commits && !t.filesChanged) return "";
  const parts = [`+${t.linesAdded.toLocaleString()} −${t.linesRemoved.toLocaleString()}`];
  if (t.filesChanged) parts.push(`${t.filesChanged} file${t.filesChanged === 1 ? "" : "s"}`);
  if (t.commits) parts.push(`${t.commits} commit${t.commits === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
