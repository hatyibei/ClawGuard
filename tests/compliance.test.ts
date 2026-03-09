import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { ComplianceEngine } from "../src/engines/compliance.js";
import { ComplianceConfigSchema } from "../src/config/schema.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS dedup_cache (
      hash TEXT PRIMARY KEY,
      count INTEGER DEFAULT 1,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

describe("ComplianceEngine", () => {
  let engine: ComplianceEngine;
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    const config = ComplianceConfigSchema.parse({});
    engine = new ComplianceEngine(config, db);
  });

  describe("OAuth Token Detection", () => {
    it("should block Anthropic OAuth tokens", () => {
      const result = engine.validate(
        "Bearer sk-ant-oauth-something-here-1234567890",
        { model: "claude-sonnet-4.5", messages: [] },
        "anthropic"
      );
      expect(result.decision).toBe("BLOCK");
      expect(result.reason).toBe("oauth_token_detected");
    });

    it("should allow Anthropic API keys", () => {
      const result = engine.validate(
        "Bearer sk-ant-api03-valid-key-here-1234567890",
        { model: "claude-sonnet-4.5", messages: [] },
        "anthropic"
      );
      expect(result.decision).toBe("ALLOW");
    });

    it("should block OpenAI OAuth tokens", () => {
      const result = engine.validate(
        "Bearer oa-some-oauth-token",
        { model: "gpt-5", messages: [] },
        "openai"
      );
      expect(result.decision).toBe("BLOCK");
      expect(result.reason).toBe("oauth_token_detected");
    });

    it("should allow OpenAI API keys", () => {
      const result = engine.validate(
        "Bearer sk-proj-valid-key-here",
        { model: "gpt-5", messages: [] },
        "openai"
      );
      expect(result.decision).toBe("ALLOW");
    });
  });

  describe("Request Deduplication", () => {
    it("should allow first few duplicate requests", () => {
      const body = { model: "claude-sonnet-4.5", messages: [{ role: "user", content: "hello" }] };

      for (let i = 0; i < 3; i++) {
        const result = engine.validate("Bearer sk-ant-api03-key", body, "anthropic");
        expect(result.decision).toBe("ALLOW");
      }
    });

    it("should block after exceeding dedup threshold", () => {
      const body = { model: "claude-sonnet-4.5", messages: [{ role: "user", content: "hello" }] };

      // First 3 should pass (dedup_max_repeats default is 3)
      for (let i = 0; i < 3; i++) {
        engine.validate("Bearer sk-ant-api03-key", body, "anthropic");
      }

      // 4th should be blocked
      const result = engine.validate("Bearer sk-ant-api03-key", body, "anthropic");
      expect(result.decision).toBe("BLOCK");
      expect(result.reason).toBe("duplicate_request");
    });

    it("should allow different requests", () => {
      for (let i = 0; i < 10; i++) {
        const body = { model: "claude-sonnet-4.5", messages: [{ role: "user", content: `message ${i}` }] };
        const result = engine.validate("Bearer sk-ant-api03-key", body, "anthropic");
        expect(result.decision).toBe("ALLOW");
      }
    });
  });

  describe("Daily Request Cap", () => {
    it("should block after daily cap exceeded", () => {
      const config = ComplianceConfigSchema.parse({ daily_request_cap: 5 });
      const cappedEngine = new ComplianceEngine(config, db);
      const body = { model: "claude-sonnet-4.5", messages: [{ role: "user", content: "test" }] };

      for (let i = 0; i < 5; i++) {
        const bodyVariant = { ...body, messages: [{ role: "user", content: `msg ${i}` }] };
        const result = cappedEngine.validate("Bearer sk-ant-api03-key", bodyVariant, "anthropic");
        expect(result.decision).toBe("ALLOW");
      }

      const bodyFinal = { ...body, messages: [{ role: "user", content: "final" }] };
      const result = cappedEngine.validate("Bearer sk-ant-api03-key", bodyFinal, "anthropic");
      expect(result.decision).toBe("BLOCK");
      expect(result.reason).toBe("daily_cap_exceeded");
    });
  });
});
