import type { Request, Response, NextFunction } from "express";
import type Database from "better-sqlite3";
import type { LobsterGateConfig } from "../config/schema.js";
import { ComplianceEngine } from "../engines/compliance.js";
import { SecurityEngine } from "../engines/security.js";
import { CostEngine } from "../engines/cost.js";
import { AlertEngine } from "../alerts/index.js";
import { LogQueue } from "../store/log-queue.js";
import { forwardToAnthropic } from "./providers/anthropic.js";
import { forwardToOpenAI } from "./providers/openai.js";
import { forwardToOpenRouter } from "./providers/openrouter.js";
import type { WebSocketBroadcaster } from "../dashboard/ws.js";

interface ProxyContext {
  config: LobsterGateConfig;
  db: Database.Database;
  compliance: ComplianceEngine;
  security: SecurityEngine;
  cost: CostEngine;
  alerts: AlertEngine;
  wsBroadcaster: WebSocketBroadcaster;
  logQueue: LogQueue;
}

function detectProvider(path: string, headers: Record<string, string>): string {
  if (path.startsWith("/v1/messages") || headers["anthropic-version"]) {
    return "anthropic";
  }
  if (path.startsWith("/v1/chat/completions")) {
    if (headers["http-referer"] || headers["x-title"]) {
      return "openrouter";
    }
    return "openai";
  }
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

  // ~3.5 chars per token for mixed English/CJK, plus expected output
  const inputTokens = Math.ceil(charCount / 3.5);
  const maxTokens =
    typeof body.max_tokens === "number" ? body.max_tokens : 1024;
  return inputTokens + maxTokens;
}

/**
 * Generate a Self-Healing response that looks like a real LLM response.
 * Instead of returning raw HTTP errors that crash agentic loops,
 * we return a 200 OK with an LLM-formatted message that guides the
 * agent to self-correct.
 */
