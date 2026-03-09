import type { AlertConfig } from "../config/schema.js";

export async function sendEmailAlert(
  config: AlertConfig["email"],
  subject: string,
  message: string
): Promise<void> {
  if (!config.enabled || !config.smtp_host) return;

  try {
    // Dynamic import to avoid requiring nodemailer when not used
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: config.smtp_host,
      port: config.smtp_port,
      auth: {
        user: config.smtp_user,
        pass: config.smtp_pass,
      },
    });

    await transporter.sendMail({
      from: config.from,
      to: config.to,
      subject: `[ClawGuard] ${subject}`,
      text: message,
    });
  } catch (err) {
    console.error("[ClawGuard] Email alert failed:", err);
  }
}
