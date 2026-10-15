import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PERMISSIONS as P } from "@sqms/shared";
import type { Response } from "express";
import type { Actor } from "../../common/auth/actor";
import { CurrentActor, RequirePermissions } from "../../common/auth/decorators";
import { AuditService } from "../../common/audit/audit.service";
import { sendCsv, toCsv } from "../../common/http/csv";
import {
  CreatePartDto,
  CreateSupplierPartDto,
  CreateSupplierProductDto,
  CrossReferenceDto,
  OemReferenceDto,
  PartListQuery,
  ProductApprovalQuery,
  SupplierPartListQuery,
  SupplierProductListQuery,
  SupplierProductStatusDto,
  UpdatePartDto,
  UpdateSupplierPartDto,
} from "./products.dto";
import { ProductsService } from "./products.service";

@ApiTags("lookups")
@Controller()
export class LookupsController {
  constructor(private readonly products: ProductsService) {}

  @Get("product-categories")
  @RequirePermissions(P.PRODUCT_READ)
  categories() {
    return this.products.categories();
  }

  @Get("capabilities")
  @RequirePermissions(P.SUPPLIER_READ)
  capabilities() {
    return this.products.capabilities();
  }
}

@ApiTags("products")
@Controller("products")
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions(P.PRODUCT_READ)
  @ApiOperation({ summary: "Product master (internal parts) with search across OEM and supplier part numbers" })
  list(@CurrentActor() actor: Actor, @Query() q: PartListQuery) {
    return this.products.listParts(actor, q);
  }

  @Get("export.csv")
  @RequirePermissions(P.PRODUCT_READ, P.REPORT_EXPORT)
  async export(@CurrentActor() actor: Actor, @Query() q: PartListQuery, @Res() res: Response) {
    const rows = await this.products.exportParts(actor, q);
    await this.audit.record({ eventType: "export.products", metadata: { rows: rows.length } });
    sendCsv(
      res,
      "products.csv",
      toCsv(rows, [
        { header: "Part number", value: (r) => r.partNumber },
        { header: "Description", value: (r) => r.description },
        { header: "Category", value: (r) => r.category?.name },
        { header: "Criticality", value: (r) => r.criticality },
        { header: "Status", value: (r) => r.status },
        { header: "Design ownership", value: (r) => r.designOwnership },
        { header: "OEM references", value: (r) => r.oemReferences.map((o) => `${o.oemName}:${o.oemPartNumber}`).join("; ") },
      ]),
    );
  }

  @Post()
  @RequirePermissions(P.PRODUCT_WRITE)
  create(@CurrentActor() actor: Actor, @Body() dto: CreatePartDto) {
    return this.products.createPart(actor, dto);
  }

  @Get(":id")
  @RequirePermissions(P.PRODUCT_READ)
  @ApiOperation({ summary: "Product detail: sources, configurations, revisions, cross-references" })
  get(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.products.getPart(actor, id);
  }

  @Patch(":id")
  @RequirePermissions(P.PRODUCT_WRITE)
  update(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdatePartDto) {
    return this.products.updatePart(actor, id, dto);
  }

  @Post(":id/oem-references")
  @RequirePermissions(P.PRODUCT_WRITE)
  addOem(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: OemReferenceDto) {
    return this.products.addOemReference(actor, id, dto);
  }

  @Delete(":id/oem-references/:refId")
  @HttpCode(204)
  @RequirePermissions(P.PRODUCT_WRITE)
  removeOem(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Param("refId", ParseUUIDPipe) refId: string) {
    return this.products.removeOemReference(actor, id, refId);
  }

  @Get(":id/approvals")
  @RequirePermissions(P.PRODUCT_READ)
  @ApiOperation({ summary: "Complete product approval history (approved supplier-product-configuration-site records)" })
  approvals(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.products.approvalHistory(actor, id);
  }
}

@ApiTags("products")
@Controller("supplier-parts")
export class SupplierPartsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions(P.PRODUCT_READ)
  list(@CurrentActor() actor: Actor, @Query() q: SupplierPartListQuery) {
    return this.products.listSupplierParts(actor, q);
  }

  @Post()
  @RequirePermissions(P.PRODUCT_WRITE)
  create(@CurrentActor() actor: Actor, @Body() dto: CreateSupplierPartDto) {
    return this.products.createSupplierPart(actor, dto);
  }

  @Patch(":id")
  @RequirePermissions(P.PRODUCT_WRITE)
  update(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierPartDto) {
    return this.products.updateSupplierPart(actor, id, dto);
  }
}

@ApiTags("products")
@Controller("part-cross-references")
export class CrossReferencesController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  @RequirePermissions(P.PRODUCT_WRITE)
  create(@CurrentActor() actor: Actor, @Body() dto: CrossReferenceDto) {
    return this.products.addCrossReference(actor, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions(P.PRODUCT_WRITE)
  remove(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.products.removeCrossReference(actor, id);
  }
}

@ApiTags("supplier-products")
@Controller("supplier-products")
export class SupplierProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions(P.PRODUCT_READ)
  @ApiOperation({ summary: "Supplier-product-site relationships" })
  list(@CurrentActor() actor: Actor, @Query() q: SupplierProductListQuery) {
    return this.products.listSupplierProducts(actor, q);
  }

  @Post()
  @RequirePermissions(P.PRODUCT_WRITE)
  @ApiOperation({ summary: "Propose a supplier-product-site relationship (approval requires product qualification)" })
  create(@CurrentActor() actor: Actor, @Body() dto: CreateSupplierProductDto) {
    return this.products.createSupplierProduct(actor, dto);
  }

  @Get(":id")
  @RequirePermissions(P.PRODUCT_READ)
  get(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.products.getSupplierProduct(actor, id);
  }

  @Post(":id/status")
  @RequirePermissions(P.SUPPLIER_QUALIFY)
  @ApiOperation({ summary: "Suspend, disqualify or deactivate a source (approval only through qualification)" })
  status(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string, @Body() dto: SupplierProductStatusDto) {
    return this.products.changeSupplierProductStatus(actor, id, dto);
  }
}

@ApiTags("supplier-products")
@Controller("product-approvals")
export class ProductApprovalsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions(P.PRODUCT_READ)
  @ApiOperation({ summary: "Approved source list: explicit approved supplier-product-configuration-site records" })
  list(@CurrentActor() actor: Actor, @Query() q: ProductApprovalQuery) {
    return this.products.listApprovals(actor, q);
  }
}
