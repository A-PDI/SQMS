/**
 * Demonstration data seed (fictional companies, people and parts).
 *
 * Runs the real API in-process and creates every record through its public endpoints, so all validation,
 * workflow rules, approvals and the audit trail apply exactly as for real users. Requires the worker to be running
 * (uploaded evidence must pass malware scanning before it can be attached).
 *
 * Safety: refuses to run when NODE_ENV=production and requires DEMO_USER_PASSWORD (no default password).
 */
import "reflect-metadata";
import type { AddressInfo } from "node:net";
import { createPrismaClient, hashPassword, passwordPolicyViolation, type PrismaClient } from "@sqms/db";
import { loadEnv } from "@sqms/server-core";
import { createApp } from "./bootstrap";

const DEMO_MARKER = "demo.seededAt";
const DOMAIN = "demo.sqms.example";

type Json = Record<string, unknown>;

function log(msg: string) {
  // eslint-disable-next-line no-console
  console.log(`[seed:demo] ${msg}`);
}

/** Builds a small, valid single-page PDF so evidence previews render in the browser. */
export function demoPdf(title: string, lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, "?");
  const text = [`BT /F1 16 Tf 72 720 Td (${esc(title)}) Tj ET`, ...lines.map((l, i) => `BT /F1 11 Tf 72 ${690 - i * 16} Td (${esc(l)}) Tj ET`)].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    what: string,
  ) {
    super(`${what} failed with HTTP ${status}: ${JSON.stringify(body)}`);
  }
}

/** Minimal cookie-session API client (same flow as the web application: session cookie + CSRF header). */
class Client {
  private cookie = "";
  private csrf = "";
  userId = "";

  constructor(
    private readonly base: string,
    readonly name: string,
  ) {}

  async login(email: string, password: string) {
    const res = await fetch(`${this.base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    const body = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) throw new ApiError(res.status, body, `login ${email}`);
    this.cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    this.csrf = String(body.csrfToken);
    this.userId = String(((await this.get("/auth/me")) as Json).id);
    return this;
  }

  private async send(method: string, path: string, body?: unknown, form?: FormData): Promise<unknown> {
    const headers: Record<string, string> = { cookie: this.cookie };
    if (method !== "GET") headers["x-csrf-token"] = this.csrf;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${this.base}${path}`, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) throw new ApiError(res.status, parsed, `${this.name} ${method} ${path}`);
    return parsed;
  }

  get<T = Json>(path: string) {
    return this.send("GET", path) as Promise<T>;
  }
  post<T = Json>(path: string, body: unknown = {}) {
    return this.send("POST", path, body) as Promise<T>;
  }
  patch<T = Json>(path: string, body: unknown) {
    return this.send("PATCH", path, body) as Promise<T>;
  }
  put<T = Json>(path: string, body: unknown) {
    return this.send("PUT", path, body) as Promise<T>;
  }
  upload<T = Json>(path: string, filename: string, bytes: Buffer, type = "application/pdf") {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type }), filename);
    return this.send("POST", path, undefined, form) as Promise<T>;
  }
}

interface Team {
  admin: Client;
  sourcing: Client;
  engineer: Client;
  engineer2: Client;
  quality: Client;
  quality2: Client;
  manager: Client;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitClean(prisma: PrismaClient, fileId: string) {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const f = await prisma.fileObject.findUnique({ where: { id: fileId } });
    if (f?.status === "CLEAN") return;
    if (f && ["INFECTED", "SCAN_FAILED", "REJECTED"].includes(f.status)) throw new Error(`Demo file ${fileId} was ${f.status}`);
    if (Date.now() > deadline) throw new Error("Timed out waiting for malware scanning. Is the worker (and ClamAV) running?");
    await sleep(500);
  }
}

