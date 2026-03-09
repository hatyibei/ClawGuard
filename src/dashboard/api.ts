import { Router } from "express";
import type Database from "better-sqlite3";
import type { LobsterGateConfig } from "../config/schema.js";
import { getRecentLogs, getDailyStats } from "../store/logs.js";
import { getBudgetState } from "../store/budget.js";

export function createDashboardRouter(
  config: LobsterGateConfig,
  db: Database.Database
) {
  const router = Router();

  // Dashboard auth middleware (simple password check)
  router.use((req, res, next) => {
    // Allow unauthenticated access if no password set
    if (!config.dashboard_password) {
      next();
      return;
    }

    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const token = auth.slice(7);
    if (token !== config.dashboard_password) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    next();
  });

  // GET /api/stats — Daily statistics
  router.get("/stats", (_req, res) => {
    const stats = getDailyStats(db);
    const budget = getBudgetState(db);
    res.json({
      ...stats,
      budget: {
        daily_spent: budget.daily_spent_usd,
        daily_limit: config.cost.budget.daily_limit_usd,
        monthly_spent: budget.monthly_spent_usd,
        monthly_limit: config.cost.budget.monthly_limit_usd,
        daily_saved: budget.daily_saved_usd,
      },
    });
  });

  // GET /api/logs — Recent request logs
  router.get("/logs", (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const status = req.query.status as string | undefined;
    const logs = getRecentLogs(db, Math.min(limit, 500), status);
    res.json(logs);
  });

  // GET /api/config — Current config (sanitized, no secrets)
  router.get("/config", (_req, res) => {
    res.json({
      compliance: config.compliance,
      security: {
        ...config.security,
        outbound_blocklist: {
          ...config.security.outbound_blocklist,
          domains_count: config.security.outbound_blocklist.domains.length,
        },
      },
      cost: config.cost,
    });
  });

  // GET /api/health — Proxy health
  router.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      uptime: process.uptime(),
      version: "0.1.0",
    });
  });

  return router;
}
