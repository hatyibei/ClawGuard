#!/usr/bin/env node

import * as http from "node:http";
import { loadConfig } from "./config/defaults.js";
import { getDb, closeDb } from "./store/db.js";
import { createServer } from "./proxy/server.js";
import { createWebSocketServer } from "./dashboard/ws.js";

function main() {
  console.log(`
  ┌─────────────────────────────────────┐
  │         🛡️  ClawGuard v0.1.0        │
  │   Safety Proxy for OpenClaw         │
  │                                     │
  │   ToS Compliance + Security         │
  │   + Cost Control                    │
  └─────────────────────────────────────┘
  `);

  const config = loadConfig();
  const db = getDb(config.data_dir);

  console.log(`[ClawGuard] Data directory: ${config.data_dir}`);
  console.log(`[ClawGuard] Dashboard password: ${config.dashboard_password ? "SET" : "NOT SET (open access)"}`);

  // Create Express app
  const app = createServer(config, db, { broadcast: () => {} });

  // Create HTTP server
  const server = http.createServer(app);

  // Attach WebSocket server
  const wsBroadcaster = createWebSocketServer(server);

  // Re-create the app with the real WS broadcaster
  const appWithWs = createServer(config, db, wsBroadcaster);
  server.removeAllListeners("request");
  server.on("request", appWithWs);

  // Start listening
  server.listen(config.port, () => {
    console.log(`[ClawGuard] Proxy listening on http://localhost:${config.port}`);
    console.log(`[ClawGuard] Dashboard: http://localhost:${config.port}/dashboard`);
    console.log(`[ClawGuard] WebSocket: ws://localhost:${config.port}/ws`);
    console.log("");
    console.log("[ClawGuard] Configure OpenClaw:");
    console.log(`  { "baseUrl": "http://localhost:${config.port}/v1" }`);
    console.log("");

    // Log provider status
    const providers = config.providers;
    const active = [];
    if (providers.anthropic.api_key) active.push("Anthropic");
    if (providers.openai.api_key) active.push("OpenAI");
    if (providers.openrouter.api_key) active.push("OpenRouter");
    if (active.length > 0) {
      console.log(`[ClawGuard] Active providers: ${active.join(", ")}`);
    } else {
      console.log("[ClawGuard] No provider API keys configured — proxy will forward auth headers from client");
    }

    console.log("[ClawGuard] Ready. All requests are protected by 3-layer defense.");
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n[ClawGuard] Shutting down...");
    server.close(() => {
      closeDb();
      console.log("[ClawGuard] Goodbye.");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
