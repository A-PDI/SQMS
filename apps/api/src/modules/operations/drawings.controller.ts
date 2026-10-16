import { Controller, Get, Injectable, Module, Query } from "@nestjs/common";
import { IsOptional, IsUUID } from "class-validator";
import { DbService } from "../../common/db/db.service";
import { RequirePermissions } from "../../common/auth/decorators";
import { PageQueryDto, pageArgs, trimQ } from "../../common/http/pagination";
import { object } from "./operations.rules";
class DrawingQuery extends PageQueryDto {
  @IsOptional() @IsUUID() internalPartId?: string;
}
@Injectable()
class DrawingsService {
  constructor(private readonly db: DbService) {}
  async list(q: DrawingQuery) {
    const term = trimQ(q.q);
    const { skip, take, page, pageSize } = pageArgs(q);
    const parts = await this.db.client.internalPart.findMany({
      where: {
        ...(q.internalPartId ? { id: q.internalPartId } : {}),
        ...(term ? { partNumber: { contains: term } } : {}),
      },
      select: { id: true, partNumber: true },
      take: 1000,
    });
    const where = {
      links: {
        some: {
          entityType: "INTERNAL_PART" as const,
          entityId: { in: parts.map((p) => p.id) },
        },
      },
      documentType: { category: "ENGINEERING" as const },
    };
    const [total, controlled, legacy] = await Promise.all([
      this.db.client.documentRecord.count({ where }),
      this.db.client.documentRecord.findMany({
        where,
        skip,
        take,
        include: {
          links: true,
          revisions: {
            include: {
              files: {
                include: {
                  file: {
                    select: {
                      id: true,
                      originalFilename: true,
                      status: true,
                      sha256: true,
                    },
                  },
                },
              },
            },
            orderBy: { revisionNumber: "desc" },
          },
        },
        orderBy: { updatedAt: "desc" },
      }),
      this.db.client.legacyRecord.findMany({
        where: {
          entity: "engineering_drawings",
          targetType: "FILE",
          ...(q.q
            ? {
                snapshot: {
                  path: "$.part_number",
                  string_contains: term ?? "",
                },
              }
            : {}),
        },
        take: 1000,
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: controlled,
      historical: legacy.map((r) => ({
        sourceId: r.sourceId,
        fileId: r.targetId,
        partNumber: object(r.snapshot).part_number,
        version: object(r.snapshot).version,
        originalCurrent: object(r.snapshot).is_current,
        filename: object(r.snapshot).file_name,
        notes: object(r.snapshot).notes,
        reviewStatus: r.status,
        reviewReason: r.reason,
      })),
    };
  }
}
@Controller("drawings")
class DrawingsController {
  constructor(private readonly drawings: DrawingsService) {}
  @Get() @RequirePermissions("document:read", "product:read") list(
    @Query() q: DrawingQuery,
  ) {
    return this.drawings.list(q);
  }
}
@Module({ controllers: [DrawingsController], providers: [DrawingsService] })
export class DrawingsModule {}
