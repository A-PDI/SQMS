import { Inject, Injectable } from "@nestjs/common";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { AppEnv } from "@sqms/server-core";
import { injectorSheetPreview, queueInjectorSheetDay } from "@sqms/server-core";
import {
  normaliseCriteria,
  matchesInjector,
  matchesStepCriteria,
  matchedStepLabels,
  stepCatalog,
  sameUnitRows,
  buildDimensionalFromTests,
  buildItemForInjector,
  buildSharedSections,
  unitResolver,
  buildReportPreview,
  buildCustomerReport,
  buildShipmentEvaluationReport,
  buildExportModel,
  buildInjectorWorkbook,
  exportFilename,
  validateSelection,
} from "@sqms/legacy-domain";
import type { Actor } from "../../common/auth/actor";
import {
  BusinessRuleError,
  NotFoundError,
} from "../../common/errors/app-errors";
import { APP_ENV } from "../../infra/tokens";
import { InjectorService, presentTest } from "../operations/injector.service";
import { CarbonZappService } from "../operations/carbonzapp.service";
import { IncomingService } from "../operations/incoming.service";
import { QmsService } from "./qms.service";
import * as p from "./qms-presenters";
import type { Row } from "./qms-presenters";
const active = ["OPEN", "HOLD", "ENGINEERING_REVIEW"];
@Injectable()
export class QmsInjectorsService {
  constructor(
    readonly qms: QmsService,
    readonly injectors: InjectorService,
    readonly bench: CarbonZappService,
    readonly incoming: IncomingService,
    @Inject(APP_ENV) readonly env: AppEnv,
  ) {}
  async connection() {
    if (!["test-safe", "live"].includes(this.env.CARBONZAPP_MODE))
      throw new BusinessRuleError(
        "Bench transport is disabled in this test deployment",
      );
    const key = await this.key();
    if (!key)
      throw new BusinessRuleError(
        "No API key configured",
        undefined,
        "NO_API_KEY",
      );
    const url =
      this.env.CARBONZAPP_MODE === "live"
        ? "https://cloudx.carbonzapp.com/userapi/v1/client/getReports"
        : this.env.CARBONZAPP_TEST_URL!;
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        api_key: key,
        date_from: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(this.env.CARBONZAPP_TIMEOUT_MS),
    });
    if (!response.ok)
      throw new BusinessRuleError(
        `CarbonZapp returned HTTP ${response.status}`,
      );
    const data = await response.json();
    const rows = Array.isArray(data)
      ? data
      : (p.object(data).data ?? p.object(data).reports);
    if (!Array.isArray(rows))
      throw new BusinessRuleError("CarbonZapp returned an invalid response");
    return { ok: true, reportCount: rows.length };
  }
  async sync(actor: Actor, body: Row) {
    const settings = await this.settings(),
      credential = await this.key();
    if (!credential)
      throw new BusinessRuleError(
        "No API key configured",
        undefined,
        "NO_API_KEY",
      );
    const full = !!body.full_resync,
      result = await this.bench.sync(
        actor,
        full
          ? "2000-01-01T00:00:00.000Z"
          : (settings.lastSync as string) || undefined,
        credential,
      );
    const stored = await this.qms.db.client.injectorTest.findMany({
      select: { id: true, reportExternalId: true },
    });
    const missing = full
      ? stored.filter(
          (r) => !result.sourceReportIds.includes(r.reportExternalId),
        )
      : [];
    let pruneSkipped: Row | null = null,
      reportsDeleted = 0,
      inspectionsDeleted = 0,
      inspectionsKept = 0;
    if (missing.length) {
      const sharePct = (100 * missing.length) / stored.length;
      const reason = result.truncated
        ? "incomplete_fetch"
        : !result.sourceReportIds.length
          ? "empty_fetch"
          : sharePct > 50 && !body.allow_large_prune
            ? "large_prune"
            : null;
      if (reason)
        pruneSkipped = {
          reason,
          wouldDeleteRows: missing.length,
          wouldDeleteReports: new Set(missing.map((r) => r.reportExternalId))
            .size,
          storedRows: stored.length,
          sharePct,
          limitPct: 50,
        };
      else {
        const removed = await this.removeCachedReports(
          actor,
          missing.map((r) => r.id),
          [...new Set(missing.map((r) => r.reportExternalId))],
        );
        reportsDeleted = removed.reportsDeleted;
        inspectionsDeleted = removed.inspectionsDeleted;
        inspectionsKept = removed.inspectionsKept;
      }
    }
    const lastSync =
      full && !result.sourceReportIds.length
        ? settings.lastSync
        : new Date().toISOString();
    if (lastSync)
      await this.qms.db.client.systemSetting.upsert({
        where: { key: "qms.carbonzapp.last_sync" },
        create: { key: "qms.carbonzapp.last_sync", value: lastSync },
        update: { value: lastSync },
      });
    return {
      ok: true,
      ...result,
      fullResync: full,
      fetched: result.sourceRowCount,
      fetchedTotal: result.sourceRowCount,
      pagesFetched: result.pages,
      fetchTruncated: result.truncated,
      reportsDeleted,
      inspectionsCreated: 0,
      inspectionsDeleted,
      inspectionsKept,
      pruneSkipped,
      storedRows: await this.qms.db.client.injectorTest.count(),
      lastSync,
      repairs_linked: (result as Row).repairsLinked || 0,
    };
  }
  async removeCachedReports(actor: Actor, ids: string[], reportIds: string[]) {
    return this.qms.db.tx(async (tx) => {
      const refs = await tx.externalReference.findMany({
        where: {
          system: "qms-carbonzapp-report",
          entityType: "INCOMING_INSPECTION",
          externalId: { in: reportIds },
        },
      });
      let inspectionsDeleted = 0,
        inspectionsKept = 0;
      for (const ref of refs) {
        await this.qms.db.lockRow(tx, "incoming_inspections", ref.entityId);
        const inspection = await tx.incomingInspection.findUnique({
          where: { id: ref.entityId },
        });
        if (!inspection || inspection.status === "ARCHIVED") continue;
        if (inspection.status === "COMPLETE") inspectionsKept++;
        else {
          await tx.incomingInspection.update({
            where: { id: inspection.id },
            data: { status: "ARCHIVED", version: { increment: 1 } },
          });
          inspectionsDeleted++;
        }
      }
      await tx.externalReference.deleteMany({
        where: {
          system: "qms-carbonzapp-report",
          entityType: "INCOMING_INSPECTION",
          externalId: { in: reportIds },
        },
      });
      const deleted = await tx.injectorTest.deleteMany({
        where: { id: { in: ids } },
      });
      await this.qms.audit.record(
        {
          eventType: "qms.injector.cache_removed",
          entityType: "SYSTEM",
          metadata: {
            count: deleted.count,
            inspectionsDeleted,
            inspectionsKept,
          },
        },
        tx,
      );
      return {
        reportsDeleted: deleted.count,
        inspectionsDeleted,
        inspectionsKept,
      };
    });
  }
  async clear(actor: Actor) {
    const rows = await this.qms.db.client.injectorTest.findMany({
      select: { id: true, reportExternalId: true },
    });
    const result = await this.removeCachedReports(
      actor,
      rows.map((r) => r.id),
      [...new Set(rows.map((r) => r.reportExternalId))],
    );
    await this.qms.db.client.systemSetting.deleteMany({
      where: { key: "qms.carbonzapp.last_sync" },
    });
    return { ok: true, ...result };
  }
  async sheetStatus() {
    const now = new Date(),
      day = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
    const deliveries = await this.qms.db.client.outboxEvent.findMany({
      where: { eventType: "injector.sheet_export.requested" },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    const preview = await injectorSheetPreview(
      this.qms.db.client,
      this.env,
      day,
    );
    return {
      configured: this.env.INJECTOR_SHEET_MODE !== "disabled",
      timeZone: this.env.INJECTOR_SHEET_TIMEZONE,
      dailyTime: this.env.INJECTOR_SHEET_DAILY_TIME,
      columns: ["Test Date", "Part Number", "Serial Number"],
      defaultDay: day,
      preview,
      deliveries,
    };
  }
  async sheet(actor: Actor, body: Row) {
    const today = new Date().toISOString().slice(0, 10),
      yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const from = body.month
        ? today.slice(0, 8) + "01"
        : body.from || body.day || yesterday,
      to = body.month ? yesterday : body.to || body.day || yesterday;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
      throw new BusinessRuleError("Give the day as YYYY-MM-DD");
    const days =
      (new Date(to).getTime() - new Date(from).getTime()) / 86400000 + 1;
    if (days < 1 || days > 366)
      throw new BusinessRuleError("Choose a range of 1–366 days");
    if (!body.dry_run && this.env.INJECTOR_SHEET_MODE === "disabled")
      throw new BusinessRuleError(
        "Google Sheets export is not configured",
        undefined,
        "NOT_CONFIGURED",
      );
    const previews = [];
    for (let n = 0; n < days; n++)
      previews.push(
        await injectorSheetPreview(
          this.qms.db.client,
          this.env,
          new Date(new Date(from).getTime() + n * 86400000)
            .toISOString()
            .slice(0, 10),
        ),
      );
    const rows = previews.reduce((n, p) => n + p.rows.length, 0);
    if (rows > 5000)
      throw new BusinessRuleError("Export at most 5,000 rows at a time");
    const results = [];
    if (!body.dry_run)
      for (const preview of previews)
        results.push(
          await queueInjectorSheetDay(
            this.qms.db.client,
            this.env,
            preview.day,
            actor.userId,
          ),
        );
    return {
      ok: true,
      from,
      to,
      days,
      rows,
      appended: 0,
      queued: !body.dry_run,
      dryRun: !!body.dry_run,
      results,
    };
  }
  async key() {
    if (this.env.CARBONZAPP_API_KEY) return this.env.CARBONZAPP_API_KEY;
    const value = p.object(
      (
        await this.qms.db.client.systemSetting.findUnique({
          where: { key: "qms.carbonzapp.credential" },
        })
      )?.value,
    );
    if (!value.ciphertext) return "";
    const key = createHash("sha256")
      .update("qms-carbonzapp-credential\0" + this.env.CSRF_SECRET)
      .digest();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(value.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, "base64")),
      decipher.final(),
    ]).toString();
  }
  async saveKey(actor: Actor, body: Row) {
    if (typeof body.api_key !== "string" || body.api_key.trim().length < 8)
      throw new BusinessRuleError("A valid API key is required.");
    const key = createHash("sha256")
        .update("qms-carbonzapp-credential\0" + this.env.CSRF_SECRET)
        .digest(),
      iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(body.api_key.trim(), "utf8"),
      cipher.final(),
    ]);
    const value = {
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
    await this.qms.db.tx(async (tx) => {
      await tx.systemSetting.upsert({
        where: { key: "qms.carbonzapp.credential" },
        create: {
          key: "qms.carbonzapp.credential",
          value,
          updatedById: actor.userId,
        },
        update: { value, updatedById: actor.userId },
      });
      await this.qms.audit.record(
        {
          eventType: "qms.carbonzapp.credential_updated",
          entityType: "SYSTEM",
        },
        tx,
      );
    });
    return {
      ok: true,
      apiKeyMasked: "••••••••" + (await this.key()).slice(-4),
    };
  }
  async settings() {
    const key = await this.key(),
      last = await this.qms.db.client.systemSetting.findUnique({
        where: { key: "qms.carbonzapp.last_sync" },
      });
    return {
      hasApiKey: !!key,
      apiKeyMasked: key ? "••••••••" + key.slice(-4) : null,
      apiKeyFromEnv: !!this.env.CARBONZAPP_API_KEY,
      lastSync: last?.value || null,
      exclusions: { serialStartsWith: "R", jobContains: "RMA" },
      fullSyncFrom: "2000-01-01T00:00:00.000Z",
    };
  }
  async tests() {
    return (
      await this.qms.db.client.injectorTest.findMany({
        orderBy: [
          { testAt: "desc" },
          { partNumber: "asc" },
          { serialNumber: "asc" },
          { reportExternalId: "asc" },
          { slotPosition: "asc" },
        ],
      })
    )
      .map(presentTest)
      .filter(
        (r) =>
          !/^R/i.test(String(r.serial_number || "").trim()) &&
          !/RMA/i.test(r.job_number || ""),
      );
  }
  async cases() {
    return this.qms.db.client.injectorRepairCase.findMany({
      include: { attempts: { orderBy: { attemptNumber: "asc" } } },
      orderBy: { openedAt: "desc" },
    });
  }
  roles(rows: Row[], cases: Row[]) {
    const same = (row: Row, s: Row) =>
      s.id === row.id ||
      (s.report_ext_id != null &&
        s.report_ext_id === row.report_ext_id &&
        Number(s.slot_position) === Number(row.slot_position));
    return rows.map((row) => {
      let repair: Row | undefined,
        retest: Row | undefined,
        owner: Row | undefined;
      for (const c of cases)
        for (const a of c.attempts) {
          if (same(row, p.object(a.beforeSnapshot))) {
            repair = a;
            owner = c;
          }
          if (same(row, p.object(a.afterSnapshot))) {
            retest = a;
            owner ||= c;
          }
        }
      if (!owner) return row;
      return {
        ...row,
        repair_case_id: owner.id,
        repair_case_status: owner.status,
        repair_attempt_number: repair?.attemptNumber || null,
        repair_attempt_status: repair?.status || null,
        retest_of_attempt: retest?.attemptNumber || null,
        retest_outcome: retest?.outcome || null,
      };
    });
  }
  async list(query: Row) {
    const [all, cases, settings] = await Promise.all([
      this.tests(),
      this.cases(),
      this.settings(),
    ]);
    const criteria = normaliseCriteria(query);
    const pairs = all.map((r) => ({
      part_number: r.part_number,
      serial_number: r.serial_number,
    }));
    const matches = new Map<string, string[]>();
    for (const token of criteria.serialNumbers)
      for (const row of sameUnitRows([token], pairs)) {
        const key = `${row.part_number}\0${row.serial_number}`;
        matches.set(key, [...(matches.get(key) || []), token]);
      }
    const rows: Row[] = all
      .filter(
        (r) =>
          matchesInjector(r, {
            ...criteria,
            serialNumbers: [],
            __normalised: true,
          }) &&
          (!criteria.serialNumbers.length ||
            criteria.serialNumbers.some((t: string) =>
              String(r.serial_number || "")
                .toLowerCase()
                .includes(t.toLowerCase()),
            ) ||
            matches.has(`${r.part_number}\0${r.serial_number}`)),
      )
      .map((r) => {
        const { tests, report_json, ...summary } = r;
        const tokens = matches.get(`${r.part_number}\0${r.serial_number}`);
        return {
          ...summary,
          ...(tokens ? { serial_unit_match: tokens } : {}),
          ...(criteria.steps.length
            ? { matched_steps: matchedStepLabels(r, criteria) }
            : {}),
        };
      });
    const refs = await this.qms.db.client.externalReference.findMany({
      where: {
        system: "qms-carbonzapp-report",
        entityType: "INCOMING_INSPECTION",
      },
    });
    return {
      injectors: this.roles(
        rows.map((r) => ({
          ...r,
          inspection_id:
            refs.find((ref) => ref.externalId === r.report_ext_id)?.entityId ||
            r.inspection_id ||
            null,
        })),
        cases,
      ),
      total: all.length,
      filtered: rows.length,
      lastSync: settings.lastSync,
      hasApiKey: settings.hasApiKey,
    };
  }
  async steps() {
    const rows = await this.tests();
    return { steps: stepCatalog(rows), injectorCount: rows.length };
  }
  async selected(body: Row) {
    if (
      !Array.isArray(body.injector_ids) ||
      !body.injector_ids.length ||
      body.injector_ids.length > 500
    )
      throw new BusinessRuleError("Select 1–500 injectors.");
    const rows = await this.injectors.selected(body.injector_ids),
      validation = validateSelection(rows);
    if (!validation.ok) throw new BusinessRuleError(validation.message);
    return { rows, validation };
  }
  async report(actor: Actor, path: string, body: Row) {
    const { rows, validation } = await this.selected(body),
      options = { vendorName: String(body.vendor_name || "").slice(0, 120) };
    await this.qms.audit.record({
      eventType: "qms.injector.report_generated",
      entityType: "SYSTEM",
      metadata: { type: path, ids: body.injector_ids },
    });
    if (path === "preview")
      return {
        ok: true,
        preview: buildReportPreview(rows),
        warnings: validation.warnings,
      };
    if (path === "inspection")
      return this.inspectionReports(actor, rows, validation.warnings);
    if (path === "custom.xlsx") {
      const model = buildExportModel(rows, options);
      return {
        buffer: await buildInjectorWorkbook(model),
        filename: exportFilename(model, "xlsx"),
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        warnings: validation.warnings,
      };
    }
    if (
      ["shipment-evaluation", "supplier-evaluation"].includes(path) &&
      !options.vendorName.trim()
    )
      throw new BusinessRuleError(
        "A vendor name is required for the Shipment Evaluation Report.",
      );
    const result = ["shipment-evaluation", "supplier-evaluation"].includes(path)
      ? await buildShipmentEvaluationReport(rows, options)
      : await buildCustomerReport(rows, options);
    return {
      ...result,
      contentType: "application/pdf",
      warnings: validation.warnings,
    };
  }
  async inspectionReports(actor: Actor, rows: Row[], warnings: string[]) {
    const t = (await this.qms.templates()).find(
      (t) => t.form_no === "PDI-IQI-012",
    );
    if (!t) throw new NotFoundError("Fuel Injector template");
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const key = r.report_ext_id || `single:${r.id}`;
      groups.set(key, [...(groups.get(key) || []), r]);
    }
    const inspections = [];
    let created = 0,
      updated = 0;
    for (const [reportId, group] of groups) {
      group.sort(
        (a, b) =>
          (a.slot_position || 0) - (b.slot_position || 0) ||
          String(a.serial_number || "").localeCompare(
            String(b.serial_number || ""),
          ),
      );
      const sections = structuredClone(t.sections);
      sections.dimensional = {
        title: "C. DIMENSIONAL INSPECTION — INJECTOR TEST BENCH RESULTS",
        section_type: "dimensional",
        layout: "single_value",
        items: buildDimensionalFromTests(group[0].tests).items,
      };
      const section_data = {
        __shared: buildSharedSections(sections),
        __items: group.map((r) => buildItemForInjector(r, sections)),
        __dimensional_added: true,
        __admin_sections: sections,
        __injector_source: {
          report_ext_id: reportId,
          injectors: group.map((r) => ({
            id: r.id,
            slot_position: r.slot_position,
            serial: r.serial_number,
          })),
        },
      };
      const head = group[0],
        serials = group.map((r) => r.serial_number).filter(Boolean),
        disposition = group.every((r) => r.overall_pass != null)
          ? group.some((r) => r.overall_pass === 0)
            ? "FAIL"
            : "PASS"
          : "";
      const body = {
        template_id: t.id,
        part_number: head.part_number,
        supplier: head.brand,
        po_number: null,
        description: [head.brand, head.injector_type].filter(Boolean).join(" "),
        date_received: (head.test_datetime || new Date().toISOString()).slice(
          0,
          10,
        ),
        inspector_name: actor.displayName,
        lot_serial_no: serials.join(", "),
        item_count: group.length,
        section_data,
        disposition,
      };
      let link = await this.qms.db.client.externalReference.findUnique({
        where: {
          system_entityType_externalId: {
            system: "qms-carbonzapp-report",
            entityType: "INCOMING_INSPECTION",
            externalId: reportId,
          },
        },
      });
      let inspectionId = link?.entityId;
      if (inspectionId) {
        const r = (await this.qms.detail(inspectionId)).inspection;
        if (r.status !== "complete")
          await this.qms.update(actor, inspectionId, body);
        updated++;
      } else {
        const r = await this.qms.create(actor, body);
        inspectionId = r.inspection.id;
        await this.qms.update(actor, inspectionId!, { disposition });
        await this.qms.db.client.externalReference.create({
          data: {
            system: "qms-carbonzapp-report",
            entityType: "INCOMING_INSPECTION",
            externalId: reportId,
            entityId: inspectionId!,
          },
        });
        created++;
      }
      const safe = (v: any, fallback: string) =>
        String(v || fallback).replace(/[^a-zA-Z0-9._-]/g, "_");
      inspections.push({
        inspection_id: inspectionId,
        report_ext_id: reportId,
        created: !link,
        injector_count: group.length,
        part_number: head.part_number || null,
        serial_numbers: serials,
        filename: `QC_${safe(head.part_number, "NoPart")}_${safe(serials.join("-"), "NoSerial")}.pdf`,
      });
    }
    return { ok: true, inspections, created, updated, warnings };
  }
  presentCase(c: Row) {
    const initial = p.object(c.initialTestSnapshot),
      final = p.object(c.finalTestSnapshot);
    const attempts = c.attempts.map((a: Row) => {
      const before = p.object(a.beforeSnapshot),
        after = p.object(a.afterSnapshot);
      return {
        ...a,
        repair_case_id: c.id,
        attempt_number: a.attemptNumber,
        before_test_id: before.id,
        before_report_ext_id: before.report_ext_id,
        before_slot_position: before.slot_position,
        before_test_datetime: before.test_datetime,
        before_serial_number: before.serial_number,
        before_result_status: String(
          before.result_status || "unknown",
        ).toUpperCase(),
        after_test_id: after.id || null,
        after_report_ext_id: after.report_ext_id || null,
        after_slot_position: after.slot_position || null,
        after_test_datetime: after.test_datetime || null,
        after_serial_number: after.serial_number || null,
        after_result_status: after.result_status
          ? after.result_status.toUpperCase()
          : null,
        repair_date: p.iso(a.repairDate),
        expected_outcome: a.expectedOutcome,
        observed_outcome: a.observedOutcome,
        repair_notes: a.notes,
        deltas: (a.deltas || []).map((d: Row) => ({
          ...d,
          id: `${a.id}:${d.key}`,
          step_key: d.key,
          step_name: d.stepName || d.before?.stepName || d.key,
          step_code: d.stepCode || d.before?.stepCode,
          before_value: d.before?.value ?? null,
          after_value: d.after?.value ?? null,
          before_status: d.before?.status,
          after_status: d.after?.status,
          target_value: d.target,
          absolute_delta: d.absolute,
          percent_delta: d.percent,
          correction_effectiveness: d.effectiveness,
          before_distance_from_target: d.beforeDistance,
          after_distance_from_target: d.afterDistance,
          effectiveness: d.effectiveness,
          unit: d.before?.unit || d.after?.unit,
        })),
      };
    });
    return {
      id: c.id,
      part_number: c.partNumber,
      serial_number: c.serialNumber,
      status: c.status,
      failure_categories: c.failureCategories,
      initial_test_id: initial.id,
      initial_test_datetime: initial.test_datetime,
      initial_result_status: String(
        initial.result_status || "unknown",
      ).toUpperCase(),
      final_test_id: final.id || null,
      final_test_datetime: final.test_datetime || null,
      opened_at: p.iso(c.openedAt),
      closed_at: p.iso(c.closedAt),
      attempt_count: attempts.length,
      attempts,
    };
  }
  async repair(id: string) {
    return this.presentCase(await this.injectors.repair(id));
  }
  async history(id: string) {
    const test = presentTest(await this.injectors.get(id)),
      all = await this.tests(),
      cases = await this.cases();
    const known = [
      ...all
        .filter((r) => r.part_number === test.part_number)
        .map((r) => r.serial_number),
      ...cases
        .filter((c) => c.partNumber === test.part_number)
        .map((c) => c.serialNumber),
    ];
    const resolve = unitResolver(known);
    const same = all.filter(
      (r) =>
        r.part_number === test.part_number &&
        resolve(r.serial_number) === resolve(test.serial_number),
    );
    const serials = new Set(
      known.filter((serial) => resolve(serial) === resolve(test.serial_number)),
    );
    const selected = cases.filter(
        (c) => c.partNumber === test.part_number && serials.has(c.serialNumber),
      ),
      current = selected.find((c) => active.includes(c.status)),
      last = current?.attempts.at(-1);
    const used = new Set(
      cases.flatMap((c) => c.attempts.map((a) => p.object(a.afterSnapshot).id)),
    );
    const candidates =
      last?.status === "WAITING_RETEST"
        ? same
            .filter(
              (r: Row) =>
                r.id !== p.object(last.beforeSnapshot).id &&
                r.test_datetime > p.object(last.beforeSnapshot).test_datetime &&
                !used.has(r.id),
            )
            .sort((a: Row, b: Row) =>
              a.test_datetime.localeCompare(b.test_datetime),
            )
        : [];
    const quick = await this.injectors.quickContext(id);
    return {
      test: {
        ...test,
        testId: test.id,
        reportExtId: test.report_ext_id,
        slotPosition: test.slot_position,
        testDatetime: test.test_datetime,
        resultStatus: String(test.result_status || "unknown").toUpperCase(),
      },
      cases: selected.map((c) => this.presentCase(c)),
      active_case_id: current?.id || null,
      candidate_retests: candidates,
      can_start: !current && quick.canSave,
      options: {
        components: [
          "Nozzle",
          "Needle",
          "Control Valve",
          "Control Ball",
          "Armature",
          "Stator",
          "Solenoid",
          "Spring",
          "Nozzle Nut",
          "Valve Body",
          "Housing",
          "Other",
        ],
        actions: [
          "Adjusted",
          "Replaced",
          "Reworked",
          "Cleaned",
          "Retorqued",
          "Lapped",
          "Inspected",
          "No Change",
        ],
      },
    };
  }
  async quick(id: string) {
    const c = await this.injectors.quickContext(id);
    return {
      measurements: c.measurements,
      can_save: c.canSave,
      reason: c.reason,
      attempt_number: c.attemptNumber,
      links_previous_retest: c.linksPreviousRetest,
    };
  }
  async saveQuick(actor: Actor, id: string, body: Row) {
    const c = await this.injectors.quickContext(id),
      r = await this.injectors.quickRepair(actor, id, {
        measurements: body.measurements,
        expectedCaseVersion: c.expectedCaseVersion,
        repairDate: body.repair_date || new Date().toISOString(),
      });
    return { ok: true, repair_case: await this.repair(r.caseId) };
  }
  attempt(body: Row, version: number, before: string) {
    return {
      expectedVersion: version,
      beforeTestId: before,
      repairDate: body.repair_date || new Date().toISOString(),
      technician: body.technician,
      diagnosis: body.diagnosis,
      hypothesis: body.hypothesis,
      expectedOutcome: body.expected_outcome,
      notes: body.repair_notes,
      changes: body.changes,
    };
  }
  async startRepair(actor: Actor, body: Row) {
    if (!body.attempt)
      throw new BusinessRuleError("Record the first repair attempt");
    const a = this.attempt(body.attempt, 0, body.initial_test_id);
    const c = await this.injectors.openRepairWithAttempt(
      actor,
      {
        testId: body.initial_test_id,
        failureCategories: body.failure_categories || [],
      },
      a,
    );
    return { ok: true, repair_case: await this.repair(c.id) };
  }
  async addAttempt(actor: Actor, id: string, body: Row) {
    const c = await this.injectors.repair(id),
      last = c.attempts.at(-1),
      before =
        p.object(last?.afterSnapshot).id || p.object(c.initialTestSnapshot).id;
    await this.injectors.addAttempt(
      actor,
      id,
      this.attempt(body, c.version, before),
    );
    return { ok: true, repair_case: await this.repair(id) };
  }
  async retest(actor: Actor, id: string, body: Row) {
    const a = await this.qms.db.client.injectorRepairAttempt.findUniqueOrThrow({
      where: { id },
    });
    await this.injectors.retest(actor, id, {
      expectedVersion: a.version,
      afterTestId: body.after_test_id,
      observedOutcome:
        body.observed_outcome || "Retest linked in Repair History",
    });
    return { ok: true, repair_case: await this.repair(a.repairCaseId) };
  }
  async status(actor: Actor, id: string, body: Row) {
    const c = await this.injectors.repair(id);
    await this.injectors.setStatus(
      actor,
      id,
      c.version,
      body.status,
      "Status changed in Repair History",
    );
    return { ok: true, repair_case: await this.repair(id) };
  }
}
