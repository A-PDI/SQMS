import { Injectable } from "@nestjs/common";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { EntityType } from "@sqms/db";
import type { Actor } from "../../common/auth/actor";
import { DbService } from "../../common/db/db.service";
import { FilesService } from "../files/files.service";
import { object } from "./operations.rules";

/** Renderers receive only authorized, scanned files staged in a request-owned temporary directory. */
@Injectable()
export class EvidenceService {
  constructor(
    private readonly db: DbService,
    private readonly files: FilesService,
  ) {}
  async render<T>(
    actor: Actor,
    type: EntityType,
    id: string,
    render: (images: any[]) => Promise<T>,
  ): Promise<T> {
    await this.files.listAttachments(actor, type, id);
    const attachments = await this.db.client.recordAttachment.findMany({
      where: { entityType: type, entityId: id, removedAt: null },
      include: { file: true },
    });
    const inspection =
      type === "INCOMING_INSPECTION"
        ? await this.db.client.incomingInspection.findUnique({
            where: { id },
            select: { planSnapshot: true },
          })
        : null;
    const definitions = object(object(inspection?.planSnapshot).sections);
    const dir = await mkdtemp(path.join(tmpdir(), "sqms-report-"));
    try {
      const images: any[] = [];
      for (const att of attachments) {
        if (
          !att.file.contentType.startsWith("image/") ||
          att.file.status !== "CLEAN"
        )
          continue;
        const { body } = await this.files.open(actor, att.file.id, "download");
        const chunks: Buffer[] = [];
        for await (const chunk of body as AsyncIterable<Buffer>)
          chunks.push(Buffer.from(chunk));
        const filePath = path.join(dir, att.file.id);
        await writeFile(filePath, Buffer.concat(chunks), { mode: 0o600 });
        const context = object(att.context);
        const sectionKey = context.sectionKey;
        const shared =
          sectionKey === "receiving" ||
          String(definitions[sectionKey]?.title ?? "")
            .toUpperCase()
            .includes("RECEIVING");
        const renderKey =
          context.itemPosition > 0 && sectionKey && !shared
            ? `item${context.itemPosition}__${sectionKey}`
            : (sectionKey ?? null);
        images.push({
          file_path: filePath,
          file_name: att.file.originalFilename,
          mime_type: att.file.contentType,
          caption: att.description ?? "",
          section_key: renderKey,
          section_id: context.reportSectionId ?? null,
          item_id: context.rowId == null ? null : String(context.rowId),
        });
      }
      return await render(images);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
