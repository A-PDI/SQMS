/**
 * Integration tests against real infrastructure (docker compose services or local equivalents):
 * ClamAV (clamd), S3-compatible storage (MinIO) and SMTP (Mailpit).
 */
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { ClamdScanner, EICAR_TEST_STRING, EicarTestScanner, ObjectStorage, renderNotificationEmail, SmtpEmailAdapter } from "../src";

const env = (k: string, d: string) => process.env[k] ?? d;

describe("ClamdScanner (INSTREAM)", () => {
  const scanner = new ClamdScanner(env("CLAMAV_HOST", "127.0.0.1"), Number(env("CLAMAV_PORT", "3310")), 60_000);

  it("responds to PING", async () => {
    expect(await scanner.ping()).toBe(true);
  });

  it("reports clean content as clean", async () => {
    const verdict = await scanner.scan(Readable.from([Buffer.from("%PDF-1.7\nclean engineering drawing content\n")]));
    expect(verdict.status).toBe("clean");
  });

  it("detects the EICAR test signature", async () => {
    const verdict = await scanner.scan(Readable.from([Buffer.from(EICAR_TEST_STRING)]));
    expect(verdict.status).toBe("infected");
    if (verdict.status === "infected") expect(verdict.signature).toMatch(/Eicar/i);
  });

  it("scans multi-chunk streams larger than one chunk", async () => {
    const chunks = Array.from({ length: 64 }, () => Buffer.alloc(64 * 1024, 0x41));
    expect((await scanner.scan(Readable.from(chunks))).status).toBe("clean");
  });
});

describe("EicarTestScanner", () => {
  it("detects EICAR across chunk boundaries", async () => {
    const s = EICAR_TEST_STRING;
    const verdict = await new EicarTestScanner().scan(Readable.from([Buffer.from(s.slice(0, 40)), Buffer.from(s.slice(40))]));
    expect(verdict.status).toBe("infected");
  });
});

describe("ObjectStorage (S3 / MinIO)", () => {
  const storage = new ObjectStorage({
    endpoint: env("S3_ENDPOINT", "http://127.0.0.1:9000"),
    region: env("S3_REGION", "us-east-1"),
    bucket: env("S3_BUCKET_TEST", "sqms-core-test"),
    accessKeyId: env("S3_ACCESS_KEY_ID", "sqmsminio"),
    secretAccessKey: env("S3_SECRET_ACCESS_KEY", "sqmsminio-dev-secret"),
    forcePathStyle: true,
  });

  it("creates the bucket, streams an object up and down, and deletes it", async () => {
    await storage.ensureBucket(true);
    const key = `test/${randomUUID()}`;
    const payload = Buffer.alloc(9 * 1024 * 1024, 7); // > one 8 MiB part -> multipart upload
    await storage.putStream(key, Readable.from([payload]), "application/octet-stream");
    expect(await storage.exists(key)).toBe(true);
    const { body } = await storage.getStream(key);
    const parts: Buffer[] = [];
    for await (const c of body) parts.push(c as Buffer);
    expect(Buffer.concat(parts).equals(payload)).toBe(true);
    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  });
});

describe("SmtpEmailAdapter (Mailpit)", () => {
  it("delivers a message", async () => {
    const adapter = new SmtpEmailAdapter({ host: env("SMTP_HOST", "127.0.0.1"), port: Number(env("SMTP_PORT", "1025")), secure: false, requireTLS: false, from: "SQMS <no-reply@sqms.local>" });
    const subjectToken = randomUUID();
    const rendered = renderNotificationEmail({ productName: "SQMS", title: `Test ${subjectToken}`, body: "Body <b>escaped</b>", link: "http://localhost:3000/x" });
    expect(rendered.html).not.toContain("<b>escaped</b>");
    const res = await adapter.send({ to: "qa@sqms.local", subject: rendered.subject, text: rendered.text, html: rendered.html });
    expect(res.providerMessageId).toBeTruthy();
    const api = env("MAILPIT_API", "http://127.0.0.1:8025");
    const search = await fetch(`${api}/api/v1/search?query=${encodeURIComponent(subjectToken)}`).then((r) => r.json() as Promise<{ messages_count: number }>);
    expect(search.messages_count).toBe(1);
  });
});
