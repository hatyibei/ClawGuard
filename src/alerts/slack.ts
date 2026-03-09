import type { AlertConfig } from "../config/schema.js";

export async function sendSlackAlert(
  config: AlertConfig["slack"],
  message: string
): Promise<void> {
  if (!config.enabled || !config.webhook_url) return;

  try {
    await fetch(config.webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `🛡️ *ClawGuard Alert*\n\n${message}`,
      }),
    });
  } catch (err) {
    console.error("[ClawGuard] Slack alert failed:", err);
  }
}
