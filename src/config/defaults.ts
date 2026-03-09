import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { ClawGuardConfigSchema, type ClawGuardConfig } from "./schema.js";

export function loadConfig(): ClawGuardConfig {
  const env = process.env;

  const raw: Record<string, unknown> = {};

  // Try loading config file
  const configPaths = [
    env.CLAWGUARD_CONFIG,
    path.join(process.cwd(), "clawguard.json"),
    path.join(env.HOME || "/", ".config", "clawguard", "config.json"),
  ].filter(Boolean) as string[];

  for (const cfgPath of configPaths) {
    try {
      const content = fs.readFileSync(cfgPath, "utf-8");
      Object.assign(raw, JSON.parse(content));
      break;
    } catch {
      // continue
    }
  }

  // Env overrides
  if (env.CLAWGUARD_PORT) raw.port = parseInt(env.CLAWGUARD_PORT, 10);
  if (env.CLAWGUARD_DATA_DIR) raw.data_dir = env.CLAWGUARD_DATA_DIR;
  if (env.DASHBOARD_PASSWORD) raw.dashboard_password = env.DASHBOARD_PASSWORD;

  // Provider keys from env
  const providers = (raw.providers || {}) as Record<string, Record<string, string>>;
  if (env.ANTHROPIC_API_KEY) {
    providers.anthropic = { ...providers.anthropic, api_key: env.ANTHROPIC_API_KEY };
  }
  if (env.OPENAI_API_KEY) {
    providers.openai = { ...providers.openai, api_key: env.OPENAI_API_KEY };
  }
  if (env.OPENROUTER_API_KEY) {
    providers.openrouter = { ...providers.openrouter, api_key: env.OPENROUTER_API_KEY };
  }
  raw.providers = providers;

  // Alert config from env
  const alerts = (raw.alerts || {}) as Record<string, Record<string, unknown>>;
  if (env.TELEGRAM_BOT_TOKEN) {
    alerts.telegram = {
      ...alerts.telegram,
      enabled: true,
      bot_token: env.TELEGRAM_BOT_TOKEN,
      chat_id: env.TELEGRAM_CHAT_ID || "",
    };
  }
  if (env.SLACK_WEBHOOK_URL) {
    alerts.slack = {
      ...alerts.slack,
      enabled: true,
      webhook_url: env.SLACK_WEBHOOK_URL,
    };
  }
  raw.alerts = alerts;

  // Generate JWT secret if not set
  if (!raw.jwt_secret) {
    raw.jwt_secret = crypto.randomBytes(64).toString("hex");
  }

  return ClawGuardConfigSchema.parse(raw);
}
