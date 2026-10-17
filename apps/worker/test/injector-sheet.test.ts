import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutboxEvent } from "@sqms/db";
import type { WorkerContext } from "../src/context";
import { InjectorSheetAdapter } from "../src/processors/injector-sheet";
import { injectorSheetDay } from "@sqms/server-core";
const payload = {
  mode: "google",
  sheetId: "synthetic-sheet",
  tab: "Passed",
  rows: [["2026-06-29", "001-P", "828"]],
  sourceIds: ["test-1"],
};
const event = {
  id: "delivery-1",
  eventType: "injector.sheet_export.requested",
  payload,
} as unknown as OutboxEvent;
afterEach(() => vi.unstubAllGlobals());
describe("Daily sheet delivery", () => {
  it("uses a local test sink with no outgoing request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const ctx = {
      env: { INJECTOR_SHEET_MODE: "test-sink" },
      log: vi.fn(),
    } as unknown as WorkerContext;
    await new InjectorSheetAdapter(ctx).dispatch({
      ...event,
      payload: { ...payload, mode: "test-sink" },
    } as unknown as OutboxEvent);
    expect(fetch).not.toHaveBeenCalled();
    expect(ctx.log).toHaveBeenCalledWith(
      "info",
      "injector sheet test delivery",
      expect.objectContaining({ rows: 1 }),
    );
  });
  it("recovers append-before-ack failure without appending duplicate test rows", async () => {
    const key = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    let rows: string[][] = [];
    let appends = 0;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("oauth2"))
        return new Response(
          JSON.stringify({ access_token: "synthetic-token" }),
          { status: 200 },
        );
      if (url.includes(":append")) {
        appends++;
        rows.push(...JSON.parse(String(init?.body)).values);
        throw new Error("simulated lost acknowledgement after append");
      }
      return new Response(JSON.stringify({ values: rows }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    const ctx = {
      env: {
        NODE_ENV: "production",
        INJECTOR_SHEET_MODE: "google",
        GOOGLE_SHEET_ID: payload.sheetId,
        GOOGLE_SHEET_TAB: payload.tab,
        GOOGLE_SERVICE_ACCOUNT_EMAIL: "fixture@example.test",
        GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: key,
      },
      log: vi.fn(),
    } as unknown as WorkerContext;
    const adapter = new InjectorSheetAdapter(ctx);
    await expect(adapter.dispatch(event)).rejects.toThrow(
      "simulated lost acknowledgement",
    );
    await expect(adapter.dispatch(event)).resolves.toBeUndefined();
    expect(appends).toBe(1);
    expect(rows).toEqual([
      ["Test Date", "Part Number", "Serial Number", "PDI Delivery ID"],
      [...payload.rows[0], "delivery-1:test-1"],
    ]);
  });
  it("uses the shop day across both DST changes", () => {
    const env = {
      INJECTOR_SHEET_TIMEZONE: "America/Denver",
      INJECTOR_SHEET_DAILY_TIME: "00:05",
    } as WorkerContext["env"];
    expect(injectorSheetDay(env, new Date("2026-03-09T06:06:00Z"))).toBe(
      "2026-03-08",
    );
    expect(injectorSheetDay(env, new Date("2026-11-02T07:06:00Z"))).toBe(
      "2026-11-01",
    );
    expect(injectorSheetDay(env, new Date("2026-11-02T07:04:00Z"))).toBeNull();
  });
});