/** Approves every pending approval of a subject with the first eligible demo approver. */
async function approveAll(prisma: PrismaClient, team: Team, subjectId: string, comment = "Reviewed and approved") {
  const approvers = [team.engineer, team.engineer2, team.quality2, team.manager, team.quality];
  for (let guard = 0; guard < 12; guard++) {
    if (!(await prisma.workflowInstance.findFirst({ where: { subjectId, status: "ACTIVE" } }))) return;
    let decided = false;
    for (const c of approvers) {
      const inbox = await c.get<{ id: string; subjectId: string; canDecide: boolean }[]>("/approvals/inbox");
      const item = inbox.find((i) => i.subjectId === subjectId && i.canDecide);
      if (!item) continue;
      await c.post(`/approvals/${item.id}/decision`, { decision: "APPROVE", comment });
      decided = true;
      break;
    }
    if (!decided) throw new Error(`No eligible demo approver for ${subjectId}`);
  }
}

async function evidence(prisma: PrismaClient, c: Client, name: string, title: string, lines: string[]) {
  const f = await c.upload<{ id: string }>("/files", name, demoPdf(title, lines));
  await waitClean(prisma, f.id);
  return f.id;
}

/** Creates the evidence document for a checklist requirement, submits it and approves it through its workflow. */
async function fulfil(prisma: PrismaClient, team: Team, requirementId: string, author = team.quality) {
  const req = await prisma.requiredDocument.findUniqueOrThrow({ where: { id: requirementId }, include: { documentType: true } });
  const title = `${req.documentType.acronym ?? req.documentType.code} - ${req.documentType.name}`.slice(0, 280);
  const created = await author.post<{ document: { id: string }; revision: { id: string } }>(`/required-documents/${requirementId}/create-document`, { title, submissionMethod: "UPLOAD" });
  const fileId = await evidence(prisma, author, `${req.documentType.code}.pdf`, title, ["Demonstration evidence (fictional data).", `Document type: ${req.documentType.code}`, `Requirement reason: ${req.reason ?? "-"}`]);
  await author.post(`/documents/${created.document.id}/revisions/${created.revision.id}/files`, { fileId });
  const rev = await prisma.documentRevision.findUniqueOrThrow({ where: { id: created.revision.id } });
  await author.post(`/documents/${created.document.id}/revisions/${created.revision.id}/submit`, { expectedVersion: rev.version });
  await approveAll(prisma, team, created.revision.id);
}

async function createUsers(prisma: PrismaClient, password: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { code: "INTERNAL" } });
  const hash = await hashPassword(password);
  const people: { key: keyof Team | "reader"; email: string; name: string; title: string; roles: string[] }[] = [
    { key: "admin", email: `admin@${DOMAIN}`, name: "Alex Admin", title: "Systems Administrator", roles: ["SYSTEM_ADMIN"] },
    { key: "sourcing", email: `sam.rivera@${DOMAIN}`, name: "Sam Rivera", title: "Strategic Sourcing Manager", roles: ["SOURCING"] },
    { key: "engineer", email: `erin.cho@${DOMAIN}`, name: "Erin Cho", title: "Product Engineer, Air Systems", roles: ["ENGINEERING"] },
    { key: "engineer2", email: `devon.hart@${DOMAIN}`, name: "Devon Hart", title: "Materials Engineer", roles: ["ENGINEERING"] },
    { key: "quality", email: `quinn.patel@${DOMAIN}`, name: "Quinn Patel", title: "Supplier Quality Engineer", roles: ["SUPPLIER_QUALITY"] },
    { key: "quality2", email: `jordan.moore@${DOMAIN}`, name: "Jordan Moore", title: "Supplier Quality Manager", roles: ["SUPPLIER_QUALITY"] },
    { key: "manager", email: `morgan.lee@${DOMAIN}`, name: "Morgan Lee", title: "Director of Quality", roles: ["APPROVER"] },
    { key: "reader", email: `riley.ng@${DOMAIN}`, name: "Riley Ng", title: "Production Planner", roles: ["READ_ONLY"] },
  ];
  for (const p of people) {
    const roles = await prisma.role.findMany({ where: { key: { in: p.roles } } });
    const existing = await prisma.user.findUnique({ where: { email: p.email } });
    if (existing) continue;
    await prisma.user.create({
      data: { email: p.email, displayName: p.name, jobTitle: p.title, userType: "INTERNAL", status: "ACTIVE", passwordHash: hash, passwordChangedAt: new Date(), memberships: { create: { organizationId: org.id, roles: { create: roles.map((r) => ({ roleId: r.id })) } } } },
    });
  }
  return people;
}

