import * as crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { CostConfig } from "../config/schema.js";
import { getBudgetState, addSpending } from "../store/budget.js";

export interface CostVerdict {
  decision: "ALLOW" | "BLOCK" | "DOWNGRADE";
  reason: string | null;
  detail: string | null;
  routed_model: string | null;
  estimated_cost: number;
  saved_cost: number;
}

// Cost per 1M tokens (input+output average) in USD
const MODEL_COSTS: Record<string, number> = {
  "claude-opus-4": 15,
  "claude-opus-4-0519": 15,
  "claude-sonnet-4.5": 3,
  "claude-sonnet-4-5-20250514": 3,
  "claude-haiku-4.5": 0.8,
  "claude-haiku-4-5-20251001": 0.8,
  "gpt-5": 10,
  "gpt-5-mini": 1.5,
  "gpt-5-nano": 0.3,
  "gpt-4o": 2.5,
  "gpt-4o-mini": 0.15,
};

const DOWNGRADE_MAP: Record<string, string> = {
  "claude-opus-4": "claude-haiku-4.5",
  "claude-opus-4-0519": "claude-haiku-4-5-20251001",
  "claude-sonnet-4.5": "claude-haiku-4.5",
  "claude-sonnet-4-5-20250514": "claude-haiku-4-5-20251001",
  "gpt-5": "gpt-5-nano",
  "gpt-5-mini": "gpt-5-nano",
  "gpt-4o": "gpt-4o-mini",
};

export class CostEngine {
  private config: CostConfig;
  private db: Database.Database;
  private recentHashes: Array<{ hash: string; timestamp: number; cost: number }> = [];

  constructor(config: CostConfig, db: Database.Database) {
    this.config = config;
    this.db = db;
  }

  evaluate(
    model: string,
    body: Record<string, unknown>,
    estimatedTokens: number
  ): CostVerdict {
    const budget = getBudgetState(this.db);
    const costRate = MODEL_COSTS[model] || 1;
    const estimatedCost = (estimatedTokens / 1_000_000) * costRate;

    // 1. Budget check
    if (budget.daily_spent_usd + estimatedCost > this.config.budget.daily_limit_usd) {
      return {
        decision: "BLOCK",
        reason: "daily_budget_exceeded",
        detail: `Daily budget exceeded ($${budget.daily_spent_usd.toFixed(2)}/$${this.config.budget.daily_limit_usd.toFixed(2)})`,
        routed_model: null,
        estimated_cost: estimatedCost,
        saved_cost: 0,
      };
    }

    if (budget.monthly_spent_usd + estimatedCost > this.config.budget.monthly_limit_usd) {
      return {
        decision: "BLOCK",
        reason: "monthly_budget_exceeded",
        detail: `Monthly budget exceeded ($${budget.monthly_spent_usd.toFixed(2)}/$${this.config.budget.monthly_limit_usd.toFixed(2)})`,
        routed_model: null,
        estimated_cost: estimatedCost,
        saved_cost: 0,
      };
    }

    // 2. Loop detection
    const contentHash = this.hashMessages(body);
    const now = Date.now();
    const windowMs = this.config.loop_detection.hash_window_seconds * 1000;

    // Clean old hashes
    this.recentHashes = this.recentHashes.filter((h) => now - h.timestamp < windowMs);

    const repeats = this.recentHashes.filter((h) => h.hash === contentHash).length;
    if (repeats >= this.config.loop_detection.max_repeats) {
      return {
        decision: "BLOCK",
        reason: "loop_detected",
        detail: `Loop detected: same content hash ${repeats + 1}x in ${this.config.loop_detection.hash_window_seconds}s`,
        routed_model: null,
        estimated_cost: estimatedCost,
        saved_cost: 0,
      };
    }

    // Cost spiral check
    const recentCost = this.recentHashes
      .filter(
        (h) =>
          now - h.timestamp <
          this.config.loop_detection.cost_spiral_window_seconds * 1000
      )
      .reduce((sum, h) => sum + h.cost, 0);

    if (recentCost > this.config.loop_detection.cost_spiral_threshold_usd) {
      return {
        decision: "BLOCK",
        reason: "cost_spiral",
        detail: `Cost spiral: $${recentCost.toFixed(2)} in ${this.config.loop_detection.cost_spiral_window_seconds}s window`,
        routed_model: null,
        estimated_cost: estimatedCost,
        saved_cost: 0,
      };
    }

    // Track this request
    this.recentHashes.push({ hash: contentHash, timestamp: now, cost: estimatedCost });

    // 3. Smart routing
    if (this.config.smart_routing.enabled && estimatedTokens <= this.config.smart_routing.downgrade_threshold_tokens) {
      const downgraded = DOWNGRADE_MAP[model];
      if (downgraded) {
        const downgradedRate = MODEL_COSTS[downgraded] || costRate;
        const downgradedCost = (estimatedTokens / 1_000_000) * downgradedRate;
        const savedCost = estimatedCost - downgradedCost;
        return {
          decision: "DOWNGRADE",
          reason: "smart_routing",
          detail: `Smart routed: ${model} → ${downgraded} (saved ~$${savedCost.toFixed(4)})`,
          routed_model: downgraded,
          estimated_cost: downgradedCost,
          saved_cost: savedCost,
        };
      }
    }

    // 4. Budget warning (allow but warn)
    const warningThreshold =
      this.config.budget.daily_limit_usd * this.config.budget.warning_threshold;
    let detail: string | null = null;
    if (budget.daily_spent_usd > warningThreshold) {
      detail = `Budget warning: ${((budget.daily_spent_usd / this.config.budget.daily_limit_usd) * 100).toFixed(0)}% of daily budget used`;
    }

    return {
      decision: "ALLOW",
      reason: null,
      detail,
      routed_model: null,
      estimated_cost: estimatedCost,
      saved_cost: 0,
    };
  }

  recordCost(costUsd: number, savedUsd: number = 0): void {
    addSpending(this.db, costUsd, savedUsd);
  }

  private hashMessages(body: Record<string, unknown>): string {
    const messages = body.messages || [];
    const model = body.model || "";
    return crypto
      .createHash("sha256")
      .update(JSON.stringify({ messages, model }))
      .digest("hex")
      .slice(0, 16);
  }
}
