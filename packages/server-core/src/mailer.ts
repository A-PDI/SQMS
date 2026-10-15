/**
 * Email delivery adapter. SMTP is the initial implementation (Mailpit locally); Microsoft Graph, SendGrid or other
 * providers can be added by implementing EmailAdapter without changing callers.
 */
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailSendResult {
  providerMessageId: string | null;
}

export interface EmailAdapter {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
  verify(): Promise<boolean>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  user?: string;
  password?: string;
  from: string;
}

export class SmtpEmailAdapter implements EmailAdapter {
  readonly name = "smtp";
  private readonly transporter: nodemailer.Transporter<SMTPTransport.SentMessageInfo>;

  constructor(private readonly cfg: SmtpConfig) {
    const options: SMTPTransport.Options = {
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      requireTLS: cfg.requireTLS,
      auth: cfg.user ? { user: cfg.user, pass: cfg.password ?? "" } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    };
    this.transporter = nodemailer.createTransport(options);
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const info = await this.transporter.sendMail({ from: this.cfg.from, to: message.to, subject: message.subject, text: message.text, html: message.html });
    return { providerMessageId: info.messageId ?? null };
  }

  async verify(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch {
      return false;
    }
  }
}

/** Used when MAIL_TRANSPORT=disabled: deliveries are recorded as SKIPPED. */
export class DisabledEmailAdapter implements EmailAdapter {
  readonly name = "disabled";
  async send(): Promise<EmailSendResult> {
    throw new Error("Email transport is disabled");
  }
  async verify(): Promise<boolean> {
    return false;
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Renders a plain, safe notification email (all dynamic content is escaped). */
export function renderNotificationEmail(input: { productName: string; title: string; body?: string | null; link?: string | null }): { subject: string; text: string; html: string } {
  const subject = `[${input.productName}] ${input.title}`;
  const text = [input.title, "", input.body ?? "", input.link ? `Open: ${input.link}` : ""].join("\n").trim();
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a202c">
<p style="font-size:16px;font-weight:bold">${escapeHtml(input.title)}</p>
${input.body ? `<p>${escapeHtml(input.body).replace(/\n/g, "<br>")}</p>` : ""}
${input.link ? `<p><a href="${escapeHtml(input.link)}">Open in ${escapeHtml(input.productName)}</a></p>` : ""}
<p style="color:#718096;font-size:12px">This is an automated message from ${escapeHtml(input.productName)}.</p>
</body></html>`;
  return { subject, text, html };
}
