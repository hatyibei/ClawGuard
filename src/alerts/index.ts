import type { AlertConfig } from "../config/schema.js";
import { sendTelegramAlert } from "./telegram.js";
import { sendSlackAlert } from "./slack.js";
import { sendEmailAlert } from "./email.js";

export type AlertSeverity = "info" | "warning" | "critical";

export class AlertEngine {
  private config: AlertConfig;
  private webhookUrl: string;

  constructor(config: AlertConfig) {
    this.config = config;
    this.webhookUrl = config.webhook.url;
  }

  async send(severity: AlertSeverity, message: string): Promise<void> {
    const prefix = severity === "critical" ? "CRITICAL" : severity === "warning" ? "WARNING" : "INFO";
    const fullMessage = `[${prefix}] ${message}`;

    console.log(`[ClawGuard Alert] ${fullMessage}`);

    const promises: Promise<void>[] = [];

    if (this.config.telegram.enabled) {
      promises.push(sendTelegramAlert(this.config.telegram, fullMessage));
    }
    if (this.config.slack.enabled) {
      promises.push(sendSlackAlert(this.config.slack, fullMessage));
    }
    if (this.config.email.enabled) {
      promises.push(
        sendEmailAlert(this.config.email, `${prefix}: ClawGuard Alert`, fullMessage)
      );
    }
    if (this.config.webhook.enabled && this.webhookUrl) {
      promises.push(this.sendWebhook(severity, message));
    }

    await Promise.allSettled(promises);
  }

  private async sendWebhook(severity: AlertSeverity, message: string): Promise<void> {
    try {
      await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "clawguard",
          severity,
          message,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch (err) {
      console.error("[ClawGuard] Webhook alert failed:", err);
    }
  }
}
