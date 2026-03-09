import { z } from "zod";

export const ComplianceConfigSchema = z.object({
  block_oauth_tokens: z.boolean().default(true),
  rate_limit_safety_margin: z.number().min(0).max(1).default(0.8),
  request_jitter_ms: z
    .object({
      min: z.number().default(50),
      max: z.number().default(500),
    })
    .default({}),
  dedup_window_seconds: z.number().default(30),
  dedup_max_repeats: z.number().default(3),
  daily_request_cap: z.number().default(5000),
});

export const SecurityConfigSchema = z.object({
  outbound_blocklist: z
    .object({
      domains: z.array(z.string()).default([
        "*.pastebin.com",
        "*.ngrok.io",
        "*.ngrok-free.app",
        "*.serveo.net",
        "*.localtunnel.me",
        "*.requestbin.com",
        "*.webhook.site",
        "*.pipedream.net",
        "*.burpcollaborator.net",
        "*.interact.sh",
        "*.oast.fun",
        "*.oast.pro",
      ]),
      ip_ranges: z.array(z.string()).default([]),
      auto_update: z.boolean().default(false),
    })
    .default({}),
  exfiltration_detection: z
    .object({
      enabled: z.boolean().default(true),
      patterns: z.array(z.string()).default([]),
      action: z.enum(["block", "alert", "redact"]).default("block"),
    })
    .default({}),
  prompt_injection: z
    .object({
      enabled: z.boolean().default(true),
      sensitivity: z.enum(["low", "medium", "high"]).default("medium"),
    })
    .default({}),
});

export const CostConfigSchema = z.object({
  budget: z
    .object({
      daily_limit_usd: z.number().default(15),
      monthly_limit_usd: z.number().default(300),
      warning_threshold: z.number().min(0).max(1).default(0.8),
    })
    .default({}),
  loop_detection: z
    .object({
      hash_window_seconds: z.number().default(300),
      max_repeats: z.number().default(5),
      cost_spiral_threshold_usd: z.number().default(3),
      cost_spiral_window_seconds: z.number().default(300),
    })
    .default({}),
  smart_routing: z
    .object({
      enabled: z.boolean().default(true),
      downgrade_threshold_tokens: z.number().default(200),
    })
    .default({}),
  unified_budget: z.boolean().default(true),
  per_session_tracking: z.boolean().default(true),
  predictive_stop: z
    .object({
      enabled: z.boolean().default(false),
      lookback_minutes: z.number().default(30),
      confidence_threshold: z.number().default(0.85),
    })
    .default({}),
  anomaly_detection: z
    .object({
      enabled: z.boolean().default(false),
      baseline_days: z.number().default(7),
      sigma_threshold: z.number().default(3),
    })
    .default({}),
});

export const AlertConfigSchema = z.object({
  telegram: z
    .object({
      enabled: z.boolean().default(false),
      bot_token: z.string().default(""),
      chat_id: z.string().default(""),
    })
    .default({}),
  slack: z
    .object({
      enabled: z.boolean().default(false),
      webhook_url: z.string().default(""),
    })
    .default({}),
  email: z
    .object({
      enabled: z.boolean().default(false),
      smtp_host: z.string().default(""),
      smtp_port: z.number().default(587),
      smtp_user: z.string().default(""),
      smtp_pass: z.string().default(""),
      from: z.string().default(""),
      to: z.string().default(""),
    })
    .default({}),
  webhook: z
    .object({
      enabled: z.boolean().default(false),
      url: z.string().default(""),
    })
    .default({}),
});

export const ProviderConfigSchema = z.object({
  anthropic: z
    .object({
      api_key: z.string().default(""),
      base_url: z.string().default("https://api.anthropic.com"),
    })
    .default({}),
  openai: z
    .object({
      api_key: z.string().default(""),
      base_url: z.string().default("https://api.openai.com"),
    })
    .default({}),
  openrouter: z
    .object({
      api_key: z.string().default(""),
      base_url: z.string().default("https://openrouter.ai/api"),
    })
    .default({}),
});

export const ClawGuardConfigSchema = z.object({
  port: z.number().default(4200),
  data_dir: z.string().default("./data"),
  dashboard_password: z.string().default(""),
  jwt_secret: z.string().default(""),
  compliance: ComplianceConfigSchema.default({}),
  security: SecurityConfigSchema.default({}),
  cost: CostConfigSchema.default({}),
  alerts: AlertConfigSchema.default({}),
  providers: ProviderConfigSchema.default({}),
});

export type ClawGuardConfig = z.infer<typeof ClawGuardConfigSchema>;
export type ComplianceConfig = z.infer<typeof ComplianceConfigSchema>;
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;
export type CostConfig = z.infer<typeof CostConfigSchema>;
export type AlertConfig = z.infer<typeof AlertConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
