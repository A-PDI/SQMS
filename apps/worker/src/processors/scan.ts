import { createNotifications, writeSystemAudit } from "@sqms/server-core";
import type { WorkerContext } from "../context";

/**
 * Scans a quarantined file. Clean files become downloadable; infected files are deleted from storage, marked
 * INFECTED and the uploader is notified. Scanner errors throw so BullMQ retries with backoff; the final failure is
 * recorded as SCAN_FAILED by markScanFailed (files never become available without a clean verdict).
 */
export async function processFileScan(ctx: WorkerContext, fileId: string): Promise<string> {
  const file = await ctx.prisma.fileObject.findUnique({ where: { id: fileId } });
  if (!file) return "missing";
  if (file.status !== "QUARANTINED" && file.status !== "SCAN_FAILED") return `skipped:${file.status}`;
  await ctx.prisma.fileObject.update({ where: { id: fileId }, data: { scanAttempts: { increment: 1 } } });
  const { body } = await ctx.storage.getStream(file.storageKey);
  const verdict = await ctx.scanner.scan(body);
  if (verdict.status === "clean") {
    await ctx.prisma.$transaction(async (tx) => {
      const res = await tx.fileObject.updateMany({ where: { id: fileId, status: { in: ["QUARANTINED", "SCAN_FAILED"] } }, data: { status: "CLEAN", scanEngine: verdict.engine, scannedAt: new Date(), scanSignature: null } });
      if (res.count) await writeSystemAudit(tx, { eventType: "file.scan_clean", entityType: "FILE", entityId: fileId, entityLabel: file.safeFilename, metadata: { engine: verdict.engine } });
    });
    ctx.log("info", "file scanned clean", { fileId, engine: verdict.engine });
    return "clean";
  }
  // Infected: remove content, keep metadata for traceability.
  await ctx.storage.delete(file.storageKey).catch((err) => ctx.log("warn", "failed to delete infected object", { fileId, error: String(err) }));
  const deliveryIds = await ctx.prisma.$transaction(async (tx) => {
    await tx.fileObject.update({ where: { id: fileId }, data: { status: "INFECTED", scanEngine: verdict.engine, scanSignature: verdict.signature, scannedAt: new Date() } });
    await writeSystemAudit(tx, { eventType: "file.infected", entityType: "FILE", entityId: fileId, entityLabel: file.safeFilename, outcome: "DENIED", metadata: { engine: verdict.engine, signature: verdict.signature, sha256: file.sha256 } });
    return createNotifications(
      tx,
      {
        eventType: "file.infected",
        title: `Upload blocked: ${file.safeFilename} failed malware scanning`,
        body: `The file was quarantined and removed (${verdict.signature}). Contact IT security if you believe this is an error.`,
        entityType: "FILE",
        entityId: fileId,
        userIds: [file.uploadedById],
        roleKeys: ["SYSTEM_ADMIN"],
      },
      { portalEnabled: ctx.env.SUPPLIER_PORTAL_ENABLED, mailEnabled: ctx.env.MAIL_TRANSPORT !== "disabled" },
    );
  });
  await Promise.all(deliveryIds.map((id) => ctx.queues.enqueueEmail(id)));
  ctx.log("warn", "file infected", { fileId, signature: verdict.signature });
  return "infected";
}

export async function markScanFailed(ctx: WorkerContext, fileId: string, error: string): Promise<void> {
  await ctx.prisma.$transaction(async (tx) => {
    const res = await tx.fileObject.updateMany({ where: { id: fileId, status: "QUARANTINED" }, data: { status: "SCAN_FAILED" } });
    if (res.count) await writeSystemAudit(tx, { eventType: "file.scan_failed", entityType: "FILE", entityId: fileId, outcome: "FAILURE", metadata: { error: error.slice(0, 500) } });
  });
  ctx.log("error", "file scan failed permanently", { fileId, error });
}
