import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PERMISSIONS as P } from "@sqms/shared";
import type { Response } from "express";
import { IsInt, Min } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import type { Actor } from "../../common/auth/actor";
import { CurrentActor, RequirePermissions } from "../../common/auth/decorators";
import { sendCsv, toCsv } from "../../common/http/csv";
import { AuditService } from "../../common/audit/audit.service";
import {
  CertificationDto,
  ChangeStatusDto,
  ContactDto,
  CreateSupplierDto,
  CreateSupplierQualificationDto,
  SetAddressesDto,
  SetIdsDto,
  SiteDto,
  SupplierListQuery,
  UpdateSiteDto,
  UpdateSupplierDto,
  UpdateSupplierQualificationDto,
} from "./suppliers.dto";
import { SuppliersService } from "./suppliers.service";

class VersionDto {
  @ApiProperty() @IsInt() @Min(0) expectedVersion: number;
}

@ApiTags("suppliers")
@Controller("suppliers")
export class SuppliersController {
  constructor(
    private readonly suppliers: SuppliersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions(P.SUPPLIER_READ)
  @ApiOperation({ summary: "Supplier directory (search, filter, sort, paginate)" })
  list(@CurrentActor() actor: Actor, @Query() q: SupplierListQuery) {
    return this.suppliers.list(actor, q);
  }

  @Get("export.csv")
  @RequirePermissions(P.SUPPLIER_READ, P.REPORT_EXPORT)
  @ApiOperation({ summary: "Export the filtered supplier directory as CSV" })
  async export(@CurrentActor() actor: Actor, @Query() q: SupplierListQuery, @Res() res: Response) {
    const rows = await this.suppliers.exportRows(actor, q);
    await this.audit.record({ eventType: "export.suppliers", metadata: { rows: rows.length, filters: { ...q } } });
    sendCsv(
      res,
      "suppliers.csv",
      toCsv(rows, [
        { header: "Supplier number", value: (r) => r.supplierNumber },
        { header: "Name", value: (r) => r.name },
        { header: "Legal name", value: (r) => r.legalName },
        { header: "Country", value: (r) => r.country },
        { header: "Status", value: (r) => r.status },
        { header: "Sites", value: (r) => r._count.sites },
        { header: "Website", value: (r) => r.website },
        { header: "Updated", value: (r) => r.updatedAt },
      ]),
    );
  }

  @Post()
  @RequirePermissions(P.SUPPLIER_WRITE)
  @ApiOperation({ summary: "Create a prospective supplier (optionally with sites, contacts, capabilities)" })
  create(@CurrentActor() actor: Actor, @Body() dto: CreateSupplierDto) {
    return this.suppliers.create(actor, dto);
  }

  @Get(":id")
  @RequirePermissions(P.SUPPLIER_READ)
  @ApiOperation({ summary: "Supplier profile overview" })
  get(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.suppliers.get(actor, id);
  }

  @Patch(":id")
  @RequirePermissions(P.SUPPLIER_WRITE)
  @ApiOperation({ summary: "Update supplier details (status changes use /status or qualifications)" })
  update(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierDto) {
    return this.suppliers.update(actor, id, dto);
  }

  @Post(":id/status")
  @RequirePermissions(P.SUPPLIER_QUALIFY)
  @ApiOperation({ summary: "Suspend, deactivate or return a supplier to evaluation (approval requires a qualification)" })
  changeStatus(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ChangeStatusDto) {
    return this.suppliers.changeStatus(actor, id, dto);
  }

  @Put(":id/addresses")
  @RequirePermissions(P.SUPPLIER_WRITE)
  setAddresses(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: SetAddressesDto) {
    return this.suppliers.setAddresses(actor, id, dto);
  }

  @Put(":id/capabilities")
  @RequirePermissions(P.SUPPLIER_WRITE)
  setCapabilities(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: SetIdsDto) {
    return this.suppliers.setCapabilities(actor, id, dto.ids);
  }

  @Put(":id/categories")
  @RequirePermissions(P.SUPPLIER_WRITE)
  setCategories(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: SetIdsDto) {
    return this.suppliers.setCategories(actor, id, dto.ids);
  }

  @Get(":id/sites")
  @RequirePermissions(P.SUPPLIER_READ)
  sites(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.suppliers.listSites(actor, id);
  }

  @Post(":id/sites")
  @RequirePermissions(P.SUPPLIER_WRITE)
  createSite(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: SiteDto) {
    return this.suppliers.createSite(actor, id, dto);
  }

  @Get(":id/contacts")
  @RequirePermissions(P.SUPPLIER_READ)
  contacts(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.suppliers.listContacts(actor, id);
  }

  @Post(":id/contacts")
  @RequirePermissions(P.SUPPLIER_WRITE)
  createContact(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ContactDto) {
    return this.suppliers.createContact(actor, id, dto);
  }

  @Patch(":id/contacts/:contactId")
  @RequirePermissions(P.SUPPLIER_WRITE)
  updateContact(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Param("contactId", ParseUUIDPipe) contactId: string, @Body() dto: ContactDto) {
    return this.suppliers.updateContact(actor, id, contactId, dto);
  }

  @Delete(":id/contacts/:contactId")
  @HttpCode(204)
  @RequirePermissions(P.SUPPLIER_WRITE)
  archiveContact(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Param("contactId", ParseUUIDPipe) contactId: string) {
    return this.suppliers.archiveContact(actor, id, contactId);
  }

  @Get(":id/certifications")
  @RequirePermissions(P.SUPPLIER_READ)
  certifications(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.suppliers.listCertifications(actor, id);
  }

  @Post(":id/certifications")
  @RequirePermissions(P.SUPPLIER_WRITE)
  createCertification(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CertificationDto) {
    return this.suppliers.createCertification(actor, id, dto);
  }

  @Patch(":id/certifications/:certId")
  @RequirePermissions(P.SUPPLIER_WRITE)
  updateCertification(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Param("certId", ParseUUIDPipe) certId: string, @Body() dto: CertificationDto) {
    return this.suppliers.updateCertification(actor, id, certId, dto);
  }

  @Delete(":id/certifications/:certId")
  @HttpCode(204)
  @RequirePermissions(P.SUPPLIER_WRITE)
  archiveCertification(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Param("certId", ParseUUIDPipe) certId: string) {
    return this.suppliers.archiveCertification(actor, id, certId);
  }

  @Get(":id/qualifications")
  @RequirePermissions(P.SUPPLIER_READ)
  @ApiOperation({ summary: "Supplier qualification history" })
  qualifications(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.suppliers.listQualifications(actor, id);
  }

  @Post(":id/qualifications")
  @RequirePermissions(P.SUPPLIER_QUALIFY)
  @ApiOperation({ summary: "Start a supplier (or site) qualification" })
  createQualification(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CreateSupplierQualificationDto) {
    return this.suppliers.createQualification(actor, id, dto);
  }
}

@ApiTags("supplier-sites")
@Controller("supplier-sites")
export class SupplierSitesController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Patch(":siteId")
  @RequirePermissions(P.SUPPLIER_WRITE)
  update(@CurrentActor() actor: Actor, @Param("siteId", ParseUUIDPipe) siteId: string, @Body() dto: UpdateSiteDto) {
    return this.suppliers.updateSite(actor, siteId, dto);
  }

  @Post(":siteId/status")
  @RequirePermissions(P.SUPPLIER_QUALIFY)
  @ApiOperation({ summary: "Suspend/deactivate a manufacturing site (site approval requires a site qualification)" })
  status(@CurrentActor() actor: Actor, @Param("siteId", ParseUUIDPipe) siteId: string, @Body() dto: ChangeStatusDto) {
    return this.suppliers.changeSiteStatus(actor, siteId, dto);
  }
}

@ApiTags("qualifications")
@Controller("supplier-qualifications")
export class SupplierQualificationsController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get(":id")
  @RequirePermissions(P.SUPPLIER_READ)
  get(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.suppliers.getQualification(actor, id);
  }

  @Patch(":id")
  @RequirePermissions(P.SUPPLIER_QUALIFY)
  update(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierQualificationDto) {
    return this.suppliers.updateQualification(actor, id, dto);
  }

  @Post(":id/submit")
  @RequirePermissions(P.SUPPLIER_QUALIFY)
  @ApiOperation({ summary: "Submit for approval (Supplier Quality, then Management)" })
  submit(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: VersionDto) {
    return this.suppliers.submitQualification(actor, id, dto.expectedVersion);
  }
}
