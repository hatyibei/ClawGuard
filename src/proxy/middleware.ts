import type { Request, Response, NextFunction } from "express";
import type Database from "better-sqlite3";
import type { ClawGuardConfig } from "../config/schema.js";
import { ComplianceEngine } from "../engines/compliance.js";
import { SecurityEngine } from "../engines/security.js";
import { CostEngine } from "../engines/cost.js";
import { AlertEngine } from "../alerts/index.js";
import { insertLog } from "../store/logs.js";
import { forwardToAnthropic } from "./providers/anthropic.js";
import { forwardToOpenAI } from "./providers/openai.js";
import { forwardToOpenRouter } from "./providers/openrouter.js";
import type { WebSocketBroadcaster } from "../dashboard/ws.js";

interface ProxyContext {
  config: ClawGuardConfig;
  db: Database.Database;
  compliance: ComplianceEngine;
  security: SecurityEngine;
  cost: CostEngine;
  alerts: AlertEngine;
  wsBroadcaster: WebSocketBroadcaster;
}

function detectProvider(path: string, headers: Record<string, string>): string {
  if (path.startsWith("/v1/messages") || headers["anthropic-version"]) {
    return "anthropic";
  }
  if (path.startsWith("/v1/chat/completions")) {
    // Could be OpenAI or OpenRouter — check for OpenRouter-specific headers
    if (headers["http-referer"] || headers["x-title"]) {
      return "openrouter";
    }
    return "openai";
  }
  // Default based on auth header format
  const auth = headers["authorization"] || headers["x-api-key"] || "";
  if (auth.includes("sk-ant-")) return "anthropic";
  if (auth.includes("sk-or-")) return "openrouter";
  return "openai";
}

function estimateTokens(body: Record<string, unknown>): number {
  const messages = body.messages as Array<{ content: unknown }> | undefined;
  if (!messages) return 100;

  let charCount = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      charCount += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block === "object" && block !== null && "text" in block) {
          charCount += String((block as { text: string }).text).length;
        }
      }
    }
  }

  // Rough estimate: ~4 chars per token for English, plus expected output
  const inputTokens = Math.ceil(charCount / 4);
  const maxTokens =
    typeof body.max_tokens === "number" ? body.max_tokens : 1024;
  return inputTokens + maxTokens;
}

