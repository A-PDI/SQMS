/**
 * Thin API client for end-to-end tests. The browser drives the user-facing steps of each demo; repetitive
 * preparation (uploading evidence, routine approvals) goes through the same public REST API the UI uses.
 */
import { expect, request, type APIRequestContext, type APIResponse } from "@playwright/test";

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
export const DEMO_PASSWORD = process.env.DEMO_USER_PASSWORD ?? "";
const API = "/api/v1";

/** Fictional demo users created by the demo seed (apps/api/src/seed-demo.ts). */
export const USERS = {
  admin: "admin@demo.sqms.example",
  sourcing: "sam.rivera@demo.sqms.example",
  engineer: "devon.hart@demo.sqms.example",
  engineer2: "erin.cho@demo.sqms.example",
  quality: "quinn.patel@demo.sqms.example",
  quality2: "jordan.moore@demo.sqms.example",
  approver: "morgan.lee@demo.sqms.example",
  readOnly: "riley.ng@demo.sqms.example",
} as const;
export type UserKey = keyof typeof USERS;

/** Minimal valid PDF (passes signature checks and malware scanning). */
export const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

export const uniq = (prefix = "") => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();

type Json = Record<string, unknown>;

export class ApiSession {
  private constructor(
    readonly user: UserKey,
    private readonly ctx: APIRequestContext,
    private csrf: string,
  ) {}

