import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { IsIn, IsOptional, IsUUID } from "class-validator";
import { PageQueryDto } from "../../common/http/pagination";
import type { Response } from "express";
import type { Actor } from "../../common/auth/actor";
import { CurrentActor, RequirePermissions } from "../../common/auth/decorators";
import { QualityModule } from "../quality/quality.module";
import { OperationsModule } from "./operations.controller";
import { ConnectedQualityService } from "./connected-quality.service";
import {
  DefectLinesDto,
  FeatureDto,
  FeatureMappingDto,
  OriginNcrDto,
  RecurrenceDecisionDto,
  ReportSectionsDto,
  ScarLinkDto,
} from "./connected-quality.dto";

class HistoryQuery {
  @IsOptional() @IsUUID() internalPartId?: string;
}
class SignalQuery extends PageQueryDto {
  @IsOptional() @IsIn(["CANDIDATE", "CONFIRMED", "DISMISSED"]) status?:
    | "CANDIDATE"
    | "CONFIRMED"
    | "DISMISSED";
}
@Controller()
export class ConnectedQualityController {
  constructor(private readonly quality: ConnectedQualityService) {}
  @Get("parts/:id/features") @RequirePermissions("product:read") features(
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.quality.features(id);
  }
  @Post("features") @RequirePermissions("configuration:write") feature(
    @CurrentActor() a: Actor,
    @Body() d: FeatureDto,
  ) {
    return this.quality.feature(a, d);
  }
  @Post("feature-revision-mappings")
  @RequirePermissions("configuration:write")
  mapping(@CurrentActor() a: Actor, @Body() d: FeatureMappingDto) {
    return this.quality.mapFeature(a, d);
  }
  @Get("incoming-inspections/:id/recurrence-candidates")
  @RequirePermissions("inspection:read", "ncr:read")
  incomingMatches(@Param("id", ParseUUIDPipe) id: string) {
    return this.quality.incomingCandidates(id);
  }
  @Post("incoming-inspections/:id/ncrs")
  @RequirePermissions("inspection:read", "ncr:write")
  incomingNcr(
    @CurrentActor() a: Actor,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: OriginNcrDto,
  ) {
    return this.quality.fromIncoming(a, id, d);
  }
  @Post("first-articles/:id/ncrs")
  @RequirePermissions("qualification:read", "ncr:write")
  faiNcr(
    @CurrentActor() a: Actor,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: OriginNcrDto,
  ) {
    return this.quality.fromFai(a, id, d);
  }
  @Post("ncrs/:id/defect-lines") @RequirePermissions("ncr:write") defects(
    @CurrentActor() a: Actor,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: DefectLinesDto,
  ) {
    return this.quality.defects(a, id, d);
  }
  @Get("ncrs/:id/recurrence") @RequirePermissions("ncr:read") recurrence(
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.quality.recurrence(id);
  }
  @Get("quality-signals") @RequirePermissions("ncr:read") signals(
    @Query() q: SignalQuery,
  ) {
    return this.quality.signals(q);
  }
  @Post("recurrence-reviews/:id/decision")
  @RequirePermissions("ncr:disposition")
  decision(
    @CurrentActor() a: Actor,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: RecurrenceDecisionDto,
  ) {
    return this.quality.decide(a, id, d.status, d.reason);
  }
  @Post("ncrs/:id/report-sections") @RequirePermissions("ncr:write") sections(
    @CurrentActor() a: Actor,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: ReportSectionsDto,
  ) {
    return this.quality.reportSections(a, id, d);
  }
  @Post("ncrs/:id/scar-links")
  @RequirePermissions("ncr:read", "scar:write")
  scar(
    @CurrentActor() a: Actor,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: ScarLinkDto,
  ) {
    return this.quality.scarLink(a, id, d.scarId, d.reason);
  }
  @Get("ncrs/:id/pdf") @RequirePermissions("ncr:read") async pdf(
    @CurrentActor() a: Actor,
    @Param("id", ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const b = await this.quality.pdf(a, id);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="NCR-${id}.pdf"`,
      "Cache-Control": "private, no-store",
    });
    res.send(b);
  }
  @Get("suppliers/:id/quality-history")
  @RequirePermissions(
    "supplier:read",
    "qualification:read",
    "inspection:read",
    "ncr:read",
    "scar:read",
    "change:read",
  )
  history(@Param("id", ParseUUIDPipe) id: string, @Query() q: HistoryQuery) {
    return this.quality.history(id, q.internalPartId);
  }
}
@Module({
  imports: [OperationsModule, QualityModule],
  controllers: [ConnectedQualityController],
  providers: [ConnectedQualityService],
})
export class ConnectedQualityModule {}
