import { Inject, Injectable } from "@nestjs/common";
import type { AppEnv } from "@sqms/server-core";
import type { Actor } from "../../common/auth/actor";
import {
  BusinessRuleError,
  ConflictError,
} from "../../common/errors/app-errors";
import { APP_ENV } from "../../infra/tokens";
import { InjectorService } from "./injector.service";
import type { JsonObject } from "./operations.rules";

/** Reporting-only adapter. No equipment-setting routes, webhooks, source deletes or credentials in settings. */
@Injectable()
export class CarbonZappService {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly injectors: InjectorService,
  ) {}
  async sync(actor: Actor, dateFrom?: string, credential?: string) {
    if (!["test-safe", "live"].includes(this.env.CARBONZAPP_MODE))
      throw new ConflictError(
        "Bench transport is disabled; use recorded responses for acceptance testing",
      );
    const url =
      this.env.CARBONZAPP_MODE === "live"
        ? "https://cloudx.carbonzapp.com/userapi/v1/client/getReports"
        : this.env.CARBONZAPP_TEST_URL!;
    const apiKey = credential ?? this.env.CARBONZAPP_API_KEY;
    if (!apiKey)
      throw new BusinessRuleError(
        "CarbonZapp credential is not configured in the deployment environment",
      );
    const reports = new Map<string, JsonObject>();
    let cursor = dateFrom ?? "2000-01-01T00:00:00.000Z";
    let pages = 0;
    let truncated = false;
    const start = Date.now();
    for (let page = 0; page < 100; page++) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            api_key: apiKey,
            ...(cursor ? { date_from: cursor } : {}),
          }),
          signal: AbortSignal.timeout(this.env.CARBONZAPP_TIMEOUT_MS),
        });
      } catch {
        throw new BusinessRuleError(
          "CarbonZapp reporting endpoint did not respond; no local data was removed",
        );
      }
      if (!response.ok)
        throw new BusinessRuleError(
          `CarbonZapp reporting endpoint returned HTTP ${response.status}`,
        );
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new BusinessRuleError("CarbonZapp returned an invalid response");
      }
      const batch = Array.isArray(payload)
        ? payload
        : payload && typeof payload === "object"
          ? ((payload as JsonObject).data ?? (payload as JsonObject).reports)
          : null;
      if (!Array.isArray(batch))
        throw new BusinessRuleError(
          "CarbonZapp response must contain a report array",
        );
      pages++;
      let added = 0;
      let newest: Date | null = null;
      for (const raw of batch) {
        if (!raw || typeof raw !== "object" || !raw._id)
          throw new BusinessRuleError(
            "CarbonZapp returned a report without an identity",
          );
        const key = `${raw._id}:${raw.SlotsData?.position ?? 0}`;
        if (!reports.has(key)) added++;
        reports.set(key, raw);
        const date = new Date(raw.datetime ?? raw.created_at ?? "");
        if (Number.isFinite(date.getTime()) && (!newest || date > newest))
          newest = date;
      }
      if (
        !batch.length ||
        !added ||
        !newest ||
        (cursor && newest.toISOString() <= cursor)
      )
        break;
      cursor = newest.toISOString();
      if (reports.size > 20000 || Date.now() - start > 120000 || page === 99) {
        truncated = true;
        break;
      }
    }
    // All retrieved pages are committed together. A failed fetch cannot leave a partially imported page sequence.
    const result = await this.injectors.syncRecorded(actor, [
      ...reports.values(),
    ]);
    return {
      ...result,
      mode: this.env.CARBONZAPP_MODE,
      pages,
      truncated,
      cursor,
      sourceDeletionsPropagated: false,
      sourceRowCount: reports.size,
      sourceReportIds: [...new Set([...reports.values()].map(r => String(r._id)))],
    };
  }
}
