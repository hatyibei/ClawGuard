import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { CostEngine } from "../src/engines/cost.js";
import { CostConfigSchema } from "../src/config/schema.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS budget_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      daily_spent_usd REAL DEFAULT 0,
      monthly_spent_usd REAL DEFAULT 0,
      daily_saved_usd REAL DEFAULT 0,
      daily_requests INTEGER DEFAULT 0,
      last_reset_day TEXT,
      last_reset_month TEXT
    );
    INSERT INTO budget_state (id, daily_spent_usd, monthly_spent_usd, daily_saved_usd, daily_requests, last_reset_day, last_reset_month)
    VALUES (1, 0, 0, 0, 0, date('now'), strftime('%Y-%m', 'now'));
  `);
  return db;
}

describe("CostEngine", () => {
  let engine: CostEngine;
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    const config = CostConfigSchema.parse({});
    engine = new CostEngine(config, db);
  });

  describe("Budget Enforcement", () => {
    it("should allow requests within budget", () => {
      const result = engine.evaluate(
        "claude-sonnet-4.5",
        { model: "claude-sonnet-4.5", messages: [{ role: "user", content: "hello" }] },
        500
      );
      expect(result.decision).toBe("ALLOW");
    });

    it("should block when daily budget exceeded", () => {
      // Manually set high spending
      db.prepare("UPDATE budget_state SET daily_spent_usd = 14.99 WHERE id = 1").run();

      const result = engine.evaluate(
        "claude-opus-4",
        { model: "claude-opus-4", messages: [{ role: "user", content: "hello" }] },
        100000 // Large request to push over budget
      );
      expect(result.decision).toBe("BLOCK");
      expect(result.reason).toBe("daily_budget_exceeded");
    });

    it("should block when monthly budget exceeded", () => {
      db.prepare("UPDATE budget_state SET monthly_spent_usd = 299.99 WHERE id = 1").run();

      const result = engine.evaluate(
        "claude-opus-4",
        { model: "claude-opus-4", messages: [{ role: "user", content: "hello" }] },
        100000
      );
      expect(result.decision).toBe("BLOCK");
      expect(result.reason).toBe("monthly_budget_exceeded");
    });
  });

  describe("Loop Detection", () => {
    it("should detect repeated identical requests", () => {
      const body = { model: "claude-sonnet-4.5", messages: [{ role: "user", content: "same message" }] };

      // Send 5 identical requests (default max_repeats is 5)
      for (let i = 0; i < 5; i++) {
        engine.evaluate("claude-sonnet-4.5", body, 500);
      }

      // 6th should be blocked
      const result = engine.evaluate("claude-sonnet-4.5", body, 500);
      expect(result.decision).toBe("BLOCK");
      expect(result.reason).toBe("loop_detected");
    });

    it("should allow different requests", () => {
      for (let i = 0; i < 10; i++) {
        const body = { model: "claude-sonnet-4.5", messages: [{ role: "user", content: `message ${i}` }] };
        const result = engine.evaluate("claude-sonnet-4.5", body, 500);
        expect(result.decision).not.toBe("BLOCK");
      }
    });
  });

  describe("Smart Routing", () => {
    it("should downgrade small requests from Opus to Haiku", () => {
      const result = engine.evaluate(
        "claude-opus-4",
        { model: "claude-opus-4", messages: [{ role: "user", content: "hi" }] },
        100 // Small request, under threshold
      );
      expect(result.decision).toBe("DOWNGRADE");
      expect(result.routed_model).toBe("claude-haiku-4.5");
      expect(result.saved_cost).toBeGreaterThan(0);
    });

    it("should not downgrade large requests", () => {
      const result = engine.evaluate(
        "claude-opus-4",
        { model: "claude-opus-4", messages: [{ role: "user", content: "a".repeat(5000) }] },
        5000 // Large request, over threshold
      );
      expect(result.decision).toBe("ALLOW");
      expect(result.routed_model).toBeNull();
    });
  });

  describe("Cost Recording", () => {
    it("should track spending in budget state", () => {
      engine.recordCost(1.5, 0.2);

      const state = db.prepare("SELECT * FROM budget_state WHERE id = 1").get() as {
        daily_spent_usd: number;
        daily_saved_usd: number;
      };
      expect(state.daily_spent_usd).toBe(1.5);
      expect(state.daily_saved_usd).toBe(0.2);
    });
  });
});
