import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";

let db: Database.Database | null = null;

export function getDb(dataDir: string): Database.Database {
  if (db) return db;

  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "clawguard.db");
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);
  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS request_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      layer TEXT,
      detail TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      saved_cost_usd REAL DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      session_id TEXT,
      request_hash TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON request_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_logs_status ON request_logs(status);
    CREATE INDEX IF NOT EXISTS idx_logs_session ON request_logs(session_id);

    CREATE TABLE IF NOT EXISTS budget_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      daily_spent_usd REAL DEFAULT 0,
      monthly_spent_usd REAL DEFAULT 0,
      daily_saved_usd REAL DEFAULT 0,
      daily_requests INTEGER DEFAULT 0,
      last_reset_day TEXT,
      last_reset_month TEXT
    );

    INSERT OR IGNORE INTO budget_state (id, daily_spent_usd, monthly_spent_usd, daily_saved_usd, daily_requests, last_reset_day, last_reset_month)
    VALUES (1, 0, 0, 0, 0, date('now'), strftime('%Y-%m', 'now'));

    CREATE TABLE IF NOT EXISTS blocklist_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      value TEXT NOT NULL UNIQUE,
      source TEXT DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dedup_cache (
      hash TEXT PRIMARY KEY,
      count INTEGER DEFAULT 1,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
