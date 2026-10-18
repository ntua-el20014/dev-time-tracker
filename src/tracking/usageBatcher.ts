/**
 * Buffers usage ticks and writes them in batches: one summary upsert per
 * (local day, app, language, browser category) group. Nothing per tick is
 * uploaded, and window titles never are.
 *
 * Failure handling:
 * - network error → that group and the rest of the flush go to the offline
 *   queue (replayed later as the same summary increments)
 * - other errors → logged and dropped
 */
import { toLocalDateString } from "../utils/timeFormat";

export interface UsageRecord {
  userId: string;
  appName: string;
  language: string | null;
  languageExtension: string | null;
  /** App icon data URL ("" if unavailable) */
  icon: string;
  /** Browsers: what the page was for (C5) */
  category?: string | null;
  intervalSeconds: number;
  /** ISO timestamp of the tick */
  timestamp: string;
}

export interface SummaryIncrement {
  userId: string;
  /** Local calendar day, YYYY-MM-DD */
  date: string;
  appName: string;
  language: string | null;
  languageExtension: string | null;
  category: string | null;
  /** Only sent once per summary row per run; null keeps the stored icon */
  icon: string | null;
  seconds: number;
}

export interface UsageWriter {
  addToSummary(increment: SummaryIncrement): Promise<void>;
}

export interface BatcherDeps {
  writer: UsageWriter;
  isNetworkError(err: unknown): boolean;
  /** Persist an increment that could not be written (offline queue) */
  enqueueOffline(increment: SummaryIncrement): void;
  logError(context: string, err: unknown): void;
}

export class UsageBatcher {
  private buffer: UsageRecord[] = [];
  private flushing: Promise<number> | null = null;
  /** Summary rows that already received their icon in this run */
  private iconSentKeys = new Set<string>();

  constructor(private deps: BatcherDeps) {}

  get pendingCount(): number {
    return this.buffer.length;
  }

  add(record: UsageRecord): void {
    this.buffer.push(record);
  }

  /**
   * Writes everything buffered so far. Returns the number of records saved
   * (or queued offline); records of a failed, non-network write are dropped. Concurrent calls wait for the running flush, then
   * flush whatever arrived in the meantime.
   */
  async flush(): Promise<number> {
    while (this.flushing) await this.flushing;
    if (this.buffer.length === 0) return 0;

    const records = this.buffer;
    this.buffer = [];
    this.flushing = this.write(records);
    try {
      return await this.flushing;
    } finally {
      this.flushing = null;
    }
  }

  private summaryKey(r: UsageRecord, date: string): string {
    return `${r.userId}|${date}|${r.appName}|${r.language ?? ""}|${r.category ?? ""}`;
  }

  private async write(records: UsageRecord[]): Promise<number> {
    // Aggregate per summary row so each gets a single upsert
    const groups = new Map<string, SummaryIncrement>();
    const counts = new Map<string, number>();
    for (const r of records) {
      const date = toLocalDateString(r.timestamp);
      const key = this.summaryKey(r, date);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const group = groups.get(key);
      if (group) {
        group.seconds += r.intervalSeconds;
        group.languageExtension ??= r.languageExtension;
        group.icon ??= this.iconSentKeys.has(key) ? null : r.icon || null;
      } else {
        groups.set(key, {
          userId: r.userId,
          date,
          appName: r.appName,
          language: r.language,
          languageExtension: r.languageExtension,
          category: r.category ?? null,
          icon: this.iconSentKeys.has(key) ? null : r.icon || null,
          seconds: r.intervalSeconds,
        });
      }
    }

    let offline = false;
    let saved = 0;
    for (const [key, increment] of groups) {
      if (!offline) {
        try {
          await this.deps.writer.addToSummary(increment);
          if (increment.icon) this.iconSentKeys.add(key);
          saved += counts.get(key) ?? 0;
          continue;
        } catch (err) {
          if (!this.deps.isNetworkError(err)) {
            this.deps.logError("usageBatcher.addToSummary", err);
            continue;
          }
          offline = true;
        }
      }
      this.deps.enqueueOffline(increment);
      // The queued increment carries the icon
      if (increment.icon) this.iconSentKeys.add(key);
      saved += counts.get(key) ?? 0;
    }
    return saved;
  }
}
