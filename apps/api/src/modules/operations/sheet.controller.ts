import {
  Body,
  Controller,
  Get,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { IsDateOnly } from "../../common/http/dto-helpers";
import {
  injectorSheetPreview,
  queueInjectorSheetDay,
  type AppEnv,
} from "@sqms/server-core";
import { CurrentActor, RequirePermissions } from "../../common/auth/decorators";
import type { Actor } from "../../common/auth/actor";
import { DbService } from "../../common/db/db.service";
import { AuditService } from "../../common/audit/audit.service";
import { APP_ENV } from "../../infra/tokens";
import {
  BusinessRuleError,
  NotFoundError,
} from "../../common/errors/app-errors";
import { sendCsv, toCsv } from "../../common/http/csv";

class SheetDayDto {
  @IsDateOnly() day: string;
}
class SheetRangeDto {
  @IsDateOnly() from: string;
  @IsDateOnly() to: string;
}
@Controller("injector-sheet-exports")
class InjectorSheetController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}
  @Get() @RequirePermissions("injector:read") async status() {
    const events = await this.db.client.outboxEvent.findMany({
      where: { eventType: "injector.sheet_export.requested" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      mode: this.env.INJECTOR_SHEET_MODE,
      timeZone: this.env.INJECTOR_SHEET_TIMEZONE,
      dailyTime: this.env.INJECTOR_SHEET_DAILY_TIME,
      deliveries: events.map((e) => ({
        id: e.id,
        status: e.status,
        attempts: e.attempts,
        lastError: e.lastError,
        createdAt: e.createdAt,
        day: (e.payload as { day: string }).day,
      })),
    };
  }
  @Get("preview") @RequirePermissions("injector:read") preview(
    @Query() q: SheetDayDto,
  ) {
    return injectorSheetPreview(this.db.client, this.env, q.day);
  }
  @Get("export.csv")
  @RequirePermissions("injector:read", "report:export")
  async csv(@Query() q: SheetDayDto, @Res() res: Response) {
    const data = await injectorSheetPreview(this.db.client, this.env, q.day);
    sendCsv(
      res,
      `PassedInjectors-${q.day}.csv`,
      toCsv(
        data.rows.map((r) => ({ date: r[0], part: r[1], serial: r[2] })),
        [
          { header: "Test Date", value: (r) => r.date },
          { header: "Part Number", value: (r) => r.part },
          { header: "Serial Number", value: (r) => r.serial },
        ],
      ),
    );
  }
  @Post() @RequirePermissions("injector:sync") async queue(
    @CurrentActor() actor: Actor,
    @Body() dto: SheetRangeDto,
  ) {
    const count =
      (new Date(dto.to).getTime() - new Date(dto.from).getTime()) / 86400000 +
      1;
    if (count < 1 || count > 366)
      throw new BusinessRuleError("Choose a range of 1–366 calendar days");
    if (this.env.INJECTOR_SHEET_MODE === "disabled")
      throw new BusinessRuleError(
        "Sheet delivery is disabled; preview or download instead",
      );
    const previews = [];
    for (let n = 0; n < count; n++)
      previews.push(
        await injectorSheetPreview(
          this.db.client,
          this.env,
          new Date(new Date(dto.from).getTime() + n * 86400000)
            .toISOString()
            .slice(0, 10),
        ),
      );
    if (previews.reduce((n, p) => n + p.rows.length, 0) > 5000)
      throw new BusinessRuleError("Limit one backfill to 5,000 rows");
    const results = [];
    for (const p of previews)
      results.push(
        await queueInjectorSheetDay(
          this.db.client,
          this.env,
          p.day,
          actor.userId,
        ),
      );
    return { results };
  }
  @Post(":id/retry") @RequirePermissions("injector:sync") async retry(
    @CurrentActor() actor: Actor,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.db.tx(async (tx) => {
      const e = await tx.outboxEvent.findFirst({
        where: {
          id,
          eventType: "injector.sheet_export.requested",
          status: "FAILED",
        },
      });
      if (!e) throw new NotFoundError("Failed sheet delivery");
      await tx.outboxEvent.updateMany({
        where: { id, status: "FAILED" },
        data: {
          status: "PENDING",
          attempts: 0,
          availableAt: new Date(),
          lastError: null,
        },
      });
      await this.audit.record(
        {
          eventType: "injector.sheet_export_retried",
          entityType: "SYSTEM",
          entityId: id,
          metadata: { userId: actor.userId },
        },
        tx,
      );
      return { queued: true };
    });
  }
}
@Module({ controllers: [InjectorSheetController] })
export class InjectorSheetModule {}
