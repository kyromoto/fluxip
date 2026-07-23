import nodemailer, { type Transporter } from "nodemailer";
import type { Config } from "../../config/env.js";
import { EMAIL_NOTIFICATION_CHANNEL_TYPE } from "../../domain/notification-channel/events.js";
import type { NotificationChannel, NotificationMessage } from "../../ports/notification-channel.js";

/** SMTP relay/transport settings are deployment config (env vars); the vendor/self-hosted choice is not baked in (research.md §13). */
export class EmailNotifier implements NotificationChannel {
  readonly type = EMAIL_NOTIFICATION_CHANNEL_TYPE;
  private readonly transporter: Transporter;
  private readonly fromAddress: string;

  constructor(config: Config) {
    this.transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPassword } : undefined,
    });
    this.fromAddress = config.notificationFromAddress;
  }

  async send(message: NotificationMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.fromAddress,
      to: message.addresses.join(", "),
      subject: message.subject,
      text: message.body,
    });
  }
}
