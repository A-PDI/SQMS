import { All, Controller, Module, Req, Res, Injectable } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  qmsReportPdf,
  qmsReportWorkbook,
  qmsTemplateWorkbook,
  readPartWorkbook,
} from "@sqms/legacy-domain";
import { Prisma } from "@sqms/db";
import type { Actor } from "../../common/auth/actor";
import { AuthorizeInService, CurrentActor } from "../../common/auth/decorators";
import {
  ForbiddenError,
  NotFoundError,
  BusinessRuleError,
} from "../../common/errors/app-errors";
import { OperationsModule } from "../operations/operations.controller";
import { AuthService } from "../auth/auth.service";
import { AuthModule } from "../auth/auth.module";
import { AdminModule } from "../admin/admin.module";
import { FilesModule } from "../files/files.module";
import { QmsService } from "./qms.service";
import { QmsQualityService } from "./qms-quality.service";
import { QmsMetricsService } from "./qms-metrics.service";
import { QmsFilesService } from "./qms-files.service";
import { QmsAdminService } from "./qms-admin.service";
import { QmsInjectorsService } from "./qms-injectors.service";
import { QMS_ROUTES } from "./qms-routes";
import * as p from "./qms-presenters";
import type { Row } from "./qms-presenters";
const xlsx =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export function matchQmsRoute(method: string, path: string) {
  for (const r of QMS_ROUTES) {
    if (method !== r.method) continue;
    const keys: string[] = [];
    const regex =
      "^" +
      r.path
        .split("/")
        .map((part) =>
          part.startsWith(":")
            ? (keys.push(part.slice(1)), "([^/]+)")
            : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        )
        .join("/") +
      "/?$";
    const match = new RegExp(regex).exec(path);
    if (match)
      return {
        route: r,
        params: Object.fromEntries(
          keys.map((key, i) => [key, decodeURIComponent(match[i + 1])]),
        ),
      };
  }
  return null;
}
@Injectable()
export class QmsContractService {
  constructor(
    readonly qms: QmsService,
    readonly quality: QmsQualityService,
    readonly metrics: QmsMetricsService,
    readonly files: QmsFilesService,
    readonly admin: QmsAdminService,
    readonly injectors: QmsInjectorsService,
    readonly auth: AuthService,
  ) {}
  async handle(
    actor: Actor,
    route: string,
    params: Row,
    req: Request,
    res: Response,
  ): Promise<any> {
    const b = p.object(req.body),
      q = req.query as Row,
      id = params.id,
      key = req.method + " " + route;
    if (key === "PATCH /auth/password") {
      await this.auth.changePassword(
        actor,
        b.current_password,
        b.new_password,
        "operational",
      );
      return { ok: true };
    }
    if (key === "GET /auth/me")
      return {
        user: {
          id: actor.userId,
          name: actor.displayName,
          email: actor.email,
          role: actor.roles.includes("SYSTEM_ADMIN")
            ? "admin"
            : actor.roles.includes("QUALITY_MANAGER")
              ? "qc_manager"
              : "inspector",
        },
      };
    if (key === "GET /templates" || key === "GET /admin/templates")
      return {
        templates: await this.qms.templates(route.startsWith("/admin")),
      };
    if (key === "GET /templates/:id" || key === "GET /admin/templates/:id")
      return { template: await this.qms.template(id) };
    if (key === "POST /admin/templates")
      return { template: await this.qms.saveTemplate(actor, null, b) };
    if (key === "PATCH /admin/templates/:id")
      return { template: await this.qms.saveTemplate(actor, id, b) };
    if (key === "POST /admin/templates/:id/version")
      return { template: await this.qms.saveTemplate(actor, id, b, true) };
    if (key === "DELETE /admin/templates/:id")
      return this.qms.deleteTemplate(id);
    if (key === "GET /admin/inspection-items")
      return this.qms.inspectionItems();
    if (key === "GET /admin/templates/export")
      return {
        buffer: await qmsTemplateWorkbook(await this.qms.templates()),
        contentType: xlsx,
        filename: "inspection-forms-export.xlsx",
      };
    if (key === "GET /inspections") return this.qms.list(q);
    if (key === "GET /inspections/assigned")
      return {
        inspections: (await this.qms.allInspections())
          .filter(
            (r) => r.assigned_to === actor.userId && r.status !== "complete",
          )
          .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))),
      };
    if (key === "POST /inspections") return this.qms.create(actor, b);
    if (key === "GET /inspections/:id") return this.qms.detail(id);
    if (key === "PATCH /inspections/:id") return this.qms.update(actor, id, b);
    if (key === "DELETE /inspections/:id") return this.qms.remove(actor, id);
    if (key === "POST /inspections/:id/complete")
      return this.qms.complete(actor, id, b);
    if (key === "POST /inspections/:id/review")
      return this.qms.update(actor, id, { status: "review" });
    if (key === "POST /inspections/:id/reopen")
      return this.qms.reopen(actor, id, b);
    if (key === "POST /inspections/:id/log-activity") {
      if (
        !["printed", "downloaded", "emailed", "viewed"].includes(b.action_type)
      )
        throw new BusinessRuleError("Invalid activity action");
      await this.qms.detail(id);
      await this.qms.db.tx((tx) => this.qms.log(tx, actor, id, b.action_type));
      return { ok: true };
    }
    if (key === "GET /inspections/:id/pdf") {
      const { inspection: r } = await this.qms.detail(id);
      return {
        buffer: await this.qms.pdf(actor, id),
        contentType: "application/pdf",
        filename: `QC_${String(r.part_number || "NoPart").replace(/[^a-zA-Z0-9._-]/g, "_")}_${String(r.lot_serial_no || "NoSerial").replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`,
      };
    }
    if (key === "GET /dashboard/stats") return this.metrics.stats();
    if (key === "GET /dashboard/chart") return this.metrics.chart(q);
    if (key === "GET /dashboard/alerts") return this.metrics.alerts();
    if (key === "GET /dashboard/fire-ring-eligible")
      return this.metrics.fireRing();
    if (key === "GET /part-specs/lookup") return this.qms.lookup(q);
    if (key === "GET /part-specs") return this.qms.specs(q);
    if (key === "POST /part-specs") return this.qms.saveSpec(actor, null, b);
    if (key === "PATCH /part-specs/:id") return this.qms.saveSpec(actor, id, b);
    if (key === "DELETE /part-specs/:id") {
      await this.qms.db.client.partInspectionSpecification.delete({
        where: { id },
      });
      return { ok: true };
    }
    if (key === "GET /admin/templates/:id/part-specs")
      return this.qms.specs({ template_id: id });
    if (key === "PUT /admin/templates/:id/part-specs/:partNumber")
      return this.qms.saveSpec(actor, null, {
        ...b,
        template_id: id,
        part_number: params.partNumber,
      });
    if (key === "DELETE /admin/templates/:id/part-specs/:partNumber") {
      const specs = await this.qms.specs({
        template_id: id,
        part_number: params.partNumber,
      });
      await this.qms.db.client.partInspectionSpecification.deleteMany({
        where: { id: { in: specs.specs.map((s) => s.id) } },
      });
      return { ok: true };
    }
    if (key === "POST /part-specs/import-from-inspections") {
      let created = 0,
        skipped = 0;
      const seen = new Set<string>();
      for (const r of await this.qms.allInspections()) {
        if (!r.part_number || seen.has(`${r.template_id}:${r.part_number}`)) {
          skipped++;
          continue;
        }
        seen.add(`${r.template_id}:${r.part_number}`);
        if (
          (
            await this.qms.specs({
              template_id: r.template_id,
              part_number: r.part_number,
            })
          ).specs.length
        ) {
          skipped++;
          continue;
        }
        await this.qms.saveSpec(actor, null, {
          template_id: r.template_id,
          part_number: r.part_number,
          description: r.description,
        });
        created++;
      }
      return { created, skipped };
    }
    if (key === "POST /part-specs/import") return this.importParts(actor, req);
    if (key === "GET /ncrs") return this.quality.list(q);
    if (key === "GET /ncrs/:id") return { ncr: await this.quality.get(id) };
    if (key === "POST /ncrs") return this.quality.save(actor, null, b);
    if (key === "PATCH /ncrs/:id") return this.quality.save(actor, id, b);
    if (key === "PUT /ncrs/:id/content")
      return this.quality.content(actor, id, b);
    if (key === "DELETE /ncrs/:id") return this.quality.remove(actor, id);
    if (key === "GET /ncrs/:id/pdf") {
      const r = await this.quality.get(id);
      return {
        buffer: await this.quality.pdf(actor, id),
        contentType: "application/pdf",
        filename: `${r.ncr_number}.pdf`,
      };
    }
    if (key === "POST /ncrs/:id/images")
      return this.files.upload(actor, req, "NCR", id);
    if (key === "GET /ncrs/images/:imageId")
      return this.files.download(actor, params.imageId, res, true);
    if (key === "GET /attachments/:inspectionId")
      return this.files.list(actor, params.inspectionId);
    if (key === "POST /attachments/:inspectionId")
      return this.files.upload(
        actor,
        req,
        "INCOMING_INSPECTION",
        params.inspectionId,
      );
    if (key === "GET /attachments/download/:id")
      return this.files.download(actor, id, res);
    if (key === "DELETE /attachments/:id")
      return this.files.remove(actor, id, "INCOMING_INSPECTION");
    if (key === "GET /drawings") return this.files.drawings(q);
    if (key === "POST /drawings") return this.files.uploadDrawing(actor, req);
    if (
      [
        "GET /drawings/download/:id",
        "GET /drawings/:id/download",
        "GET /drawings/:id/file",
      ].includes(key)
    )
      return this.files.download(actor, id, res);
    if (key === "PATCH /drawings/:id/set-current")
      return this.files.currentDrawing(actor, id);
    if (key === "DELETE /drawings/:id")
      return this.files.remove(actor, id, "INTERNAL_PART");
    if (key === "GET /quality-alerts/count")
      return {
        unacknowledged: await this.qms.db.client.operationalAlert.count({
          where: { acknowledgedAt: null },
        }),
      };
    if (key === "GET /quality-alerts") {
      const alerts = await this.qms.db.client.operationalAlert.findMany({
        where: q.acknowledged === "false" ? { acknowledgedAt: null } : {},
        include: { inspection: true },
        orderBy: { createdAt: "desc" },
      });
      return {
        alerts: alerts.map((a) => ({
          id: a.id,
          inspection_id: a.inspectionId,
          part_number: a.originalPartNumber,
          supplier: a.originalSupplier,
          alert_type: a.type,
          notes: a.notes,
          created_at: p.iso(a.createdAt),
          acknowledged_at: p.iso(a.acknowledgedAt),
          acknowledged_by: a.acknowledgedById,
          form_no: p.object(a.inspection?.planSnapshot).form_no,
          component_type: p.object(a.inspection?.planSnapshot).component_type,
          disposition: a.inspection?.disposition,
        })),
      };
    }
    if (key === "PATCH /quality-alerts/:id/acknowledge") {
      await this.qms.db.client.operationalAlert.update({
        where: { id },
        data: { acknowledgedAt: new Date(), acknowledgedById: actor.userId },
      });
      return { ok: true };
    }
    if (key === "GET /admin/users") return this.admin.list(q);
    if (key === "POST /admin/users") return this.admin.save(actor, null, b);
    if (key === "PATCH /admin/users/:id") return this.admin.save(actor, id, b);
    if (key === "POST /reports/query") {
      const { details, ...report } = await this.metrics.report(b);
      return report;
    }
    if (key === "POST /reports/export/excel")
      return {
        buffer: await qmsReportWorkbook(await this.metrics.report(b)),
        filename: "inspection-report.xlsx",
        contentType: xlsx,
      };
    if (key === "POST /reports/export/pdf")
      return {
        buffer: await qmsReportPdf(await this.metrics.report(b), b),
        filename: "inspection-report.pdf",
        contentType: "application/pdf",
      };
    if (key === "GET /reports/saved") return this.admin.saved(actor);
    if (key === "POST /reports/saved")
      return this.admin.saveReport(actor, null, b);
    if (key === "PATCH /reports/saved/:id")
      return this.admin.saveReport(actor, id, b);
    if (key === "DELETE /reports/saved/:id")
      return this.admin.saveReport(actor, id, b, true);
    if (route.startsWith("/injector-tests"))
      return this.injectorRoute(actor, key, id, b, q);
    throw new NotFoundError("Operational route");
  }
  async importParts(actor: Actor, req: Request) {
    if (Number(req.headers["content-length"] || 0) > 6 * 1024 * 1024)
      throw new BusinessRuleError("Import files up to 5 MB");
    const f = await this.files.files.upload(actor, req);
    if (
      Number(f.sizeBytes) > 5 * 1024 * 1024 ||
      !["xlsx", "csv"].includes(f.extension)
    )
      throw new BusinessRuleError("Import an XLSX or CSV file up to 5 MB");
    const { body } = await this.files.openWhenClean(actor, f.id, "download");
    const chunks: Buffer[] = [];
    for await (const c of body as AsyncIterable<Buffer>)
      chunks.push(Buffer.from(c));
    const rows = await readPartWorkbook(Buffer.concat(chunks), f.extension),
      templates = await this.qms.templates();
    let created = 0,
      updated = 0,
      skipped = 0;
    const errors: string[] = [];
    for (const r of rows) {
      const term = r.productType.toLowerCase().trim();
      const t =
        templates.find((t) =>
          [t.form_no, t.title, t.component_type].some(
            (v) => String(v || "").toLowerCase() === term,
          ),
        ) ||
        templates.find((t) =>
          `${t.form_no} ${t.title} ${t.component_type}`
            .toLowerCase()
            .includes(term),
        );
      if (!r.partNumber || !term || !t) {
        skipped++;
        errors.push(
          `Row ${r.row}: part number or product type is missing or unknown`,
        );
        continue;
      }
      const exists = (
        await this.qms.specs({ template_id: t.id, part_number: r.partNumber })
      ).specs.length;
      await this.qms.saveSpec(actor, null, {
        template_id: t.id,
        part_number: r.partNumber,
        description: r.description,
      });
      if (exists) updated++;
      else created++;
    }
    return { created, updated, skipped, errors };
  }
  async injectorRoute(
    actor: Actor,
    key: string,
    id: string,
    b: Row,
    q: Row,
  ): Promise<any> {
    const s = this.injectors;
    if (key === "GET /injector-tests") return s.list(q);
    if (key === "GET /injector-tests/steps") return s.steps();
    if (key === "GET /injector-tests/settings") return s.settings();
    if (key === "PUT /injector-tests/settings") return s.saveKey(actor, b);
    if (key === "POST /injector-tests/test-connection") return s.connection();
    if (key === "POST /injector-tests/sync") return s.sync(actor, b);
    if (key === "DELETE /injector-tests") return s.clear(actor);
    if (key === "GET /injector-tests/analytics")
      return s.injectors.detailedAnalytics(q);
    if (key === "GET /injector-tests/analytics/export.xlsx")
      return {
        buffer: await s.injectors.detailedAnalytics(q, true),
        contentType: xlsx,
        filename: "Injector-Repair-Analytics.xlsx",
      };
    if (key === "GET /injector-tests/repairs/cases/:id") return s.repair(id);
    if (key === "GET /injector-tests/:id/repair-history") return s.history(id);
    if (key === "GET /injector-tests/:id/quick-entry") return s.quick(id);
    if (key === "POST /injector-tests/:id/quick-entry")
      return s.saveQuick(actor, id, b);
    if (key === "POST /injector-tests/repairs/cases")
      return s.startRepair(actor, b);
    if (key === "POST /injector-tests/repairs/cases/:id/attempts")
      return s.addAttempt(actor, id, b);
    if (key === "PATCH /injector-tests/repairs/cases/:id/status")
      return s.status(actor, id, b);
    if (key === "POST /injector-tests/repairs/attempts/:id/retest")
      return s.retest(actor, id, b);
    if (key === "GET /injector-tests/exports/google-sheet")
      return s.sheetStatus();
    if (key === "POST /injector-tests/exports/google-sheet")
      return s.sheet(actor, b);
    if (key === "POST /injector-tests/report")
      return s.report(actor, "customer", b);
    if (key.startsWith("POST /injector-tests/reports/"))
      return s.report(
        actor,
        key.slice("POST /injector-tests/reports/".length),
        b,
      );
    throw new NotFoundError("Injector route");
  }
}
@Controller("qms")
@AuthorizeInService()
export class QmsController {
  constructor(readonly contracts: QmsContractService) {}
  @All("*path")
  async dispatch(
    @CurrentActor() actor: Actor,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const path =
      "/" +
      (Array.isArray(req.params.path)
        ? req.params.path.join("/")
        : req.params.path);
    const matched = matchQmsRoute(req.method, path);
    if (!matched) throw new NotFoundError("Operational route");
    if (
      actor.userType !== "INTERNAL" ||
      (matched.route.permission !== "session:self" &&
        !actor.permissions.has(matched.route.permission))
    )
      throw new ForbiddenError();
    const result = await this.contracts.handle(
      actor,
      matched.route.path,
      matched.params,
      req,
      res,
    );
    if (result?.buffer) {
      res.set({
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${String(result.filename).replace(/["\\\r\n]/g, "_")}"`,
        "X-Report-Filename": result.filename,
        "Cache-Control": "private, no-store",
      });
      if (result.warnings?.length)
        res.setHeader(
          "X-Report-Warnings",
          encodeURIComponent(result.warnings.join(" ")),
        );
      res.send(result.buffer);
      return;
    }
    if (result !== undefined) res.json(result);
  }
}
@Module({
  imports: [OperationsModule, FilesModule, AdminModule, AuthModule],
  controllers: [QmsController],
  providers: [
    QmsService,
    QmsQualityService,
    QmsMetricsService,
    QmsFilesService,
    QmsAdminService,
    QmsInjectorsService,
    QmsContractService,
  ],
})
export class QmsModule {}
