import { renderNotificationEmail } from "@sqms/server-core";
import type { WorkerContext } from "../context";

/**
 * Sends one email delivery. Successful sends record the provider message id; DIRECT deliveries (password reset,
 * invitations) have their body purged after sending so secrets do not persist in the database. Failures update
 * attempts/lastError and rethrow so BullMQ retries with exponential backoff; markEmailFailed records the final failure.
 */
export async function processEmail(ctx: WorkerContext, deliveryId: string): Promise<string> {
  const d = await ctx.prisma.notificationDelivery.findUnique({ where: { id: deliveryId }, include: { notification: true } });
  if (!d) return "missing";
  if (d.status === "SENT" || d.status === "SKIPPED" || d.status === "FAILED") return `skipped:${d.status}`;
  if (ctx.env.MAIL_TRANSPORT === "disabled") {
    await ctx.prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: "SKIPPED", body: null, lastError: "Mail transport disabled" } });
    return "skipped:disabled";
  }
  let subject: string;
  let text: string;
  let html: string | undefined;
  if (d.kind === "DIRECT") {
    if (!d.subject || !d.body) {
      await ctx.prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: "FAILED", lastError: "Direct delivery has no content" } });
      return "failed:no-content";
    }
    subject = d.subject;
    text = d.body;
  } else {
    if (!d.notification) return "missing-notification";
    const branding = await ctx.prisma.systemSetting.findUnique({ where: { key: "branding" } });
    const productName = (branding?.value as { shortName?: string; productName?: string } | null)?.shortName ?? "SQMS";
    const link = d.notification.link ? `${ctx.env.APP_BASE_URL.replace(/\/$/, "")}${d.notification.link}` : null;
    const rendered = renderNotificationEmail({ productName, title: d.notification.title, body: d.notification.body, link });
    subject = rendered.subject;
    text = rendered.text;
    html = rendered.html;
  }
  await ctx.prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: "QUEUED", queuedAt: d.queuedAt ?? new Date(), attempts: { increment: 1 } } });
  try {
    const result = await ctx.mailer.send({ to: d.recipient, subject, text, html });
    await ctx.prisma.notificationDelivery.update({
      where: { id: d.id },
      data: { status: "SENT", sentAt: new Date(), providerMessageId: result.providerMessageId, lastError: null, ...(d.kind === "DIRECT" ? { body: null } : {}) },
    });
    ctx.log("info", "email sent", { deliveryId: d.id, kind: d.kind });
    return "sent";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: "PENDING", lastError: message.slice(0, 2000) } });
    ctx.log("warn", "email send failed (will retry)", { deliveryId: d.id, error: message });
    throw err;
  }
}

export async function markEmailFailed(ctx: WorkerContext, deliveryId: string, error: string): Promise<void> {
  await ctx.prisma.notificationDelivery.updateMany({ where: { id: deliveryId, status: { in: ["PENDING", "QUEUED"] } }, data: { status: "FAILED", lastError: error.slice(0, 2000), body: null } });
  ctx.log("error", "email delivery failed permanently", { deliveryId, error });
}
