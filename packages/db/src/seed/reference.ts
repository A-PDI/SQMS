/**
 * Idempotent reference-data seed. Safe to run on every deployment:
 *  - creates missing reference records only; it never overwrites administrator changes,
 *  - the System Administrator role always receives newly introduced permissions,
 *  - an initial administrator is created only when SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD are supplied.
 */
import {
  ALLOWED_FILE_TYPE_SEEDS,
  DEFAULT_APPLICABILITY_RULES,
  DEFAULT_POLICY_KEY,
  DEFAULT_QUALIFICATION_WORKFLOW_MATRIX,
  DOCUMENT_TYPE_SEEDS,
  FORM_DEFINITION_SEEDS,
  NUMBERING_SEQUENCE_SEEDS,
  PERMISSION_DEFINITIONS,
  RETENTION_POLICY_SEEDS,
  ROLE_DEFINITIONS,
  ROLE_KEYS,
  WORKFLOW_DEFINITION_SEEDS,
} from "@sqms/shared";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { hashPassword, passwordPolicyViolation } from "../passwords";

export interface ReferenceSeedOptions {
  internalOrganizationName?: string;
  admin?: { email: string; password: string; displayName?: string };
  log?: (message: string) => void;
}

export const INTERNAL_ORG_CODE = "INTERNAL";

const CAPABILITIES: { code: string; name: string; special: boolean }[] = [
  { code: "CNC_MACHINING", name: "CNC machining", special: false },
  { code: "FIVE_AXIS_MACHINING", name: "5-axis machining", special: false },
  { code: "PRECISION_GRINDING", name: "Precision grinding", special: false },
  { code: "INVESTMENT_CASTING", name: "Investment casting", special: false },
  { code: "SAND_CASTING", name: "Sand casting", special: false },
  { code: "DIE_CASTING", name: "Die casting", special: false },
  { code: "FORGING", name: "Forging", special: false },
  { code: "HEAT_TREATMENT", name: "Heat treatment", special: true },
  { code: "PVD_COATING", name: "PVD coating", special: true },
  { code: "THERMAL_SPRAY", name: "Thermal spray coating", special: true },
  { code: "PLATING", name: "Plating", special: true },
  { code: "WELDING_BRAZING", name: "Welding / brazing", special: true },
  { code: "NDT", name: "Non-destructive testing", special: true },
  { code: "DYNAMIC_BALANCING", name: "Dynamic balancing", special: false },
  { code: "ASSEMBLY", name: "Assembly", special: false },
  { code: "FLOW_TESTING", name: "Flow / performance testing", special: false },
  { code: "CMM_INSPECTION", name: "CMM inspection", special: false },
];

const PRODUCT_CATEGORIES: { code: string; name: string }[] = [
  { code: "TURBOCHARGERS", name: "Turbochargers & components" },
  { code: "CYLINDER_HEADS", name: "Cylinder heads" },
  { code: "FUEL_INJECTORS", name: "Fuel injectors & components" },
  { code: "FUEL_SYSTEM", name: "Fuel system components" },
  { code: "MACHINED_COMPONENTS", name: "Machined components" },
  { code: "CASTINGS", name: "Castings" },
  { code: "VALVETRAIN", name: "Valvetrain components" },
  { code: "GASKETS_SEALS", name: "Gaskets & seals" },
  { code: "BEARINGS", name: "Bearings" },
  { code: "OTHER", name: "Other engine components" },
];

const PATHWAYS = [
  {
    code: "A" as const,
    name: "Customer-controlled design",
    description: "The company owns or has obtained a controlled engineering design and contracts a manufacturer to produce it. Includes the reverse-engineering special case when only a physical sample exists.",
    designOwnership: "COMPANY" as const,
    defaultBaselineType: "CUSTOMER_CONTROLLED_DESIGN" as const,
    defaultConfigurationType: "CUSTOMER_DESIGN" as const,
  },
  {
    code: "B" as const,
    name: "Existing supplier product",
    description: "Purchase a supplier's standard product. The approved baseline is the supplier's product specification and guaranteed characteristics; ownership of the full design is not required.",
    designOwnership: "SUPPLIER" as const,
    defaultBaselineType: "SUPPLIER_PRODUCT_BASELINE" as const,
    defaultConfigurationType: "SUPPLIER_STANDARD" as const,
  },
  {
    code: "C" as const,
    name: "Modified existing supplier product",
    description: "A supplier product with company-specified modifications, controlled as baseline-plus-delta with supplier acknowledgment of each requirement.",
    designOwnership: "SHARED" as const,
    defaultBaselineType: "SUPPLIER_BASELINE_WITH_DELTA" as const,
    defaultConfigurationType: "SUPPLIER_MODIFIED" as const,
  },
];