async function approvedSupplier(prisma: PrismaClient, team: Team, input: Json & { certifications?: Json[] }) {
  const { certifications = [], ...body } = input;
  const s = await team.sourcing.post<{ id: string; supplierNumber: string }>("/suppliers", body);
  for (const c of certifications) await team.quality.post(`/suppliers/${s.id}/certifications`, c);
  const q = await team.quality.post<{ id: string; version: number }>(`/suppliers/${s.id}/qualifications`, { type: "INITIAL", proposedStatus: "APPROVED", summary: "Onsite process audit completed; quality system meets requirements." });
  await team.quality.post(`/supplier-qualifications/${q.id}/submit`, { expectedVersion: q.version });
  await approveAll(prisma, team, q.id);
  const site = await prisma.supplierSite.findFirstOrThrow({ where: { supplierId: s.id } });
  return { supplier: s, site };
}

const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

async function main() {
  // Checked before anything else so a production deployment can never receive demonstration accounts.
  if ((process.env.NODE_ENV ?? "").toLowerCase() === "production") {
    throw new Error("Refusing to seed demonstration data into a production environment.");
  }
  const env = loadEnv();
  const password = process.env.DEMO_USER_PASSWORD ?? "";
  const violation = passwordPolicyViolation(password);
  if (!password || violation) throw new Error(`Set DEMO_USER_PASSWORD to a password meeting the policy (${violation ?? "missing"}).`);

  const prisma = createPrismaClient(env.DATABASE_URL, { connectionLimit: 3 });
  try {
    if (await prisma.systemSetting.findUnique({ where: { key: DEMO_MARKER } })) {
      log("Demo data already present; nothing to do.");
      return;
    }
    const people = await createUsers(prisma, password);
    const app = await createApp({ ...env, LOG_LEVEL: "warn" });
    await app.listen(0, "127.0.0.1");
    try {
      const port = (app.getHttpServer().address() as AddressInfo).port;
      const base = `http://127.0.0.1:${port}/api/v1`;
      const byKey = Object.fromEntries(people.map((p) => [p.key, p.email]));
      const team = {} as Team;
      for (const k of ["admin", "sourcing", "engineer", "engineer2", "quality", "quality2", "manager"] as const) team[k] = await new Client(base, k).login(byKey[k], password);
      await seedScenario(prisma, team);
      await prisma.systemSetting.create({ data: { key: DEMO_MARKER, value: new Date().toISOString(), description: "Demonstration data was seeded (non-production only)." } });
      log("Done. Demo users (password from DEMO_USER_PASSWORD):");
      for (const p of people) log(`  ${p.email.padEnd(32)} ${p.roles.join(", ")}`);
    } finally {
      await app.close();
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function seedScenario(prisma: PrismaClient, team: Team) {
  log("Suppliers");
  const apex = await approvedSupplier(prisma, team, {
    name: "Apex Turbo Systems Inc.",
    legalName: "Apex Turbo Systems Incorporated",
    country: "US",
    website: "https://apex-turbo.example",
    sites: [{ siteCode: "DAY", name: "Dayton Turbo Plant", city: "Dayton", region: "OH", country: "US", isManufacturing: true, processes: "Turbocharger assembly, CNC machining, balancing" }],
    certifications: [
      { standard: "IATF 16949", certificateNumber: "IATF-0451122", registrar: "Example Registrar Ltd.", issuedAt: isoDay(-700), expiresAt: isoDay(25), status: "VALID" },
      { standard: "ISO 14001", certificateNumber: "EMS-88120", registrar: "Example Registrar Ltd.", issuedAt: isoDay(-300), expiresAt: isoDay(800), status: "VALID" },
    ],
  });
  await team.quality.post(`/suppliers/${apex.supplier.id}/sites`, { siteCode: "QRO", name: "Queretaro Plant", city: "Queretaro", country: "MX", isManufacturing: true, processes: "Machining, thermal spray coating" });
  const nordic = await approvedSupplier(prisma, team, {
    name: "Nordic Castings AB",
    country: "SE",
    sites: [{ siteCode: "GBG", name: "Gothenburg Foundry", city: "Gothenburg", country: "SE", isManufacturing: true, processes: "Ductile iron and Ni-resist casting, heat treatment" }],
    certifications: [{ standard: "ISO 9001", certificateNumber: "QMS-20931", registrar: "Example Certification AB", issuedAt: isoDay(-400), expiresAt: isoDay(600), status: "VALID" }],
  });
  const delta = await team.sourcing.post<{ id: string }>("/suppliers", { name: "Delta Precision Machining", country: "MX", sites: [{ siteCode: "MTY", name: "Monterrey Machining Center", city: "Monterrey", country: "MX", isManufacturing: true }] });
  const deltaSite = await prisma.supplierSite.findFirstOrThrow({ where: { supplierId: delta.id } });

  log("Pathway C: coated turbine housing (supplier standard turbocharger with company coating requirement)");
  const c = await team.sourcing.post<{ id: string; configurationId: string }>("/sourcing-projects", {
    title: "TC-4410 turbocharger with ceramic-coated turbine housing",
    businessJustification: "Second source for the TC-4410 turbocharger; the coating reduces under-hood temperatures on the 13L platform.",
    annualVolume: 4200,
    targetDate: isoDay(120),
    newPart: { partNumber: "TC-4410-C", description: "Turbocharger, 13L, ceramic-coated turbine housing", criticality: "MEDIUM", application: "13L heavy-duty diesel engine air system" },
    supplierId: apex.supplier.id,
    siteId: apex.site.id,
    pathway: "C",
    reverseEngineeringRequired: false,
    riskFactors: { manufacturingComplexity: "MEDIUM", technologyNovelty: "ESTABLISHED", supplyChain: "LOW", singleSource: "false", regulatoryImpact: "false", fieldHistory: "NONE" },
    riskRationale: "Supplier standard turbocharger; risk driven by the added coating process.",
    newSupplierPart: { supplierPartNumber: "AT-880", description: "Apex AT-880 turbocharger (standard)" },
    customPartNumber: "AT-880-C1",
    specialProcesses: false,
    customerRequirements: true,
    technicalRequirements: "Turbine housing coated with ceramic thermal barrier coating; all other characteristics per supplier standard AT-880.",
    baseline: { specificationNumber: "APX-SPEC-880", specificationRevision: "D", guaranteedCharacteristics: "Compressor map per APX-880-MAP rev D\nRotor balance G2.5\nMax turbine inlet 760 C", performanceRequirements: "Boost 3.2 bar abs at rated speed" },
    deltaRequirements: [
      { category: "COATING", title: "Turbine housing thermal barrier coating", baselineValue: "Uncoated Ni-resist housing", requiredValue: "Yttria-stabilized zirconia, 150-250 um over bond coat", acceptanceCriteria: "Thickness by micrograph at 3 locations; adhesion per ASTM C633 >= 20 MPa" },
      { category: "LABELING", title: "Custom part marking", baselineValue: "AT-880", requiredValue: "AT-880-C1 and company part number TC-4410-C", acceptanceCriteria: "Visual inspection of nameplate" },
    ],
    members: [
      { userId: team.engineer.userId, role: "ENGINEERING", responsibility: "Coating specification and validation" },
      { userId: team.quality.userId, role: "SUPPLIER_QUALITY", responsibility: "Supplier qualification and FAI" },
    ],
  });
  let p = await prisma.sourcingProject.findUniqueOrThrow({ where: { id: c.id } });
  await team.sourcing.post(`/sourcing-projects/${c.id}/submit`, { expectedVersion: p.version });
  await approveAll(prisma, team, c.id, "Intake approved: pathway and risk confirmed");
  for (const r of await prisma.requiredDocument.findMany({ where: { projectId: c.id, status: { in: ["OPEN", "REJECTED"] } } })) {
    if (r.level === "CONDITIONAL") await team.quality.post(`/required-documents/${r.id}/waive`, { justification: "Not required for a supplier-standard product with an approved supplier; covered by existing records." });
    else await fulfil(prisma, team, r.id);
  }
  const rev = await prisma.configurationRevision.findFirstOrThrow({ where: { configurationId: c.configurationId }, orderBy: { revisionNumber: "desc" }, include: { requirements: true } });
  for (const r of rev.requirements) {
    await team.quality.post(`/product-configurations/requirements/${r.id}/acknowledge`, { status: "ACKNOWLEDGED", acknowledgedByName: "Dana Brooks, Apex Quality Manager" });
    await team.engineer.post(`/product-configurations/requirements/${r.id}/verify`, { status: "VERIFIED", note: "Verified on first-article parts" });
  }
  const freshRev = await prisma.configurationRevision.findUniqueOrThrow({ where: { id: rev.id } });
  await team.engineer.post(`/product-configurations/revisions/${rev.id}/baseline/accept`, { expectedVersion: freshRev.version });
  const qual = await team.quality.post<{ id: string }>("/qualifications", { sourcingProjectId: c.id, requiredSampleQty: 5, sampleNotes: "Five production-intent samples from the Dayton line" });
  const fai = await team.quality.post<{ id: string }>(`/qualifications/${qual.id}/first-articles`, { serialNumbers: "DAY-0001 to DAY-0005", inspectionDate: isoDay(-5), characteristicsInspected: 64, nonconformingCount: 0, outcome: "PASS", summary: "All characteristics conforming; coating 180-220 um" });
  await team.quality2.post(`/qualifications/first-articles/${fai.id}/review`, { decision: "ACCEPTED", comment: "FAIR complete and conforming" });
  const t = await team.engineer.post<{ id: string }>(`/qualifications/${qual.id}/tests`, { testType: "DURABILITY", name: "Thermal cycling 500 cycles", acceptanceCriteria: "No coating spallation; housing crack-free" });
  await team.engineer.post(`/qualifications/tests/${t.id}/result`, { outcome: "PASS", resultSummary: "No spallation after 500 cycles; dye penetrant clean", testedAt: isoDay(-3), laboratory: "Company engine lab" });
  await team.quality.post(`/qualifications/tests/${t.id}/review`, { decision: "ACCEPTED", comment: "Meets criteria" });
  const q = await prisma.productQualification.findUniqueOrThrow({ where: { id: qual.id } });
  await team.quality.post(`/qualifications/${qual.id}/submit`, { expectedVersion: q.version });
  await approveAll(prisma, team, qual.id, "Approved for production");
  const approved = await prisma.productQualification.findUniqueOrThrow({ where: { id: qual.id } });

  log("Change request on the approved Path C configuration (left awaiting validation evidence)");
  const cr = await team.sourcing.post<{ id: string; version: number; proposedRevisionId: string }>("/change-requests", {
    supplierProductId: approved.supplierProductId,
    title: "Change thermal barrier coating sub-tier",
    categories: ["COATING", "SUB_TIER"],
    reason: "Current coating sub-tier is consolidating plants; Apex proposes a qualified alternate coater.",
    description: "Move thermal spray coating of AT-880-C1 turbine housings from CoatCo (Dayton) to ThermaSpray (Columbus). Same powder and parameters; new equipment.",
    affectedCharacteristics: "Coating thickness, bond strength",
    proposedImplementationDate: isoDay(60),
    inventoryImpact: "Approx. 300 coated housings in stock at the current coater",
  });
  await team.engineer.put(`/product-configurations/revisions/${cr.proposedRevisionId}/baseline`, { expectedVersion: (await prisma.configurationRevision.findUniqueOrThrow({ where: { id: cr.proposedRevisionId } })).version, coating: "YSZ TBC applied by ThermaSpray Columbus (proposed)" });
  await team.sourcing.post(`/change-requests/${cr.id}/submit`, { expectedVersion: cr.version });
  await team.engineer.post(`/change-requests/${cr.id}/impact-assessments`, { discipline: "ENGINEERING", impactSummary: "Equivalent process; new equipment requires coating validation", affectsFormFitFunction: false, requiresFai: true, requiresMaterialCertificates: true, recommendation: "APPROVE_WITH_CONDITIONS" });
  await team.quality.post(`/change-requests/${cr.id}/impact-assessments`, { discipline: "QUALITY", impactSummary: "New sub-tier must be added to the approved sub-tier list", requiresControlPlanUpdate: true, recommendation: "APPROVE" });
  const crNow = await prisma.changeRequest.findUniqueOrThrow({ where: { id: cr.id } });
  await team.quality.post(`/change-requests/${cr.id}/requalification-decision`, { expectedVersion: crNow.version, riskLevel: "MEDIUM", requiredValidation: "FAI of 5 housings from the new coater, coating material certificates, updated control plan" });

  log("Pathway A: exhaust manifold to company drawing (in progress)");
  const a = await team.sourcing.post<{ id: string }>("/sourcing-projects", {
    title: "EM-2201 exhaust manifold to company drawing",
    businessJustification: "Capacity relief for the exhaust manifold on the 11L platform.",
    newPart: { partNumber: "EM-2201", description: "Exhaust manifold, Ni-resist D5S", criticality: "HIGH" },
    supplierId: nordic.supplier.id,
    siteId: nordic.site.id,
    pathway: "A",
    reverseEngineeringRequired: false,
    riskFactors: { manufacturingComplexity: "HIGH", technologyNovelty: "ESTABLISHED", supplyChain: "MEDIUM", singleSource: "false", regulatoryImpact: "false", fieldHistory: "SOME" },
    specialProcesses: true,
    specialProcessList: "Heat treatment (stress relief)",
    customerRequirements: false,
    baseline: { drawingNumber: "EM-2201", drawingRevision: "C", material: "Ni-resist D5S per ASTM A439", heatTreatment: "Stress relief 620 C" },
    members: [{ userId: team.engineer2.userId, role: "ENGINEERING" }, { userId: team.quality.userId, role: "SUPPLIER_QUALITY" }],
  });
  p = await prisma.sourcingProject.findUniqueOrThrow({ where: { id: a.id } });
  await team.sourcing.post(`/sourcing-projects/${a.id}/submit`, { expectedVersion: p.version });
  await approveAll(prisma, team, a.id);
  for (const code of ["SUP-04", "ENG-01"]) {
    const r = await prisma.requiredDocument.findFirst({ where: { projectId: a.id, documentType: { code } } });
    if (r) await fulfil(prisma, team, r.id);
  }

  log("Pathway B: catalog oil cooler from a prospective supplier (awaiting intake review)");
  const b = await team.sourcing.post<{ id: string; version: number }>("/sourcing-projects", {
    title: "OC-310 oil cooler, supplier catalog item",
    businessJustification: "Cost reduction on the auxiliary oil cooler.",
    newPart: { partNumber: "OC-310", description: "Engine oil cooler, plate type", criticality: "MEDIUM" },
    supplierId: delta.id,
    siteId: deltaSite.id,
    pathway: "B",
    reverseEngineeringRequired: false,
    riskFactors: { manufacturingComplexity: "MEDIUM", technologyNovelty: "ESTABLISHED", supplyChain: "LOW", singleSource: "false", regulatoryImpact: "false", fieldHistory: "NONE" },
    newSupplierPart: { supplierPartNumber: "DPM-OC-310", description: "Plate oil cooler 310 mm" },
    specialProcesses: false,
    customerRequirements: false,
    baseline: { specificationNumber: "DPM-CAT-2026", guaranteedCharacteristics: "Heat rejection 45 kW at 80 l/min" },
  });
  await team.sourcing.post(`/sourcing-projects/${b.id}/submit`, { expectedVersion: b.version });

  log("NCR with concession, and NCR with an issued SCAR");
  const ncrBase = { dateIdentified: isoDay(-2), source: "INCOMING_INSPECTION", supplierProductId: approved.supplierProductId, quantityAffected: 12, quantityInspected: 50, severity: "MAJOR" };
  const ncr1 = await team.quality.post<{ id: string; version: number }>("/ncrs", { ...ncrBase, title: "Nameplate missing company part number", lotNumber: "APX-26-1103", defectDescription: "12 turbochargers received without the TC-4410-C marking on the nameplate", expectedSpecification: "Nameplate shows AT-880-C1 and TC-4410-C", actualCondition: "Nameplate shows AT-880-C1 only", severity: "MINOR", supplierVisible: true, internalNotes: "Engineering confirms no functional impact." });
  await team.quality.post(`/ncrs/${ncr1.id}/containment`, { expectedVersion: ncr1.version, containmentAction: "Lot segregated at receiving", completed: true });
  const concession = await team.quality.post<{ id: string; version: number }>("/deviations", { type: "CONCESSION", title: "Accept lot APX-26-1103 without customer marking", ncrId: ncr1.id, description: "Accept 12 turbochargers; add adhesive label with TC-4410-C at receiving", justification: "Marking is for traceability only; label provides equivalent identification", quantityLimit: 12, lotNumbers: "APX-26-1103" });
  await team.quality.post(`/deviations/${concession.id}/submit`, { expectedVersion: concession.version });
  await approveAll(prisma, team, concession.id);
  let n1 = await prisma.nonconformance.findUniqueOrThrow({ where: { id: ncr1.id } });
  await team.quality2.post(`/ncrs/${ncr1.id}/disposition`, { expectedVersion: n1.version, disposition: "USE_AS_IS_CONCESSION", dispositionNotes: "Use as is under concession; label applied", deviationId: concession.id });
  n1 = await prisma.nonconformance.findUniqueOrThrow({ where: { id: ncr1.id } });
  await team.quality2.post(`/ncrs/${ncr1.id}/close`, { expectedVersion: n1.version, comment: "Labels applied and verified" });

  const ncr2 = await team.quality.post<{ id: string; version: number }>("/ncrs", { ...ncrBase, title: "Coating thickness below minimum", lotNumber: "APX-26-1150", defectDescription: "Coating thickness 120-140 um measured on 3 of 5 sampled housings", expectedSpecification: "150-250 um", actualCondition: "120-140 um", configurationRevisionId: approved.configurationRevisionId, blocksApproval: false, internalNotes: "Possible spray gun wear at the coater." });
  await team.quality.post(`/ncrs/${ncr2.id}/containment`, { expectedVersion: ncr2.version, containmentAction: "Lot on hold; 100% thickness check of stock", completed: true });
  const scar = await team.quality.post<{ id: string; version: number }>(`/ncrs/${ncr2.id}/scar`, { responseDueDate: isoDay(12), containmentDueDate: isoDay(3) });
  await team.quality.post(`/scars/${scar.id}/issue`, { expectedVersion: scar.version });
  const resp = await team.quality.post<{ id: string }>(`/scars/${scar.id}/responses`, {
    submittedByName: "Dana Brooks, Apex Quality Manager",
    d1Team: "Apex QE, coating process engineer, ThermaSpray liaison",
    d2Problem: "Coating thickness below 150 um on lot APX-26-1150",
    d3Containment: "Stock sorted 100%; 9 housings recoated",
    d4RootCause: "Worn spray nozzle reduced deposition rate; nozzle life not controlled",
    d4EscapePoint: "Thickness sampled per shift instead of per batch",
    d5CorrectiveActions: "Nozzle replacement every 40 hours; thickness check per batch",
    d6Implementation: "Implemented on all spray cells",
    d6ImplementationDate: isoDay(-1),
    d7Prevention: "Added nozzle life to PFMEA and control plan",
  });
  await team.quality.post(`/scars/${scar.id}/responses/${resp.id}/submit`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[seed:demo] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
