import * as crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { ComplianceConfig } from "../config/schema.js";

export interface ComplianceVerdict {
  decision: "ALLOW" | "BLOCK";
  reason: string | null;
  detail: string | null;
}

interface DedupEntry {
  hash: string;
  count: number;
  first_seen: string;
  last_seen: string;
}

export class ComplianceEngine {
  private config: ComplianceConfig;
  private db: Database.Database;
  private requestCountToday: number = 0;

  constructor(config: ComplianceConfig, db: Database.Database) {
    this.config = config;
    this.db = db;
  }

  validate(
    authHeader: string | undefined,
    body: Record<string, unknown>,
    provider: string
  ): ComplianceVerdict {
    // 1. OAuth Token detection
    if (this.config.block_oauth_tokens && authHeader) {
      if (this.detectOAuthToken(authHeader, provider)) {
        return {
          decision: "BLOCK",
          reason: "oauth_token_detected",
          detail: "OAuth token detected in Authorization header. Use an API key instead to remain ToS-compliant.",
        };
      }
    }

    // 2. Daily request cap
    this.requestCountToday++;
    if (this.requestCountToday > this.config.daily_request_cap) {
      return {
        decision: "BLOCK",
        reason: "daily_cap_exceeded",
        detail: `Daily request cap exceeded (${this.requestCountToday}/${this.config.daily_request_cap}). Self-imposed limit for ToS safety.`,
      };
    }

    // 3. Dedup check
    const contentHash = this.hashContent(body);
    const dedupResult = this.checkDedup(contentHash);
    if (dedupResult) {
      return {
        decision: "BLOCK",
        reason: "duplicate_request",
        detail: `Duplicate request detected (${dedupResult.count + 1}x in dedup window). Blocked to prevent loop/spam.`,
      };
    }

    return { decision: "ALLOW", reason: null, detail: null };
  }

  private detectOAuthToken(authHeader: string, provider: string): boolean {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (provider === "anthropic") {
      // Anthropic API keys start with "sk-ant-api"
      // OAuth tokens have different formats
      if (token.startsWith("sk-ant-") && !token.startsWith("sk-ant-api")) {
        return true;
      }
    }

    if (provider === "openai") {
      // OpenAI API keys: "sk-proj-..." or "sk-..." (legacy)
      // OAuth tokens use different formats
      if (token.startsWith("oa-") || token.startsWith("sess-")) {
        return true;
      }
    }

    return false;
  }

  private hashContent(body: Record<string, unknown>): string {
    const messages = body.messages || [];
    const model = body.model || "";
    const content = JSON.stringify({ messages, model });
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  private checkDedup(hash: string): DedupEntry | null {
    // Use SQLite-compatible datetime format (space instead of 'T')
    const windowStart = new Date(
      Date.now() - this.config.dedup_window_seconds * 1000
    ).toISOString().replace("T", " ").replace("Z", "");

    // Clean old entries
    this.db
      .prepare("DELETE FROM dedup_cache WHERE last_seen < ?")
      .run(windowStart);

    // Check existing
    const existing = this.db
      .prepare("SELECT * FROM dedup_cache WHERE hash = ? AND last_seen >= ?")
      .get(hash, windowStart) as DedupEntry | undefined;

    if (existing && existing.count >= this.config.dedup_max_repeats) {
      // Update count
      this.db
        .prepare(
          "UPDATE dedup_cache SET count = count + 1, last_seen = datetime('now') WHERE hash = ?"
        )
        .run(hash);
      return existing;
    }

    // Upsert
    this.db
      .prepare(
        `INSERT INTO dedup_cache (hash, count, first_seen, last_seen)
         VALUES (?, 1, datetime('now'), datetime('now'))
         ON CONFLICT(hash) DO UPDATE SET count = count + 1, last_seen = datetime('now')`
      )
      .run(hash);

    return null;
  }

  resetDailyCount(): void {
    this.requestCountToday = 0;
  }
}
