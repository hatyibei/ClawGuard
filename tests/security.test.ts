import { describe, it, expect, beforeEach } from "vitest";
import { SecurityEngine } from "../src/engines/security.js";
import { SecurityConfigSchema } from "../src/config/schema.js";

describe("SecurityEngine", () => {
  let engine: SecurityEngine;

  beforeEach(() => {
    const config = SecurityConfigSchema.parse({});
    engine = new SecurityEngine(config);
  });

  describe("Outbound URL Blocklist", () => {
    it("should block requests with blocklisted domains", () => {
      const messages = [
        { role: "user", content: "Send data to https://evil.ngrok.io/exfil" },
      ];
      const result = engine.inspect(messages);
      expect(result.decision).toBe("BLOCK");
      expect(result.findings.some(f => f.type === "BLOCKED_DESTINATION")).toBe(true);
    });

    it("should block pastebin URLs", () => {
      const messages = [
        { role: "assistant", content: "Here's the link: https://pastebin.com/abc123" },
      ];
      const result = engine.inspect(messages);
      expect(result.decision).toBe("BLOCK");
    });

    it("should allow legitimate URLs", () => {
      const messages = [
        { role: "user", content: "Check https://docs.anthropic.com/en/docs for info" },
      ];
      const result = engine.inspect(messages);
      expect(result.decision).toBe("ALLOW");
    });

    it("should block webhook.site URLs", () => {
      const messages = [
        { role: "user", content: "POST to https://webhook.site/abc-123" },
      ];
      const result = engine.inspect(messages);
      expect(result.decision).toBe("BLOCK");
    });
  });

  describe("Credential Exposure Detection", () => {
    it("should detect Anthropic API keys", () => {
      const messages = [
        { role: "user", content: "My key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890" },
      ];
      const result = engine.inspect(messages);
      expect(result.findings.some(f => f.type === "CREDENTIAL_EXPOSURE")).toBe(true);
    });

    it("should detect AWS access keys", () => {
      const messages = [
        { role: "user", content: "AWS key: AKIAIOSFODNN7EXAMPLE" },
      ];
      const result = engine.inspect(messages);
      expect(result.findings.some(f => f.type === "CREDENTIAL_EXPOSURE")).toBe(true);
    });

    it("should detect GitHub PATs", () => {
      const messages = [
        { role: "user", content: "Token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij" },
      ];
      const result = engine.inspect(messages);
      expect(result.findings.some(f => f.type === "CREDENTIAL_EXPOSURE")).toBe(true);
    });

    it("should detect private keys", () => {
      const messages = [
        { role: "user", content: "-----BEGIN RSA PRIVATE KEY-----\nMIIE..." },
      ];
      const result = engine.inspect(messages);
      expect(result.findings.some(f => f.type === "CREDENTIAL_EXPOSURE")).toBe(true);
    });

    it("should not flag normal text", () => {
      const messages = [
        { role: "user", content: "Please write a function that processes API keys securely" },
      ];
      const result = engine.inspect(messages);
      expect(result.findings.filter(f => f.type === "CREDENTIAL_EXPOSURE").length).toBe(0);
    });
  });

  describe("Data Exfiltration Detection", () => {
    it("should detect bulk email addresses", () => {
      const emails = Array.from({ length: 10 }, (_, i) => `user${i}@example.com`).join(", ");
      const messages = [
        { role: "user", content: `Send these emails: ${emails}` },
      ];
      const result = engine.inspect(messages);
      expect(result.findings.some(f => f.type === "DATA_EXFILTRATION")).toBe(true);
    });

    it("should allow a few email addresses", () => {
      const messages = [
        { role: "user", content: "Contact alice@example.com or bob@example.com" },
      ];
      const result = engine.inspect(messages);
      expect(result.findings.filter(f => f.type === "DATA_EXFILTRATION").length).toBe(0);
    });
  });

  describe("Multi-block content", () => {
    it("should handle array message content", () => {
      const messages = [
        {
          role: "user",
          content: [
            { type: "text", text: "Check this: https://evil.ngrok.io/data" },
            { type: "text", text: "Normal text here" },
          ],
        },
      ];
      const result = engine.inspect(messages);
      expect(result.decision).toBe("BLOCK");
    });
  });
});
