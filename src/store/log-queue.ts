import type Database from "better-sqlite3";
import { insertLog, type RequestLogEntry } from "./logs.js";

/**
 * Async log queue that batches SQLite writes off the critical path.
 * Instead of blocking the event loop on every request, logs are queued
 * and flushed in batches via setImmediate/setTimeout.
 */
export class LogQueue {
  private db: Database.Database;
  private queue: RequestLogEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private batchSize: number;
  private flushIntervalMs: number;

  constructor(
    db: Database.Database,
    options?: { batchSize?: number; flushIntervalMs?: number }
  ) {
    this.db = db;
    this.batchSize = options?.batchSize || 50;
    this.flushIntervalMs = options?.flushIntervalMs || 100;
  }

  enqueue(entry: RequestLogEntry): void {
    this.queue.push(entry);

    if (this.queue.length >= this.batchSize) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0);

    // Use a transaction for batch efficiency
    try {
      const insertMany = this.db.transaction((entries: RequestLogEntry[]) => {
        for (const entry of entries) {
          insertLog(this.db, entry);
        }
      });
      insertMany(batch);
    } catch (err) {
      console.error("[LobsterGate] Log queue flush error:", err);
      // Re-queue failed entries (capped to prevent memory leak)
      if (this.queue.length < 1000) {
        this.queue.unshift(...batch);
      }
    }
  }

  /** Flush remaining logs on shutdown */
  shutdown(): void {
    this.flush();
  }
}
