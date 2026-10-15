/**
 * Pure: which repo the user is working in, which project it is linked to,
 * and how long each repo was focused during the current session.
 *
 * The tracker feeds it one observation every few seconds, also outside a
 * session, so the picker can be prefilled before Start.
 *
 * Detection only ever suggests: a project the user picked ("manual") is
 * kept until that session ends, and a running session never changes
 * project on its own.
 */
import type { RepoInfo } from "./repoResolver";

/** "manual": picked by the user; "auto": restored or detected. */
export type ProjectSource = "manual" | "auto";

export interface DetectedRepo {
  key: string;
  name: string;
  /** Linked (active) project, or null if the repo isn't linked yet */
  projectId: string | null;
}

export class ProjectAttribution {
  /** repo_key → project id, active projects only */
  private links = new Map<string, string>();
  /** Last repo seen in a dev window; kept while other apps are focused */
  private current: RepoInfo | null = null;
  /** Whether the focused window is in `current` right now */
  private focused = false;
  private sessionTime = new Map<string, { repo: RepoInfo; seconds: number }>();

  setLinks(links: Iterable<{ repo_key: string; project_id: string }>) {
    this.links = new Map([...links].map((l) => [l.repo_key, l.project_id]));
  }

  setLink(repoKey: string, projectId: string | null) {
    if (projectId) this.links.set(repoKey, projectId);
    else this.links.delete(repoKey);
  }

  projectFor(repoKey: string): string | null {
    return this.links.get(repoKey) ?? null;
  }

  /**
   * Record what the focused window shows. `null` (not a dev window, or no
   * repo) keeps the last repo. Returns true if the detected repo changed.
   */
  observe(repo: RepoInfo | null): boolean {
    this.focused = repo !== null;
    if (!repo || repo.key === this.current?.key) return false;
    this.current = repo;
    return true;
  }

  /** Count `seconds` of session time towards the focused repo, if any. */
  addSessionTime(seconds: number) {
    if (!this.focused || !this.current) return;
    const entry = this.sessionTime.get(this.current.key);
    if (entry) entry.seconds += seconds;
    else
      this.sessionTime.set(this.current.key, { repo: this.current, seconds });
  }

  /** The repo focused longest this session. */
  dominantRepo(): RepoInfo | null {
    let best: { repo: RepoInfo; seconds: number } | null = null;
    for (const entry of this.sessionTime.values()) {
      if (!best || entry.seconds > best.seconds) best = entry;
    }
    return best?.repo ?? null;
  }

  resetSession() {
    this.sessionTime.clear();
  }

  /** Forget everything (sign-out / user change). */
  reset() {
    this.links.clear();
    this.current = null;
    this.focused = false;
    this.sessionTime.clear();
  }

  currentRepo(): RepoInfo | null {
    return this.current;
  }

  /**
   * The project to switch the picker to, or null to leave it: only before
   * Start, only over an automatic choice, only to the current repo's link.
   */
  projectToSelect(state: {
    isRecording: boolean;
    source: ProjectSource;
    selected: string | null;
  }): string | null {
    if (state.isRecording || state.source === "manual" || !this.current) {
      return null;
    }
    const linked = this.projectFor(this.current.key);
    return linked && linked !== state.selected ? linked : null;
  }

  /**
   * The project a stopped session is saved under: the user's pick, else the
   * link of the repo worked in longest, else the (automatic) selection.
   */
  projectForStoppedSession(
    selected: string | null,
    source: ProjectSource,
  ): string | null {
    if (source === "manual") return selected;
    const dominant = this.dominantRepo();
    return (dominant && this.projectFor(dominant.key)) || selected;
  }

  describe(repo: RepoInfo | null = this.current): DetectedRepo | null {
    return repo
      ? { key: repo.key, name: repo.name, projectId: this.projectFor(repo.key) }
      : null;
  }
}
