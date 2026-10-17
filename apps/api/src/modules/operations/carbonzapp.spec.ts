import { loadEnv } from "@sqms/server-core";
import type { Actor } from "../../common/auth/actor";
import { TEST_ENV } from "../../../test/test-env";
import { CarbonZappService } from "./carbonzapp.service";
import type { InjectorService } from "./injector.service";
const actor = {} as Actor;
const report = (id: string, slot: number, date: string) => ({
  _id: id,
  SlotsData: { position: slot, sn: `SN${slot}` },
  datetime: date,
});
describe("Isolated CarbonZapp reporting transport", () => {
  afterEach(() => jest.restoreAllMocks());
  const setup = (mode = "test-safe") => {
    const syncRecorded = jest.fn().mockResolvedValue({ imported: 3 });
    const env = loadEnv({
      ...TEST_ENV,
      CARBONZAPP_MODE: mode,
      CARBONZAPP_TEST_URL: "http://127.0.0.1:4999/recorded",
      CARBONZAPP_API_KEY: "synthetic-recording-key",
    });
    return {
      syncRecorded,
      service: new CarbonZappService(env, {
        syncRecorded,
      } as unknown as InjectorService),
    };
  };
  it("pages inclusively from a wide initial date and retains sibling report slots", async () => {
    const { service, syncRecorded } = setup();
    const a = report("one", 0, "2026-06-29T16:00:00Z"),
      b = report("one", 1, "2026-06-29T16:00:00Z"),
      c = report("two", 0, "2026-06-30T16:00:00Z");
    const fetch = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify([a])))
      .mockResolvedValueOnce(new Response(JSON.stringify([a, b, c])))
      .mockResolvedValueOnce(new Response(JSON.stringify([c])));
    const result = await service.sync(actor);
    expect(result.pages).toBe(3);
    expect(syncRecorded).toHaveBeenCalledWith(actor, [a, b, c]);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).date_from).toBe(
      "2000-01-01T00:00:00.000Z",
    );
    expect(
      fetch.mock.calls.every(([url]) =>
        String(url).startsWith("http://127.0.0.1:4999/"),
      ),
    ).toBe(true);
  });
  it("commits none of the staged pages after a transport failure", async () => {
    const { service, syncRecorded } = setup();
    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([report("one", 0, "2026-06-29T16:00:00Z")]),
        ),
      )
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    await expect(service.sync(actor)).rejects.toThrow("HTTP 503");
    expect(syncRecorded).not.toHaveBeenCalled();
  });
  it("never calls the network in recorded-only mode", async () => {
    const { service } = setup("recorded");
    const fetch = jest.spyOn(global, "fetch");
    await expect(service.sync(actor)).rejects.toThrow("disabled");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects malformed reporting responses before any target import", async () => {
    const { service, syncRecorded } = setup();
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ unrecognized: [] })));
    await expect(service.sync(actor)).rejects.toThrow("report array");
    expect(syncRecorded).not.toHaveBeenCalled();
  });
});