  static async login(user: UserKey): Promise<ApiSession> {
    if (!DEMO_PASSWORD) throw new Error("Set DEMO_USER_PASSWORD to the password used by the demo seed");
    const ctx = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Origin: new URL(BASE_URL).origin } });
    const res = await ctx.post(`${API}/auth/login`, { data: { email: USERS[user], password: DEMO_PASSWORD } });
    if (!res.ok()) throw new Error(`Login failed for ${USERS[user]}: ${res.status()} ${await res.text()}`);
    const me = await (await ctx.get(`${API}/auth/me`)).json();
    return new ApiSession(user, ctx, me.csrfToken as string);
  }

  async dispose() {
    await this.ctx.dispose();
  }

  private async check<T>(res: APIResponse, what: string): Promise<T> {
    if (!res.ok()) throw new Error(`${what} failed: ${res.status()} ${(await res.text()).slice(0, 800)}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  get<T = Json>(path: string, params?: Record<string, string | number | boolean>) {
    return this.ctx.get(`${API}${path}`, { params }).then((r) => this.check<T>(r, `GET ${path}`));
  }

  post<T = Json>(path: string, data: unknown = {}) {
    return this.ctx.post(`${API}${path}`, { data, headers: { "X-CSRF-Token": this.csrf } }).then((r) => this.check<T>(r, `POST ${path}`));
  }

  /** POST expecting a specific error status (for negative checks). */
  async postStatus(path: string, data: unknown = {}) {
    return (await this.ctx.post(`${API}${path}`, { data, headers: { "X-CSRF-Token": this.csrf } })).status();
  }

  patch<T = Json>(path: string, data: unknown) {
    return this.ctx.patch(`${API}${path}`, { data, headers: { "X-CSRF-Token": this.csrf } }).then((r) => this.check<T>(r, `PATCH ${path}`));
  }

  put<T = Json>(path: string, data: unknown) {
    return this.ctx.put(`${API}${path}`, { data, headers: { "X-CSRF-Token": this.csrf } }).then((r) => this.check<T>(r, `PUT ${path}`));
  }

  /** Streams a file as multipart/form-data and waits until malware scanning marks it CLEAN. */
  async uploadClean(name = `evidence-${uniq()}.pdf`, buffer = PDF_BYTES, mimeType = "application/pdf") {
    const res = await this.ctx.post(`${API}/files`, { multipart: { file: { name, mimeType, buffer } }, headers: { "X-CSRF-Token": this.csrf } });
    const file = await this.check<{ id: string }>(res, "upload");
    await expect
      .poll(async () => (await this.get<{ status: string }>(`/files/${file.id}`)).status, { timeout: 120_000, intervals: [1000, 2000, 3000] })
      .toBe("CLEAN");
    return file;
  }
}

/** Logged-in API sessions for the demo team, created lazily. */
export class Team {
  private sessions = new Map<UserKey, ApiSession>();

  async as(user: UserKey) {
    let s = this.sessions.get(user);
    if (!s) {
      s = await ApiSession.login(user);
      this.sessions.set(user, s);
    }
    return s;
  }

  async dispose() {
    await Promise.all([...this.sessions.values()].map((s) => s.dispose()));
    this.sessions.clear();
  }

  /**
   * Approves every pending approval step for a subject, choosing an eligible approver from the team each time
   * (self-approval prevention and role assignment are enforced by the server).
   */
  async approveAll(subjectId: string, approvers: UserKey[] = ["quality2", "engineer", "engineer2", "approver", "quality"]) {
    for (let round = 0; round < 12; round++) {
      let decided = false;
      let pending = false;
      for (const user of approvers) {
        const s = await this.as(user);
        const inbox = await s.get<{ id: string; subjectId: string; canDecide: boolean; version: number }[]>("/approvals/inbox");
        const items = inbox.filter((i) => i.subjectId === subjectId);
        if (items.length) pending = true;
        const item = items.find((i) => i.canDecide);
        if (!item) continue;
        await s.post(`/approvals/${item.id}/decision`, { decision: "APPROVE", comment: "Approved in end-to-end demo", expectedVersion: item.version });
        decided = true;
        break;
      }
      if (!decided) {
        if (pending) throw new Error(`Approval for ${subjectId} is pending but no team member is eligible to decide`);
        return;
      }
    }
    throw new Error(`Approval for ${subjectId} did not complete`);
  }

  /** Creates, uploads, submits and approves the document for a checklist requirement. */
  async fulfilRequirement(requirementId: string, title: string, by: UserKey = "quality") {
    const s = await this.as(by);
    const created = await s.post<{ document: { id: string }; revision: { id: string; version: number } }>(`/required-documents/${requirementId}/create-document`, { title, submissionMethod: "UPLOAD" });
    const file = await s.uploadClean(`${title.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`);
    await s.post(`/documents/${created.document.id}/revisions/${created.revision.id}/files`, { fileId: file.id, role: "PRIMARY" });
    const doc = await s.get<{ revisions: { id: string; version: number }[] }>(`/documents/${created.document.id}`);
    const rev = doc.revisions.find((r) => r.id === created.revision.id)!;
    await s.post(`/documents/${created.document.id}/revisions/${created.revision.id}/submit`, { expectedVersion: rev.version });
    await this.approveAll(created.revision.id);
    return created;
  }

  /** Supplier acknowledgment and engineering verification of every delta requirement, then baseline acceptance. */
  async acceptBaselineAndDelta(revisionId: string) {
    const quality = await this.as("quality");
    const rev = await quality.get<{ version: number; baseline: { status: string } | null; requirements: { id: string; ackStatus: string; verificationStatus?: string }[] }>(`/product-configurations/revisions/${revisionId}`);
    for (const r of rev.requirements) {
      if (r.ackStatus !== "ACKNOWLEDGED") await quality.post(`/product-configurations/requirements/${r.id}/acknowledge`, { status: "ACKNOWLEDGED", acknowledgedByName: "Supplier Quality Manager (fictional)" });
      await quality.post(`/product-configurations/requirements/${r.id}/verify`, { status: "VERIFIED", note: "Verified against the acceptance criteria" });
    }
    const fresh = await quality.get<{ version: number; baseline: { status: string } | null }>(`/product-configurations/revisions/${revisionId}`);
    if (fresh.baseline?.status !== "ACCEPTED") await (await this.as("engineer")).post(`/product-configurations/revisions/${revisionId}/baseline/accept`, { expectedVersion: fresh.version });
  }
}