export const DEFAULT_SETTINGS: { key: string; value: Prisma.InputJsonValue; description: string }[] = [
  {
    key: "branding",
    value: { companyName: "PDI", productName: "Supplier Quality Management System", shortName: "SQMS", primaryColor: "#1f3a5f", accentColor: "#2b6cb0", logoFileId: null },
    description: "Company name, logo and brand colors.",
  },
  { key: "files.maxUploadMb", value: 250, description: "Global maximum upload size in MB (per-type limits also apply)." },
  { key: "workflow.preventSelfApproval", value: true, description: "Prevent the submitter of a record from approving it." },
  { key: "qualification.workflowMatrix", value: DEFAULT_QUALIFICATION_WORKFLOW_MATRIX as unknown as Prisma.InputJsonValue, description: "Product approval workflow key by sourcing pathway and risk level." },
  { key: "scar.defaultResponseDays", value: 14, description: "Default supplier response window for SCARs (days)." },
  { key: "scar.escalationDays", value: [0, 7, 14], description: "Days overdue at which SCARs escalate to levels 1, 2 and 3." },
  { key: "certifications.expiryAlertDays", value: [60, 30, 7], description: "Days before certificate expiry when alerts are raised." },
  { key: "tasks.reminderLeadHours", value: 24, description: "Hours before a due date when reminders are sent." },
];

async function ensureInternalOrganization(prisma: PrismaClient, name: string) {
  const existing = await prisma.organization.findUnique({ where: { code: INTERNAL_ORG_CODE } });
  if (existing) return existing;
  return prisma.organization.create({ data: { type: "INTERNAL", name, code: INTERNAL_ORG_CODE } });
}