export function createProxyMiddleware(ctx: ProxyContext) {
  return async (req: Request, res: Response, _next: NextFunction) => {
    const startTime = Date.now();
    const headers = req.headers as Record<string, string>;
    const body = req.body as Record<string, unknown>;
    const provider = detectProvider(req.path, headers);
    const model = (body.model as string) || "unknown";
    const authHeader =
      headers["authorization"] || headers["x-api-key"] || "";

    // === Layer 1: Compliance Check ===
    const complianceResult = ctx.compliance.validate(authHeader, body, provider);
    if (complianceResult.decision === "BLOCK") {
      const latency = Date.now() - startTime;
      const logEntry = {
        provider,
        model,
        status: "blocked_compliance",
        layer: "compliance",
        detail: complianceResult.detail,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        saved_cost_usd: 0,
        latency_ms: latency,
        session_id: (headers["x-session-id"] as string) || null,
        request_hash: null,
      };
      insertLog(ctx.db, logEntry);
      ctx.wsBroadcaster.broadcast("event", { ...logEntry, timestamp: new Date().toISOString() });
      ctx.alerts.send("warning", `Compliance block: ${complianceResult.reason} — ${complianceResult.detail}`);

      res.status(403).json({
        error: {
          type: "compliance_violation",
          message: complianceResult.detail,
          reason: complianceResult.reason,
        },
      });
      return;
    }

    // === Layer 2: Security Check ===
    const messages = (body.messages as unknown[]) || [];
    const securityResult = ctx.security.inspect(messages);
    if (securityResult.decision === "BLOCK") {
      const latency = Date.now() - startTime;
      const mainFinding = securityResult.findings[0];
      const logEntry = {
        provider,
        model,
        status: "blocked_security",
        layer: "security",
        detail: mainFinding?.detail || "Security threat detected",
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        saved_cost_usd: 0,
        latency_ms: latency,
        session_id: (headers["x-session-id"] as string) || null,
        request_hash: null,
      };
      insertLog(ctx.db, logEntry);
      ctx.wsBroadcaster.broadcast("event", { ...logEntry, timestamp: new Date().toISOString() });
      ctx.alerts.send(
        mainFinding?.severity === "CRITICAL" ? "critical" : "warning",
        `Security block: ${mainFinding?.type} — ${mainFinding?.detail}`
      );

      res.status(403).json({
        error: {
          type: "security_threat",
          message: mainFinding?.detail || "Request blocked by security engine",
          findings: securityResult.findings,
        },
      });
      return;
    }

    // === Layer 3: Cost Check ===
    const estimatedTokens = estimateTokens(body);
    const costResult = ctx.cost.evaluate(model, body, estimatedTokens);

    if (costResult.decision === "BLOCK") {
      const latency = Date.now() - startTime;
      const logEntry = {
        provider,
        model,
        status: "blocked_budget",
        layer: "cost",
        detail: costResult.detail,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        saved_cost_usd: 0,
        latency_ms: latency,
        session_id: (headers["x-session-id"] as string) || null,
        request_hash: null,
      };
      insertLog(ctx.db, logEntry);
      ctx.wsBroadcaster.broadcast("event", { ...logEntry, timestamp: new Date().toISOString() });
      ctx.alerts.send("warning", `Cost block: ${costResult.reason} — ${costResult.detail}`);

      res.status(429).json({
        error: {
          type: "budget_exceeded",
          message: costResult.detail,
          reason: costResult.reason,
        },
      });
      return;
    }

    // Apply model downgrade if smart routing kicked in
    const actualModel = costResult.routed_model || model;
    if (costResult.routed_model) {
      (body as Record<string, unknown>).model = costResult.routed_model;
    }

    // === Forward Request ===
    try {
      // Add jitter delay for compliance
      const jitter = ctx.config.compliance.request_jitter_ms;
      const delay =
        Math.floor(Math.random() * (jitter.max - jitter.min)) + jitter.min;
      await new Promise((resolve) => setTimeout(resolve, delay));

      let result;
      switch (provider) {
        case "anthropic":
          result = await forwardToAnthropic(
            ctx.config.providers.anthropic,
            req.path,
            req.method,
            headers,
            body
          );
          break;
        case "openrouter":
          result = await forwardToOpenRouter(
            ctx.config.providers.openrouter,
            req.path,
            req.method,
            headers,
            body
          );
          break;
        default:
          result = await forwardToOpenAI(
            ctx.config.providers.openai,
            req.path,
            req.method,
            headers,
            body
          );
      }

      const latency = Date.now() - startTime;
      const status = costResult.decision === "DOWNGRADE" ? "routed" : "allowed";
      const logEntry = {
        provider,
        model: actualModel,
        status,
        layer: costResult.decision === "DOWNGRADE" ? "cost" : null,
        detail: costResult.detail,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        cost_usd: costResult.estimated_cost,
        saved_cost_usd: costResult.saved_cost,
        latency_ms: latency,
        session_id: (headers["x-session-id"] as string) || null,
        request_hash: null,
      };

      insertLog(ctx.db, logEntry);
      ctx.cost.recordCost(costResult.estimated_cost, costResult.saved_cost);
      ctx.wsBroadcaster.broadcast("event", { ...logEntry, timestamp: new Date().toISOString() });

      res.status(result.status).json(result.body);
    } catch (err) {
      const latency = Date.now() - startTime;
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error";

      insertLog(ctx.db, {
        provider,
        model: actualModel,
        status: "error",
        layer: null,
        detail: errorMessage,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        saved_cost_usd: 0,
        latency_ms: latency,
        session_id: (headers["x-session-id"] as string) || null,
        request_hash: null,
      });

      res.status(502).json({
        error: {
          type: "upstream_error",
          message: `Failed to reach ${provider}: ${errorMessage}`,
        },
      });
    }
  };
}
