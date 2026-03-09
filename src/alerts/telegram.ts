import type { AlertConfig } from "../config/schema.js";

export async function sendTelegramAlert(
  config: AlertConfig["telegram"],
  message: string
): Promise<void> {
  if (!config.enabled || !config.bot_token || !config.chat_id) return;

  const url = `https://api.telegram.org/bot${config.bot_token}/sendMessage`;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chat_id,
        text: `🛡️ LobsterGate Alert\n\n${message}`,
        parse_mode: "Markdown",
      }),
    });
  } catch (err) {
    console.error("[LobsterGate] Telegram alert failed:", err);
  }
}