function buildSelfHealingResponse(
  provider: string,
  reason: string,
  detail: string,
  layer: string
): { body: unknown; contentType: string } {
  const systemMessage =
    `[LobsterGate System Override] Your request was intercepted by the safety proxy. ` +
    `Reason: ${detail}. ` +
    `Please adjust your approach and continue the task using an alternative method. ` +
    `Do NOT retry the same request.`;

  if (provider === "anthropic") {
    // Anthropic Messages API format
    return {
      contentType: "application/json",
      body: {
        id: `msg_lobstergate_${Date.now()}`,
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: systemMessage }],
        model: "lobstergate-safety-proxy",
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    };
  }

  // OpenAI / OpenRouter format
  return {
    contentType: "application/json",
    body: {
      id: `chatcmpl-lobstergate-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "lobstergate-safety-proxy",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: systemMessage },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    },
  };
}

/**
 * Parse SSE chunks from a streaming response to extract usage data and
 * response text for security scanning.
 */
function createStreamTap(
  provider: string,
  onChunk: (text: string) => void,
  onUsage: (input: number, output: number) => void
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = "";

  return new TransformStream({
    transform(chunk, controller) {
      // Pass through immediately — zero-copy for the client
      controller.enqueue(chunk);

      // Tap: parse SSE events in background for telemetry
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;

          // Extract text from Anthropic delta
          if (provider === "anthropic") {
            const delta = parsed.delta as { text?: string } | undefined;
            if (delta?.text) onChunk(delta.text);
            // Anthropic sends usage in message_delta event
            const usage = parsed.usage as
              | { input_tokens?: number; output_tokens?: number }
              | undefined;
            if (usage) {
              onUsage(usage.input_tokens || 0, usage.output_tokens || 0);
            }
          } else {
            // OpenAI format
            const choices = parsed.choices as
              | Array<{ delta?: { content?: string } }>
              | undefined;
            if (choices?.[0]?.delta?.content) {
              onChunk(choices[0].delta.content);
            }
            const usage = parsed.usage as
              | { prompt_tokens?: number; completion_tokens?: number }
              | undefined;
            if (usage) {
              onUsage(usage.prompt_tokens || 0, usage.completion_tokens || 0);
            }
          }
        } catch {
          // Malformed SSE data — skip silently
        }
      }
    },
  });
}

export function createProxyMiddleware(ctx: ProxyContext) {
  return async (req: Request, res: Response, _next: NextFunction) => {
    const startTime = Date.now();
    const headers = req.headers as Record<string, string>;
    const body = req.body as Record<string, unknown>;
    const provider = detectProvider(req.path, headers);
    const model = (body.model as string) || "unknown";
    const isStream = body.stream === true;
    const authHeader =
      headers["authorization"] || headers["x-api-key"] || "";
    const sessionId = (headers["x-session-id"] as string) || null;

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
        session_id: sessionId,
        request_hash: null,
      };
      ctx.logQueue.enqueue(logEntry);
      ctx.wsBroadcaster.broadcast("event", { ...logEntry, timestamp: new Date().toISOString() });
      ctx.alerts.send("warning", `Compliance block: ${complianceResult.reason} — ${complianceResult.detail}`);

      // Self-Healing: return LLM-formatted response instead of raw 403
      const healing = buildSelfHealingResponse(
        provider,
        complianceResult.reason || "compliance_violation",
        complianceResult.detail || "Request blocked by compliance engine",
        "compliance"
      );
      res.status(200).set("Content-Type", healing.contentType).json(healing.body);
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
        session_id: sessionId,
        request_hash: null,
      };
      ctx.logQueue.enqueue(logEntry);
      ctx.wsBroadcaster.broadcast("event", { ...logEntry, timestamp: new Date().toISOString() });
      ctx.alerts.send(
        mainFinding?.severity === "CRITICAL" ? "critical" : "warning",
        `Security block: ${mainFinding?.type} — ${mainFinding?.detail}`
      );

      // Self-Healing: return LLM-formatted response
      const healing = buildSelfHealingResponse(
        provider,
        mainFinding?.type || "security_threat",
        mainFinding?.detail || "Request blocked by security engine",
        "security"
      );
      res.status(200).set("Content-Type", healing.contentType).json(healing.body);
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
        session_id: sessionId,
        request_hash: null,
      };
      ctx.logQueue.enqueue(logEntry);
      ctx.wsBroadcaster.broadcast("event", { ...logEntry, timestamp: new Date().toISOString() });
      ctx.alerts.send("warning", `Cost block: ${costResult.reason} — ${costResult.detail}`);

      // Self-Healing: return LLM-formatted response
      const healing = buildSelfHealingResponse(
        provider,
        costResult.reason || "budget_exceeded",
        costResult.detail || "Request blocked by cost engine",
        "cost"
      );
      res.status(200).set("Content-Type", healing.contentType).json(healing.body);
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
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      let result;
      switch (provider) {
        case "anthropic":
          result = await forwardToAnthropic(
            ctx.config.providers.anthropic,
            req.path,
            req.method,
            headers,
            body,
            isStream
          );
          break;
        case "openrouter":
          result = await forwardToOpenRouter(
            ctx.config.providers.openrouter,
            req.path,
            req.method,
            headers,
            body,
            isStream
          );
          break;
        default:
          result = await forwardToOpenAI(
            ctx.config.providers.openai,
            req.path,
            req.method,
            headers,
            body,
            isStream
          );
      }

      if (result.isStream) {
        // === SSE Streaming Mode ===
        // Set SSE headers
        res.writeHead(result.status, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          ...filterResponseHeaders(result.headers),
        });

        // Tap the stream to extract usage data and scan response text
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        const responseChunks: string[] = [];

        const tap = createStreamTap(
          provider,
          (text) => responseChunks.push(text),
          (input, output) => {
            if (input > 0) totalInputTokens = input;
            if (output > 0) totalOutputTokens = output;
          }
        );

        const pipedStream = result.stream.pipeThrough(tap);
        const reader = pipedStream.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        } finally {
          res.end();
        }

        // Post-stream: log, scan response, record cost
        const latency = Date.now() - startTime;
        const status = costResult.decision === "DOWNGRADE" ? "routed" : "allowed";

        // Scan accumulated response text for credential leaks
        const fullResponseText = responseChunks.join("");
        if (fullResponseText.length > 0) {
          const responseFindings = ctx.security.scanText(fullResponseText);
          if (responseFindings.length > 0) {
            ctx.alerts.send(
              "critical",
              `Response security scan: ${responseFindings.map((f) => f.detail).join("; ")}`
            );
          }
        }

        const logEntry = {
          provider,
          model: actualModel,
          status,
          layer: costResult.decision === "DOWNGRADE" ? "cost" : null,
          detail: costResult.detail,
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
          cost_usd: costResult.estimated_cost,
          saved_cost_usd: costResult.saved_cost,
          latency_ms: latency,
          session_id: sessionId,
          request_hash: null,
        };
        ctx.logQueue.enqueue(logEntry);
        ctx.cost.recordCost(costResult.estimated_cost, costResult.saved_cost);
        ctx.wsBroadcaster.broadcast("event", { ...logEntry, timestamp: new Date().toISOString() });
      } else {
        // === Non-streaming mode ===
        const latency = Date.now() - startTime;
        const status = costResult.decision === "DOWNGRADE" ? "routed" : "allowed";

        // Scan response body for credential leaks
        const responseText = JSON.stringify(result.body);
        const responseFindings = ctx.security.scanText(responseText);
        if (responseFindings.length > 0) {
          ctx.alerts.send(
            "critical",
            `Response security scan: ${responseFindings.map((f) => f.detail).join("; ")}`
          );
        }

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
          session_id: sessionId,
          request_hash: null,
        };
        ctx.logQueue.enqueue(logEntry);
        ctx.cost.recordCost(costResult.estimated_cost, costResult.saved_cost);
        ctx.wsBroadcaster.broadcast("event", { ...logEntry, timestamp: new Date().toISOString() });

        res.status(result.status).json(result.body);
      }
    } catch (err) {
      const latency = Date.now() - startTime;
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error";

      ctx.logQueue.enqueue({
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
        session_id: sessionId,
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

/** Filter out hop-by-hop headers that shouldn't be forwarded */
function filterResponseHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const hop = new Set([
    "connection",
    "keep-alive",
    "transfer-encoding",
    "te",
    "trailer",
    "upgrade",
    "content-length",
    "content-encoding",
  ]);
  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!hop.has(k.toLowerCase())) {
      filtered[k] = v;
    }
  }
  return filtered;
}
