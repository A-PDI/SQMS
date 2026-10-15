import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from "@nestjs/common";
import { ApiOperation, ApiProperty, ApiTags } from "@nestjs/swagger";
import { PERMISSIONS as P } from "@sqms/shared";
import { IsInt, Min } from "class-validator";
import type { Actor } from "../../common/auth/actor";
import { CurrentActor, RequirePermissions } from "../../common/auth/decorators";
import {
  AcknowledgeRequirementDto,
  CharacteristicDto,
  CreateConfigurationDto,
  NewRevisionDto,
  ReasonDto,
  RequirementDto,
  UpdateBaselineDto,
  UpdateCharacteristicDto,
  UpdateRequirementDto,
  UpdateRevisionDto,
  VerifyRequirementDto,
} from "./configurations.dto";
import { ConfigurationsService } from "./configurations.service";

class VersionDto {
  @ApiProperty() @IsInt() @Min(0) expectedVersion: number;
}

@ApiTags("product-configurations")
@Controller("product-configurations")
export class ConfigurationsController {
  constructor(private readonly configs: ConfigurationsService) {}

  @Post()
  @RequirePermissions(P.CONFIGURATION_WRITE)
  @ApiOperation({ summary: "Create a configuration (revision A draft with engineering baseline)" })
  create(@CurrentActor() actor: Actor, @Body() dto: CreateConfigurationDto) {
    return this.configs.createConfiguration(actor, dto);
  }

  @Get(":id")
  @RequirePermissions(P.PRODUCT_READ)
  get(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.configs.getConfiguration(actor, id);
  }

  @Post(":id/revisions")
  @RequirePermissions(P.CONFIGURATION_WRITE)
  @ApiOperation({ summary: "Open a new draft revision derived from the approved revision (internal engineering change)" })
  newRevision(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: NewRevisionDto) {
    return this.configs.createRevision(actor, id, dto.changeSummary);
  }

  @Get("revisions/:revId")
  @RequirePermissions(P.PRODUCT_READ)
  @ApiOperation({ summary: "Configuration revision with baseline, delta requirements and critical characteristics" })
  revision(@CurrentActor() actor: Actor, @Param("revId", ParseUUIDPipe) revId: string) {
    return this.configs.getRevision(actor, revId);
  }

  @Patch("revisions/:revId")
  @RequirePermissions(P.CONFIGURATION_WRITE)
  updateRevision(@CurrentActor() actor: Actor, @Param("revId", ParseUUIDPipe) revId: string, @Body() dto: UpdateRevisionDto) {
    return this.configs.updateRevision(actor, revId, dto);
  }

  @Post("revisions/:revId/withdraw")
  @RequirePermissions(P.CONFIGURATION_WRITE)
  withdraw(@CurrentActor() actor: Actor, @Param("revId", ParseUUIDPipe) revId: string, @Body() dto: ReasonDto) {
    return this.configs.withdrawRevision(actor, revId, dto.reason);
  }

  @Put("revisions/:revId/baseline")
  @RequirePermissions(P.CONFIGURATION_WRITE)
  @ApiOperation({ summary: "Edit the engineering baseline / product definition (draft revisions only)" })
  baseline(@CurrentActor() actor: Actor, @Param("revId", ParseUUIDPipe) revId: string, @Body() dto: UpdateBaselineDto) {
    return this.configs.updateBaseline(actor, revId, dto);
  }

  @Post("revisions/:revId/baseline/accept")
  @RequirePermissions(P.CONFIGURATION_WRITE)
  @ApiOperation({ summary: "Engineering acceptance of the baseline (required before product approval)" })
  acceptBaseline(@CurrentActor() actor: Actor, @Param("revId", ParseUUIDPipe) revId: string, @Body() dto: VersionDto) {
    return this.configs.acceptBaseline(actor, revId, dto.expectedVersion);
  }

  @Post("revisions/:revId/requirements")
  @RequirePermissions(P.CONFIGURATION_WRITE)
  @ApiOperation({ summary: "Add a customer-specific / delta requirement" })
  addRequirement(@CurrentActor() actor: Actor, @Param("revId", ParseUUIDPipe) revId: string, @Body() dto: RequirementDto) {
    return this.configs.addRequirement(actor, revId, dto);
  }

  @Patch("requirements/:id")
  @RequirePermissions(P.CONFIGURATION_WRITE)
  updateRequirement(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateRequirementDto) {
    return this.configs.updateRequirement(actor, id, dto);
  }

  @Delete("requirements/:id")
  @HttpCode(204)
  @RequirePermissions(P.CONFIGURATION_WRITE)
  deleteRequirement(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.configs.deleteRequirement(actor, id);
  }

  @Post("requirements/:id/acknowledge")
  @RequirePermissions(P.CONFIGURATION_WRITE)
  @ApiOperation({ summary: "Record the supplier's acknowledgment of a requirement" })
  acknowledge(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: AcknowledgeRequirementDto) {
    return this.configs.acknowledgeRequirement(actor, id, dto);
  }

  @Post("requirements/:id/verify")
  @RequirePermissions(P.QUALIFICATION_WRITE)
  @ApiOperation({ summary: "Record verification of a requirement against its acceptance criteria" })
  verify(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: VerifyRequirementDto) {
    return this.configs.verifyRequirement(actor, id, dto);
  }

  @Post("revisions/:revId/characteristics")
  @RequirePermissions(P.CONFIGURATION_WRITE)
  addCharacteristic(@CurrentActor() actor: Actor, @Param("revId", ParseUUIDPipe) revId: string, @Body() dto: CharacteristicDto) {
    return this.configs.addCharacteristic(actor, revId, dto);
  }

  @Patch("characteristics/:id")
  @RequirePermissions(P.CONFIGURATION_WRITE)
  updateCharacteristic(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateCharacteristicDto) {
    return this.configs.updateCharacteristic(actor, id, dto);
  }

  @Delete("characteristics/:id")
  @HttpCode(204)
  @RequirePermissions(P.CONFIGURATION_WRITE)
  deleteCharacteristic(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.configs.deleteCharacteristic(actor, id);
  }
}
