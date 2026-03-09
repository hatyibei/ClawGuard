import express from "express";
import * as path from "node:path";
import * as fs from "node:fs";
import type Database from "better-sqlite3";
import type { LobsterGateConfig } from "../config/schema.js";
import { ComplianceEngine } from "../engines/compliance.js";
import { SecurityEngine } from "../engines/security.js";
import { CostEngine } from "../engines/cost.js";
import { AlertEngine } from "../alerts/index.js";
import { LogQueue } from "../store/log-queue.js";
import { createProxyMiddleware } from "./middleware.js";
import { createDashboardRouter } from "../dashboard/api.js";
import { type WebSocketBroadcaster } from "../dashboard/ws.js";

export function createServer(
  config: LobsterGateConfig,
  db: Database.Database,
  wsBroadcaster: WebSocketBroadcaster
) {
  const app = express();

  // Body parsing
  app.use(express.json({ limit: "10mb" }));

  // CORS for dashboard
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization, x-api-key, anthropic-version, x-session-id"
    );
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Initialize engines
  const compliance = new ComplianceEngine(config.compliance, db);
  const security = new SecurityEngine(config.security);
  const cost = new CostEngine(config.cost, db);
  const alerts = new AlertEngine(config.alerts);
  const logQueue = new LogQueue(db);

  // Health check
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      version: "0.2.0",
      uptime: process.uptime(),
    });
  });

  // Dashboard API
  app.use("/api", createDashboardRouter(config, db));

  // Serve dashboard static files
  const dashboardDir = path.join(
    process.cwd(),
    "dashboard",
    "dist"
  );
  if (fs.existsSync(dashboardDir)) {
    app.use("/dashboard", express.static(dashboardDir));
    app.get("/dashboard/*", (_req, res) => {
      res.sendFile(path.join(dashboardDir, "index.html"));
    });
  }

  const proxyCtx = {
    config,
    db,
    compliance,
    security,
    cost,
    alerts,
    wsBroadcaster,
    logQueue,
  };

  // Proxy routes — Anthropic API compatible
  app.post("/v1/messages", createProxyMiddleware(proxyCtx));

  // OpenAI API compatible
  app.post("/v1/chat/completions", createProxyMiddleware(proxyCtx));

  // Catch-all for unsupported routes
  app.use((_req, res) => {
    res.status(404).json({
      error: {
        type: "not_found",
        message: "LobsterGate proxy: endpoint not found. Supported: POST /v1/messages, POST /v1/chat/completions",
      },
    });
  });

  // Expose logQueue for shutdown
  (app as unknown as Record<string, unknown>)._logQueue = logQueue;

  return app;
}