export async function seedReferenceData(prisma: PrismaClient, options: ReferenceSeedOptions = {}): Promise<void> {
  const log = options.log ?? (() => undefined);
  const internalOrg = await ensureInternalOrganization(prisma, options.internalOrganizationName ?? "PDI");

  // Permissions
  for (const p of PERMISSION_DEFINITIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { description: p.description, externalAllowed: p.externalAllowed },
      create: { key: p.key, description: p.description, externalAllowed: p.externalAllowed },
    });
  }
  const permissions = await prisma.permission.findMany();
  const permByKey = new Map(permissions.map((p) => [p.key, p.id]));

  // Roles (default grants only applied when the role is first created; admin changes persist)
  for (const r of ROLE_DEFINITIONS) {
    let role = await prisma.role.findUnique({ where: { key: r.key } });
    if (!role) {
      role = await prisma.role.create({ data: { key: r.key, name: r.name, description: r.description, scope: r.scope, isSystem: true } });
      await prisma.rolePermission.createMany({
        data: r.permissions.map((k) => ({ roleId: role!.id, permissionId: permByKey.get(k)! })),
        skipDuplicates: true,
      });
      log(`role ${r.key} created`);
    }
    if (r.key === ROLE_KEYS.SYSTEM_ADMIN) {
      await prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: role!.id, permissionId: p.id })),
        skipDuplicates: true,
      });
    }
  }

  for (const c of CAPABILITIES) {
    await prisma.capability.upsert({ where: { code: c.code }, update: {}, create: { code: c.code, name: c.name, isSpecialProcess: c.special } });
  }
  for (const c of PRODUCT_CATEGORIES) {
    await prisma.productCategory.upsert({ where: { code: c.code }, update: {}, create: { code: c.code, name: c.name } });
  }
  for (const p of PATHWAYS) {
    await prisma.sourcingPathway.upsert({ where: { code: p.code }, update: {}, create: p });
  }
  for (const r of RETENTION_POLICY_SEEDS) {
    await prisma.retentionPolicy.upsert({
      where: { code: r.code },
      update: {},
      // retentionMonths intentionally null: periods are defined by company policy, not invented by the system.
      create: { code: r.code, name: r.name, description: r.description, trigger: r.trigger, retentionMonths: null },
    });
  }
  const retention = new Map((await prisma.retentionPolicy.findMany()).map((r) => [r.code, r.id]));

  // Document types
  for (const [i, d] of DOCUMENT_TYPE_SEEDS.entries()) {
    const exists = await prisma.documentType.findUnique({ where: { code: d.code } });
    if (exists) continue;
    await prisma.documentType.create({
      data: {
        code: d.code,
        name: d.name,
        acronym: d.acronym,
        category: d.category,
        origin: d.origin,
        externalStandardRef: d.externalStandardRef,
        description: d.description,
        purpose: d.purpose,
        responsibleDepartment: d.responsibleDepartment,
        typicalPreparer: d.typicalPreparer,
        workflowKey: d.workflowKey,
        applicablePathways: d.applicablePathways,
        applicabilityConditions: d.applicabilityConditions,
        riskRuleSummary: d.riskRuleSummary,
        ownerRoleKey: d.ownerRoleKey,
        approvalRequirements: d.approvalRequirements,
        approverRoleKeys: d.approverRoleKeys,
        retentionPolicyId: retention.get(d.retentionPolicyCode) ?? null,
        supplierVisibility: d.supplierVisibility,
        instructions: d.instructions,
        allowUpload: d.allowUpload,
        nativeFormKey: d.nativeFormKey,
        nativeModule: d.nativeModule,
        sortOrder: i,
      },
    });
  }
  const docTypes = new Map((await prisma.documentType.findMany()).map((d) => [d.code, d]));

  // Native form definitions (version 1)
  for (const f of FORM_DEFINITION_SEEDS) {
    let def = await prisma.formDefinition.findUnique({ where: { key: f.key } });
    if (!def) {
      def = await prisma.formDefinition.create({
        data: { key: f.key, name: f.name, documentTypeId: docTypes.get(f.documentTypeCode)?.id ?? null },
      });
    }
    const v1 = await prisma.formDefinitionVersion.findUnique({ where: { formDefinitionId_version: { formDefinitionId: def.id, version: 1 } } });
    if (!v1) {
      await prisma.formDefinitionVersion.create({
        data: { formDefinitionId: def.id, version: 1, status: "PUBLISHED", schema: f.schema as unknown as Prisma.InputJsonValue, publishedAt: new Date(), changeSummary: "Initial version" },
      });
    }
  }
  const formVersionByKey = new Map<string, string>();
  for (const v of await prisma.formDefinitionVersion.findMany({ where: { status: "PUBLISHED" }, include: { formDefinition: true }, orderBy: { version: "asc" } })) {
    formVersionByKey.set(v.formDefinition.key, v.id);
  }

  // One controlled template per document type, revision A effective. Template files are uploaded by administrators;
  // the system does not fabricate template content.
  for (const d of DOCUMENT_TYPE_SEEDS) {
    const type = docTypes.get(d.code)!;
    const existing = await prisma.documentTemplate.findFirst({ where: { documentTypeId: type.id } });
    if (existing) continue;
    await prisma.documentTemplate.create({
      data: {
        documentTypeId: type.id,
        name: `${d.acronym ?? d.code} template`,
        description: `Controlled template for ${d.name}.`,
        revisions: {
          create: {
            revisionNumber: 1,
            revisionLabel: "A",
            status: "EFFECTIVE",
            effectiveDate: new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)),
            formDefinitionVersionId: d.nativeFormKey ? formVersionByKey.get(d.nativeFormKey) ?? null : null,
            changeSummary: "Initial controlled revision (template file to be attached by the document owner).",
            instructions: d.instructions,
            approvedAt: new Date(),
          },
        },
      },
    });
  }

  // Workflow definitions (version 1)
  for (const w of WORKFLOW_DEFINITION_SEEDS) {
    const exists = await prisma.workflowDefinition.findUnique({ where: { key_version: { key: w.key, version: 1 } } });
    if (exists) continue;
    await prisma.workflowDefinition.create({
      data: {
        key: w.key,
        version: 1,
        name: w.name,
        description: w.description,
        subjectType: w.subjectType,
        steps: {
          create: w.steps.map((s) => ({
            stepOrder: s.stepOrder,
            key: s.key,
            name: s.name,
            approverType: s.approverType,
            approverRoleKey: s.approverRoleKey ?? null,
            requiredApprovals: s.requiredApprovals ?? 1,
            dueInDays: s.dueInDays ?? null,
            escalateAfterDays: s.escalateAfterDays ?? null,
            escalateToRoleKey: s.escalateToRoleKey ?? null,
            condition: (s.condition as unknown as Prisma.InputJsonValue) ?? undefined,
          })),
        },
      },
    });
  }

  // Applicability policy version 1
  let policy = await prisma.applicabilityPolicy.findUnique({ where: { key: DEFAULT_POLICY_KEY } });
  if (!policy) {
    policy = await prisma.applicabilityPolicy.create({
      data: { key: DEFAULT_POLICY_KEY, name: "Sourcing document requirements", description: "Risk-based document requirements matrix for sourcing projects." },
    });
  }
  const pv1 = await prisma.applicabilityPolicyVersion.findUnique({ where: { policyId_version: { policyId: policy.id, version: 1 } } });
  if (!pv1) {
    await prisma.applicabilityPolicyVersion.create({
      data: {
        policyId: policy.id,
        version: 1,
        status: "ACTIVE",
        activatedAt: new Date(),
        notes: "Initial risk-based requirements matrix.",
        rules: {
          create: DEFAULT_APPLICABILITY_RULES.map((r) => ({
            documentTypeId: docTypes.get(r.documentTypeCode)!.id,
            outcome: r.outcome,
            priority: r.priority,
            conditions: r.conditions as unknown as Prisma.InputJsonValue,
            reason: r.reason,
            dueOffsetDays: r.dueOffsetDays ?? null,
            defaultAssigneeRoleKey: r.defaultAssigneeRoleKey ?? null,
          })),
        },
      },
    });
  }

  for (const n of NUMBERING_SEQUENCE_SEEDS) {
    await prisma.numberingSequence.upsert({
      where: { key: n.key },
      update: {},
      create: { key: n.key, prefix: n.prefix, pattern: n.pattern, padding: n.padding, resetPolicy: n.resetPolicy, nextValue: n.startAt ?? 1 },
    });
  }
  for (const f of ALLOWED_FILE_TYPE_SEEDS) {
    await prisma.allowedFileType.upsert({
      where: { extension: f.extension },
      update: {},
      create: { extension: f.extension, label: f.label, category: f.category, mimeTypes: f.mimeTypes, maxSizeMb: f.maxSizeMb, previewable: f.previewable },
    });
  }
  for (const s of DEFAULT_SETTINGS) {
    await prisma.systemSetting.upsert({ where: { key: s.key }, update: {}, create: { key: s.key, value: s.value, description: s.description } });
  }

  if (options.admin) {
    const email = options.admin.email.trim().toLowerCase();
    const violation = passwordPolicyViolation(options.admin.password);
    if (violation) throw new Error(`SEED_ADMIN_PASSWORD rejected: ${violation}`);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: ROLE_KEYS.SYSTEM_ADMIN } });
      await prisma.user.create({
        data: {
          email,
          displayName: options.admin.displayName ?? "System Administrator",
          userType: "INTERNAL",
          status: "ACTIVE",
          passwordHash: await hashPassword(options.admin.password),
          passwordChangedAt: new Date(),
          memberships: { create: { organizationId: internalOrg.id, roles: { create: { roleId: adminRole.id } } } },
        },
      });
      log(`administrator ${email} created`);
    }
  }
  log("reference data seeded");
}
