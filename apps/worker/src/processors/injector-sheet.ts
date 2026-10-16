import { createSign } from "node:crypto";
import type { OutboxEvent } from "@sqms/db";
import { injectorSheetDay, queueInjectorSheetDay } from "@sqms/server-core";
import type { WorkerContext } from "../context";
import type { IntegrationAdapter } from "./outbox";

export async function dailyInjectorSheet(ctx: WorkerContext) {
  if (ctx.env.INJECTOR_SHEET_MODE === "disabled") return 0;
  const day = injectorSheetDay(ctx.env);
  if (!day) return 0;
  return (await queueInjectorSheetDay(ctx.prisma, ctx.env, day)).queued ? 1 : 0;
}
export class InjectorSheetAdapter implements IntegrationAdapter {
  readonly name = "injector-sheet";
  constructor(private readonly ctx: WorkerContext) {}
  handles(type: string) {
    return type === "injector.sheet_export.requested";
  }
  async dispatch(event: OutboxEvent) {
    const payload = event.payload as {
      mode: string;
      sheetId: string | null;
      tab: string;
      rows: string[][];
      sourceIds: string[];
    };
    if (
      payload.mode === "test-sink" &&
      this.ctx.env.INJECTOR_SHEET_MODE === "test-sink"
    ) {
      this.ctx.log("info", "injector sheet test delivery", {
        eventId: event.id,
        rows: payload.rows.length,
      });
      return;
    }
    const env = this.ctx.env;
    if (
      env.INJECTOR_SHEET_MODE !== "google" ||
      payload.mode !== "google" ||
      env.NODE_ENV !== "production" ||
      !payload.sheetId ||
      env.GOOGLE_SHEET_ID !== payload.sheetId ||
      env.GOOGLE_SHEET_TAB !== payload.tab
    )
      throw new Error(
        "Sheet delivery is disabled or destination changed; review this pending export",
      );
    const encode = (v: unknown) =>
      Buffer.from(JSON.stringify(v)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    const signature = signer.sign(
      env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, "\n"),
      "base64url",
    );
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      redirect: "error",
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${signature}`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!tokenResponse.ok)
      throw new Error(
        `Google authorization failed (HTTP ${tokenResponse.status})`,
      );
    const token = ((await tokenResponse.json()) as { access_token?: string })
      .access_token;
    if (!token)
      throw new Error("Google authorization returned no access token");
    const tab = `'${payload.tab.replaceAll("'", "''")}'`;
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(payload.sheetId)}/values/`;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const get = await fetch(`${base}${encodeURIComponent(`${tab}!A:D`)}`, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!get.ok)
      throw new Error(`Google sheet read failed (HTTP ${get.status})`);
    const prior = ((await get.json()) as { values?: string[][] }).values ?? [];
    // A fourth delivery-key column makes a retry after append-but-before-ack recoverable.
    if (prior.length && prior[0]?.[3] !== "PDI Delivery ID")
      throw new Error(
        "Sheet header must include PDI Delivery ID in column D; use a dedicated reviewed destination tab",
      );
    const seen = new Set(prior.slice(1).map((r) => r[3]));
    const rows = payload.rows
      .map((r, i) => [...r, `${event.id}:${payload.sourceIds[i]}`])
      .filter((r) => !seen.has(r[3]));
    if (!prior.length)
      rows.unshift([
        "Test Date",
        "Part Number",
        "Serial Number",
        "PDI Delivery ID",
      ]);
    if (!rows.length) return;
    // RAW protects identifiers and prevents a bench-provided value being interpreted as a formula.
    const append = await fetch(
      `${base}${encodeURIComponent(`${tab}!A:D`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        headers,
        redirect: "error",
        body: JSON.stringify({ values: rows }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!append.ok)
      throw new Error(`Google sheet append failed (HTTP ${append.status})`);
  }
}
