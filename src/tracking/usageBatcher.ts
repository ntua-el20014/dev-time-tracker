/**
 * Buffers usage ticks and writes them in batches: one INSERT for all buffered
 * usage_logs rows, plus one summary upsert per (day, app, language, browser
 * category) group.
 * Replaces two requests per tick with a handful per flush.
 *
 * Failure handling mirrors the per-tick path it replaces:
 * - network error on the insert → every record goes to the offline queue
 *   (which later replays them one by one, summary included)
 * - other insert errors → logged and dropped
 * - summary errors → logged; the logs themselves are already saved
 */
import { toLocalDateString } from "../utils/timeFormat";

export interface UsageRecord {
  userId: string;
  appName: string;
  windowTitle: string;
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
  insertLogs(records: UsageRecord[]): Promise<void>;
  addToSummary(increment: SummaryIncrement): Promise<void>;
}

export interface BatcherDeps {
  writer: UsageWriter;
  isNetworkError(err: unknown): boolean;
  /** Persist a record that could not be written (offline queue) */
  enqueueOffline(record: UsageRecord, icon: string | null): void;
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
   * (or queued offline). Concurrent calls wait for the running flush, then
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

  /** Icon for this group if it hasn't been sent yet, else null. */
  private takeIcon(key: string, icon: string): string | null {
    if (!icon || this.iconSentKeys.has(key)) return null;
    this.iconSentKeys.add(key);
    return icon;
  }

  private async write(records: UsageRecord[]): Promise<number> {
    try {
      await this.deps.writer.insertLogs(records);
    } catch (err) {
      if (!this.deps.isNetworkError(err)) {
        this.deps.logError("usageBatcher.insertLogs", err);
        return 0;
      }
      for (const r of records) {
        const key = this.summaryKey(r, toLocalDateString(r.timestamp));
        this.deps.enqueueOffline(r, this.takeIcon(key, r.icon));
      }
      return records.length;
    }

    // Aggregate per summary row so each gets a single upsert
    const groups = new Map<string, SummaryIncrement>();
    for (const r of records) {
      const date = toLocalDateString(r.timestamp);
      const key = this.summaryKey(r, date);
      const group = groups.get(key);
      if (group) {
        group.seconds += r.intervalSeconds;
        group.languageExtension ??= r.languageExtension;
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

    for (const [key, increment] of groups) {
      try {
        await this.deps.writer.addToSummary(increment);
        if (increment.icon) this.iconSentKeys.add(key);
      } catch (err) {
        this.deps.logError("usageBatcher.addToSummary", err);
      }
    }
    return records.length;
  }
}
