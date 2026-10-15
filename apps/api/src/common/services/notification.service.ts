import { Inject, Injectable } from "@nestjs/common";
import { createNotifications, QueueRegistry, resolveRecipients, type AppEnv, type NotificationInput } from "@sqms/server-core";
import { APP_ENV, QUEUES } from "../../infra/tokens";
import type { AfterCommit, Tx } from "../db/db.service";

export type NotifyInput = NotificationInput;

/**
 * Creates in-app notifications and email deliveries inside the business transaction. Email jobs are enqueued
 * after commit; the worker also sweeps PENDING deliveries, so a failed enqueue is retried automatically.
 */
@Injectable()
export class NotificationService {
  constructor(
    @Inject(QUEUES) private readonly queues: QueueRegistry,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  private get opts() {
    return { portalEnabled: this.env.SUPPLIER_PORTAL_ENABLED, mailEnabled: this.env.MAIL_TRANSPORT !== "disabled" };
  }

  resolveRecipients(tx: Tx, input: Pick<NotifyInput, "userIds" | "roleKeys" | "organizationId" | "excludeUserIds">) {
    return resolveRecipients(tx, input, this.opts);
  }

  async notify(tx: Tx, after: AfterCommit, input: NotifyInput): Promise<number> {
    const deliveryIds = await createNotifications(tx, input, this.opts);
    if (deliveryIds.length) after.add(() => Promise.all(deliveryIds.map((id) => this.queues.enqueueEmail(id))));
    return deliveryIds.length;
  }

  /** Transactional email not tied to an in-app notification (password reset, invitations). Body is purged after send. */
  async sendDirectEmail(tx: Tx, after: AfterCommit, input: { to: string; subject: string; body: string }): Promise<void> {
    if (this.env.MAIL_TRANSPORT === "disabled") return;
    const d = await tx.notificationDelivery.create({
      data: { kind: "DIRECT", channel: "EMAIL", recipient: input.to, subject: input.subject.slice(0, 300), body: input.body },
    });
    after.add(() => this.queues.enqueueEmail(d.id));
  }
}
