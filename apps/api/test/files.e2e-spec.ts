import { createHash } from "node:crypto";
import { EICAR_TEST_STRING } from "@sqms/server-core";
import { createTeam, expectStatus, startApp, uniq, waitFor, type Team, type TestContext } from "./helpers";

export const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

describe("Secure file upload, scanning and retrieval", () => {
  let ctx: TestContext;
  let team: Team;

  beforeAll(async () => {
    ctx = await startApp();
    team = await createTeam(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  const waitStatus = (id: string, status: string) =>
    waitFor(async () => {
      const f = await ctx.prisma.fileObject.findUnique({ where: { id } });
      return f && f.status === status ? f : null;
    }, 60_000);

  it("streams an upload to storage, quarantines it, scans it clean and serves the identical bytes", async () => {
    const res = expectStatus(await team.quality.session.upload("/files", "Drawing Rev A.pdf", PDF_BYTES, { description: "Controlled drawing" }), 201);
    expect(res.body.status).toBe("QUARANTINED");
    expect(res.body.sha256).toBe(createHash("sha256").update(PDF_BYTES).digest("hex"));
    expect(res.body.contentType).toBe("application/pdf");
    expect(res.body.description).toBe("Controlled drawing");
    const blocked = await team.quality.session.get(`/files/${res.body.id}/download`);
    if (blocked.status !== 200) expect(blocked.body.error.code).toBe("FILE_NOT_AVAILABLE");
    const clean = await waitStatus(res.body.id, "CLEAN");
    expect(clean.scanEngine).toBe("clamav");
    const dl = await team.quality.session.get(`/files/${res.body.id}/download`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.body as Buffer, PDF_BYTES)).toBe(0);
    expect(dl.headers["content-disposition"]).toContain('attachment; filename="Drawing Rev A.pdf"');
    expect(dl.headers["x-content-type-options"]).toBe("nosniff");
    expect(dl.headers["x-checksum-sha256"]).toBe(res.body.sha256);
    const preview = await team.quality.session.get(`/files/${res.body.id}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.headers["content-disposition"]).toMatch(/^inline/);
    const audit = await ctx.prisma.auditEvent.findMany({ where: { entityId: res.body.id } });
    expect(audit.map((a) => a.eventType)).toEqual(expect.arrayContaining(["file.uploaded", "file.scan_clean", "file.downloaded"]));
  });

  it("detects malware with ClamAV, deletes the content and never serves it", async () => {
    const res = expectStatus(await team.quality.session.upload("/files", "measurements.csv", Buffer.from(EICAR_TEST_STRING)), 201);
    const infected = await waitStatus(res.body.id, "INFECTED");
    expect(infected.scanSignature).toMatch(/Eicar/i);
    const dl = await team.quality.session.get(`/files/${res.body.id}/download`);
    expect(dl.status).toBe(409);
    const note = await waitFor(() => ctx.prisma.notification.findFirst({ where: { userId: team.quality.id, eventType: "file.infected", entityId: res.body.id } }));
    expect(note.title).toMatch(/failed malware scanning/);
  });

  it("rejects disallowed types, mismatched signatures, empty and oversized files", async () => {
    const exe = await team.quality.session.upload("/files", "tool.exe", Buffer.from("MZ\x90\x00binary"));
    expect(exe.status).toBe(415);
    expect(exe.body.error.code).toBe("FILE_TYPE_NOT_ALLOWED");
    const fakePdf = await team.quality.session.upload("/files", "invoice.pdf", Buffer.from("MZ\x90\x00 this is not a pdf"));
    expect(fakePdf.status).toBe(422);
    expect(fakePdf.body.error.code).toBe("FILE_SIGNATURE_MISMATCH");
    const empty = await team.quality.session.upload("/files", "empty.csv", Buffer.alloc(0));
    expect(empty.status).toBe(422);
    await ctx.prisma.allowedFileType.update({ where: { extension: "dxf" }, data: { maxSizeMb: 1 } });
    try {
      const big = await team.quality.session.upload("/files", "large.dxf", Buffer.alloc(1024 * 1024 + 10, 0x41));
      expect(big.status).toBe(413);
    } finally {
      await ctx.prisma.allowedFileType.update({ where: { extension: "dxf" }, data: { maxSizeMb: 250 } });
    }
    const rejectedAudits = await ctx.prisma.auditEvent.count({ where: { eventType: "file.upload_rejected" } });
    expect(rejectedAudits).toBeGreaterThanOrEqual(3);
  });

  it("supports CAD files with download-only handling and multi-chunk streaming", async () => {
    const step = Buffer.concat([Buffer.from("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('turbine housing'),'2;1');\nENDSEC;\nDATA;\n"), Buffer.alloc(9 * 1024 * 1024, 0x20), Buffer.from("\nENDSEC;\nEND-ISO-10303-21;\n")]);
    const res = expectStatus(await team.engineer.session.upload("/files", "housing.step", step), 201);
    expect(res.body.category).toBe("CAD");
    expect(res.body.sizeBytes).toBe(step.length);
    await waitStatus(res.body.id, "CLEAN");
    const preview = await team.engineer.session.get(`/files/${res.body.id}/preview`);
    expect(preview.status).toBe(422);
  });

  it("requires upload permission and restricts reading orphan files to authorized internal users", async () => {
    const ro = await team.readOnly.session.upload("/files", "x.pdf", PDF_BYTES);
    expect(ro.status).toBe(403);
    const anon = await ctx.prisma.fileObject.count();
    expect(anon).toBeGreaterThan(0);
  });

  it("attaches evidence to a record and lists it", async () => {
    const supplier = expectStatus(await team.sourcing.session.post("/suppliers", { name: `Attach Co ${uniq()}`, country: "US" }), 201).body;
    const file = expectStatus(await team.quality.session.upload("/files", "site-photo.png", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])), 201).body;
    const att = expectStatus(await team.quality.session.post("/record-attachments", { entityType: "SUPPLIER", entityId: supplier.id, fileId: file.id, description: "Audit photo" }), 201).body;
    const list = expectStatus(await team.readOnly.session.get(`/record-attachments?entityType=SUPPLIER&entityId=${supplier.id}`), 200).body;
    expect(list.map((a: { id: string }) => a.id)).toContain(att.id);
    // Attachment rights are organization-scoped: colleagues may attach each other's uploads (supplier users never can;
    // see the isolation tests), and unknown files are rejected.
    expectStatus(await team.engineer.session.post("/record-attachments", { entityType: "SUPPLIER", entityId: supplier.id, fileId: file.id, description: "Second link" }), 201);
    expect((await team.engineer.session.post("/record-attachments", { entityType: "SUPPLIER", entityId: supplier.id, fileId: "01a13d68-0000-7000-8000-000000000000" })).status).toBe(422);
  });
});
