import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Min,
} from "class-validator";
import type { Response } from "express";
import { Prisma } from "@sqms/db";
import { readPartWorkbook, writePartWorkbook } from "@sqms/legacy-domain";
import type { Actor } from "../../common/auth/actor";
import { CurrentActor, RequirePermissions } from "../../common/auth/decorators";
import { AuditService } from "../../common/audit/audit.service";
import { DbService } from "../../common/db/db.service";
import {
  BusinessRuleError,
  StaleVersionError,
} from "../../common/errors/app-errors";
import { FilesService } from "../files/files.service";
import { object } from "./operations.rules";

class SpecificationQuery {
  @IsOptional() @IsUUID() internalPartId?: string;
  @IsOptional() @IsUUID() planRevisionId?: string;
}
class SpecificationDto {
  @IsUUID() internalPartId: string;
  @IsUUID() planRevisionId: string;
  @IsObject() data: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
}
class WorkbookDto {
  @IsUUID() fileId: string;
  @IsBoolean() commit: boolean;
}
@Injectable()
export class SpecificationsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}
  list(q: SpecificationQuery) {
    return this.db.client.partInspectionSpecification.findMany({
      where: q,
      include: {
        internalPart: true,
        planRevision: { include: { plan: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 5000,
    });
  }
  async save(actor: Actor, d: SpecificationDto) {
    return this.db.tx(async (tx) => {
      const key = {
        internalPartId: d.internalPartId,
        planRevisionId: d.planRevisionId,
      };
      const before = await tx.partInspectionSpecification.findUnique({
        where: { internalPartId_planRevisionId: key },
      });
      if (before && before.version !== d.expectedVersion)
        throw new StaleVersionError("Part specification");
      const p = await tx.inspectionPlanRevision.findUnique({
        where: { id: d.planRevisionId },
      });
      if (!p) throw new BusinessRuleError("Plan revision is missing");
      if (before) {
        const changed = await tx.partInspectionSpecification.updateMany({
          where: { id: before.id, version: d.expectedVersion },
          data: {
            data: d.data as Prisma.InputJsonValue,
            version: { increment: 1 },
          },
        });
        if (!changed.count) throw new StaleVersionError("Part specification");
      } else
        await tx.partInspectionSpecification.create({
          data: { ...key, data: d.data as Prisma.InputJsonValue },
        });
      await this.audit.record(
        {
          eventType: "part_specification.updated",
          entityType: "INTERNAL_PART",
          entityId: d.internalPartId,
          metadata: {
            planRevisionId: d.planRevisionId,
            previous: before?.data ?? null,
          },
        },
        tx,
      );
      return tx.partInspectionSpecification.findUniqueOrThrow({
        where: { internalPartId_planRevisionId: key },
      });
    });
  }
  async workbook(actor: Actor, dto: WorkbookDto) {
    const { file, body } = await this.files.open(actor, dto.fileId, "download");
    if (
      !["xlsx", "csv"].includes(file.extension) ||
      file.sizeBytes > 5n * 1024n * 1024n
    )
      throw new BusinessRuleError("Use an XLSX or CSV catalogue up to 5 MB");
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer>)
      chunks.push(Buffer.from(chunk));
    let rows;
    try {
      rows = await readPartWorkbook(Buffer.concat(chunks), file.extension);
    } catch {
      throw new BusinessRuleError(
        "The catalogue must have Part Number, Description and Product Type headers",
      );
    }
    if (rows.length > 10000)
      throw new BusinessRuleError(
        "Import at most 10,000 catalogue rows per file",
      );
    const plans = await this.db.client.inspectionPlan.findMany({
      include: {
        revisions: {
          where: { status: "RELEASED" },
          orderBy: { revision: "desc" },
          take: 1,
        },
      },
    });
    const seen = new Set<string>();
    const preview = rows.map((row) => {
      const term = row.productType.trim().toLowerCase();
      const candidates = plans.filter(
        (p) =>
          p.revisions.length &&
          [
            p.code,
            p.title,
            object(p.revisions[0].definition).component_type,
            object(p.revisions[0].definition).form_no,
          ]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase() === term),
      );
      const key = `${row.partNumber}:${candidates[0]?.id}`;
      const duplicate = seen.has(key);
      seen.add(key);
      return {
        ...row,
        planRevisionId:
          candidates.length === 1 ? candidates[0].revisions[0].id : null,
        error: !row.identifierIsText
          ? "Store Part Number as text to preserve leading zeros"
          : row.partNumber.length > 60
            ? "Identifier exceeds 60 characters; supply a reviewed master mapping"
            : duplicate
              ? "Duplicate catalogue row"
              : candidates.length !== 1
                ? "Product Type must identify exactly one released plan"
                : null,
      };
    });
    if (!dto.commit || preview.some((r) => r.error))
      return { committed: false, rows: preview };
    return this.db.tx(async (tx) => {
      for (const row of preview) {
        const before = await tx.internalPart.findUnique({
          where: { partNumber: row.partNumber },
        });
        if (before && before.partNumber !== row.partNumber)
          throw new BusinessRuleError(
            "A part collides by case/accent; provide a reviewed master mapping",
          );
        const part =
          before ??
          (await tx.internalPart.create({
            data: {
              partNumber: row.partNumber,
              description: row.description || row.partNumber,
              createdById: actor.userId,
            },
          }));
        await tx.partInspectionSpecification.upsert({
          where: {
            internalPartId_planRevisionId: {
              internalPartId: part.id,
              planRevisionId: row.planRevisionId!,
            },
          },
          create: {
            internalPartId: part.id,
            planRevisionId: row.planRevisionId!,
            data: {},
          },
          update: {},
        });
      }
      await this.audit.record(
        {
          eventType: "part_catalogue.imported",
          entityType: "SYSTEM",
          metadata: { fileId: dto.fileId, count: preview.length },
        },
        tx,
      );
      return { committed: true, rows: preview };
    });
  }
}
@Controller("part-specifications")
export class SpecificationsController {
  constructor(private readonly specifications: SpecificationsService) {}
  @Get() @RequirePermissions("inspection:read") list(
    @Query() q: SpecificationQuery,
  ) {
    return this.specifications.list(q);
  }
  @Post() @RequirePermissions("inspection_plan:manage") save(
    @CurrentActor() a: Actor,
    @Body() d: SpecificationDto,
  ) {
    return this.specifications.save(a, d);
  }
  @Post("import")
  @RequirePermissions("inspection_plan:manage", "product:write")
  workbook(@CurrentActor() a: Actor, @Body() d: WorkbookDto) {
    return this.specifications.workbook(a, d);
  }
  @Get("export.xlsx")
  @RequirePermissions("inspection:read", "report:export")
  async export(@Query() q: SpecificationQuery, @Res() res: Response) {
    const rows = await this.specifications.list(q);
    const bytes = await writePartWorkbook(
      rows.map((r) => ({
        partNumber: r.internalPart.partNumber,
        description: r.internalPart.description,
        productType: r.planRevision.plan.code,
      })),
    );
    res.set({
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="PartCatalogue.xlsx"',
      "Cache-Control": "private, no-store",
    });
    res.send(bytes);
  }
}
@Module({
  controllers: [SpecificationsController],
  providers: [SpecificationsService],
})
export class SpecificationsModule {}
