/**
 * Permission catalog and default role matrix.
 *
 * Permissions are seeded into the database and role grants are administrator-configurable at runtime.
 * The backend enforces permissions on every endpoint; the frontend only uses them to hide actions.
 */

export interface PermissionDefinition {
  key: string;
  description: string;
  /** Whether the permission may ever be granted to an external (supplier) role. */
  externalAllowed: boolean;
}

export const PERMISSIONS = {
  SUPPLIER_READ: "supplier:read",
  SUPPLIER_WRITE: "supplier:write",
  SUPPLIER_QUALIFY: "supplier:qualify",
  PRODUCT_READ: "product:read",
  PRODUCT_WRITE: "product:write",
  CONFIGURATION_WRITE: "configuration:write",
  PROJECT_READ: "project:read",
  PROJECT_WRITE: "project:write",
  PROJECT_WAIVE_CONDITIONAL: "project:waive_conditional",
  PROJECT_WAIVE_MANDATORY: "project:waive_mandatory",
  DOCUMENT_READ: "document:read",
  DOCUMENT_WRITE: "document:write",
  DOCUMENT_RELEASE: "document:release",
  DOCUMENT_SHARE: "document:share",
  DOCUMENT_TYPE_MANAGE: "document_type:manage",
  QUALIFICATION_READ: "qualification:read",
  QUALIFICATION_WRITE: "qualification:write",
  CHANGE_READ: "change:read",
  CHANGE_SUBMIT: "change:submit",
  CHANGE_REVIEW: "change:review",
  DEVIATION_READ: "deviation:read",
  DEVIATION_WRITE: "deviation:write",
  NCR_READ: "ncr:read",
  NCR_WRITE: "ncr:write",
  NCR_DISPOSITION: "ncr:disposition",
  SCAR_READ: "scar:read",
  SCAR_WRITE: "scar:write",
  SCAR_RESPOND: "scar:respond",
  SCAR_CLOSE: "scar:close",
  APPROVAL_DECIDE: "approval:decide",
  APPROVAL_REASSIGN: "approval:reassign",
  TASK_READ: "task:read",
  TASK_WRITE: "task:write",
  COMMENT_INTERNAL: "comment:internal",
  REPORT_READ: "report:read",
  REPORT_EXPORT: "report:export",
  AUDIT_READ: "audit:read",
  ADMIN_USERS: "admin:users",
  ADMIN_ROLES: "admin:roles",
  ADMIN_SETTINGS: "admin:settings",
  ADMIN_WORKFLOWS: "admin:workflows",
  ADMIN_POLICIES: "admin:policies",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  { key: PERMISSIONS.SUPPLIER_READ, description: "View suppliers, sites, contacts and certifications", externalAllowed: true },
  { key: PERMISSIONS.SUPPLIER_WRITE, description: "Create and edit suppliers, sites, contacts and certifications", externalAllowed: false },
  { key: PERMISSIONS.SUPPLIER_QUALIFY, description: "Initiate and record supplier qualification decisions", externalAllowed: false },
  { key: PERMISSIONS.PRODUCT_READ, description: "View product master, supplier parts and configurations", externalAllowed: true },
  { key: PERMISSIONS.PRODUCT_WRITE, description: "Create and edit products, supplier parts and cross-references", externalAllowed: false },
  { key: PERMISSIONS.CONFIGURATION_WRITE, description: "Edit draft configuration revisions, baselines, requirements and characteristics", externalAllowed: false },
  { key: PERMISSIONS.PROJECT_READ, description: "View sourcing projects", externalAllowed: true },
  { key: PERMISSIONS.PROJECT_WRITE, description: "Create and manage sourcing projects and checklists", externalAllowed: false },
  { key: PERMISSIONS.PROJECT_WAIVE_CONDITIONAL, description: "Waive conditional document requirements with justification", externalAllowed: false },
  { key: PERMISSIONS.PROJECT_WAIVE_MANDATORY, description: "Waive mandatory (required) document controls with justification", externalAllowed: false },
  { key: PERMISSIONS.DOCUMENT_READ, description: "View authorized document records and files", externalAllowed: true },
  { key: PERMISSIONS.DOCUMENT_WRITE, description: "Create documents, revisions and submit for review", externalAllowed: true },
  { key: PERMISSIONS.DOCUMENT_RELEASE, description: "Release approved document revisions and obsolete releases", externalAllowed: false },
  { key: PERMISSIONS.DOCUMENT_SHARE, description: "Share released documents with supplier organizations", externalAllowed: false },
  { key: PERMISSIONS.DOCUMENT_TYPE_MANAGE, description: "Manage document types, templates, template revisions and native forms", externalAllowed: false },
  { key: PERMISSIONS.QUALIFICATION_READ, description: "View product qualifications and approval packages", externalAllowed: false },
  { key: PERMISSIONS.QUALIFICATION_WRITE, description: "Manage product qualifications, tests, inspections and FAIs", externalAllowed: false },
  { key: PERMISSIONS.CHANGE_READ, description: "View supplier change requests", externalAllowed: true },
  { key: PERMISSIONS.CHANGE_SUBMIT, description: "Create and submit supplier change requests", externalAllowed: true },
  { key: PERMISSIONS.CHANGE_REVIEW, description: "Review change requests, record impact assessments and verify implementation", externalAllowed: false },
  { key: PERMISSIONS.DEVIATION_READ, description: "View deviations and concessions", externalAllowed: true },
  { key: PERMISSIONS.DEVIATION_WRITE, description: "Create and submit deviation / concession requests", externalAllowed: true },
  { key: PERMISSIONS.NCR_READ, description: "View nonconformance reports", externalAllowed: true },
  { key: PERMISSIONS.NCR_WRITE, description: "Create and edit nonconformance reports", externalAllowed: false },
  { key: PERMISSIONS.NCR_DISPOSITION, description: "Disposition and close nonconformance reports", externalAllowed: false },
  { key: PERMISSIONS.SCAR_READ, description: "View supplier corrective action requests", externalAllowed: true },
  { key: PERMISSIONS.SCAR_WRITE, description: "Issue and manage supplier corrective action requests", externalAllowed: false },
  { key: PERMISSIONS.SCAR_RESPOND, description: "Submit corrective action responses (supplier)", externalAllowed: true },
  { key: PERMISSIONS.SCAR_CLOSE, description: "Accept responses, verify effectiveness and close SCARs", externalAllowed: false },
  { key: PERMISSIONS.APPROVAL_DECIDE, description: "Record approval decisions on assigned approvals", externalAllowed: false },
  { key: PERMISSIONS.APPROVAL_REASSIGN, description: "Reassign or delegate approvals and tasks for other users", externalAllowed: false },
  { key: PERMISSIONS.TASK_READ, description: "View assigned tasks", externalAllowed: true },
  { key: PERMISSIONS.TASK_WRITE, description: "Create and update tasks", externalAllowed: true },
  { key: PERMISSIONS.COMMENT_INTERNAL, description: "Read and write internal-only comments", externalAllowed: false },
  { key: PERMISSIONS.REPORT_READ, description: "View reports and dashboards", externalAllowed: false },
  { key: PERMISSIONS.REPORT_EXPORT, description: "Export reports and lists to CSV", externalAllowed: false },
  { key: PERMISSIONS.AUDIT_READ, description: "View the audit trail", externalAllowed: false },
  { key: PERMISSIONS.ADMIN_USERS, description: "Manage users, invitations, memberships and sessions", externalAllowed: false },
  { key: PERMISSIONS.ADMIN_ROLES, description: "Manage roles and role permissions", externalAllowed: false },
  { key: PERMISSIONS.ADMIN_SETTINGS, description: "Manage system settings, numbering, file types and retention policies", externalAllowed: false },
  { key: PERMISSIONS.ADMIN_WORKFLOWS, description: "Manage workflow definitions", externalAllowed: false },
  { key: PERMISSIONS.ADMIN_POLICIES, description: "Manage document applicability policies and rules", externalAllowed: false },
];

export const ROLE_KEYS = {
  SYSTEM_ADMIN: "SYSTEM_ADMIN",
  ENGINEERING: "ENGINEERING",
  SUPPLIER_QUALITY: "SUPPLIER_QUALITY",
  SOURCING: "SOURCING",
  APPROVER: "APPROVER",
  READ_ONLY: "READ_ONLY",
  SUPPLIER_ADMIN: "SUPPLIER_ADMIN",
  SUPPLIER_CONTRIBUTOR: "SUPPLIER_CONTRIBUTOR",
  SUPPLIER_READ_ONLY: "SUPPLIER_READ_ONLY",
} as const;

export type RoleKey = (typeof ROLE_KEYS)[keyof typeof ROLE_KEYS];

export interface RoleDefinition {
  key: RoleKey;
  name: string;
  description: string;
  scope: "INTERNAL" | "EXTERNAL";
  permissions: PermissionKey[];
}

const P = PERMISSIONS;
const ALL_READ: PermissionKey[] = [
  P.SUPPLIER_READ, P.PRODUCT_READ, P.PROJECT_READ, P.DOCUMENT_READ, P.QUALIFICATION_READ, P.CHANGE_READ,
  P.DEVIATION_READ, P.NCR_READ, P.SCAR_READ, P.TASK_READ, P.REPORT_READ, P.COMMENT_INTERNAL,
];

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    key: ROLE_KEYS.SYSTEM_ADMIN,
    name: "System Administrator",
    description: "Full administrative access including users, roles, configuration and audit.",
    scope: "INTERNAL",
    permissions: PERMISSION_DEFINITIONS.map((p) => p.key as PermissionKey),
  },
  {
    key: ROLE_KEYS.ENGINEERING,
    name: "Engineering",
    description: "Owns engineering definitions, baselines, delta specifications and change impact assessment.",
    scope: "INTERNAL",
    permissions: [
      ...ALL_READ, P.PRODUCT_WRITE, P.CONFIGURATION_WRITE, P.PROJECT_WRITE, P.PROJECT_WAIVE_CONDITIONAL,
      P.DOCUMENT_WRITE, P.DOCUMENT_RELEASE, P.DOCUMENT_SHARE, P.QUALIFICATION_WRITE, P.CHANGE_SUBMIT, P.CHANGE_REVIEW,
      P.DEVIATION_WRITE, P.NCR_WRITE, P.APPROVAL_DECIDE, P.TASK_WRITE, P.REPORT_EXPORT,
    ],
  },
  {
    key: ROLE_KEYS.SUPPLIER_QUALITY,
    name: "Supplier Quality",
    description: "Owns supplier qualification, product qualification, NCR/SCAR and change control.",
    scope: "INTERNAL",
    permissions: [
      ...ALL_READ, P.SUPPLIER_WRITE, P.SUPPLIER_QUALIFY, P.PRODUCT_WRITE, P.CONFIGURATION_WRITE, P.PROJECT_WRITE,
      P.PROJECT_WAIVE_CONDITIONAL, P.PROJECT_WAIVE_MANDATORY, P.DOCUMENT_WRITE, P.DOCUMENT_RELEASE, P.DOCUMENT_SHARE,
      P.QUALIFICATION_WRITE, P.CHANGE_SUBMIT, P.CHANGE_REVIEW, P.DEVIATION_WRITE, P.NCR_WRITE, P.NCR_DISPOSITION,
      P.SCAR_WRITE, P.SCAR_CLOSE, P.APPROVAL_DECIDE, P.APPROVAL_REASSIGN, P.TASK_WRITE, P.REPORT_EXPORT, P.AUDIT_READ,
    ],
  },
  {
    key: ROLE_KEYS.SOURCING,
    name: "Sourcing / Purchasing",
    description: "Creates sourcing projects, manages supplier records and commercial relationships.",
    scope: "INTERNAL",
    permissions: [
      ...ALL_READ, P.SUPPLIER_WRITE, P.PRODUCT_WRITE, P.PROJECT_WRITE, P.DOCUMENT_WRITE, P.CHANGE_SUBMIT,
      P.NCR_WRITE, P.APPROVAL_DECIDE, P.TASK_WRITE, P.REPORT_EXPORT,
    ],
  },
  {
    key: ROLE_KEYS.APPROVER,
    name: "Management / Approver",
    description: "Records approval decisions and reviews operational status.",
    scope: "INTERNAL",
    permissions: [...ALL_READ, P.APPROVAL_DECIDE, P.APPROVAL_REASSIGN, P.PROJECT_WAIVE_MANDATORY, P.REPORT_EXPORT, P.AUDIT_READ, P.TASK_WRITE],
  },
  {
    key: ROLE_KEYS.READ_ONLY,
    name: "Read-only Internal User",
    description: "Read-only access to internal records.",
    scope: "INTERNAL",
    permissions: [...ALL_READ],
  },
  {
    key: ROLE_KEYS.SUPPLIER_ADMIN,
    name: "Supplier Administrator",
    description: "Supplier-side administrator for the supplier organization (Phase 2 portal).",
    scope: "EXTERNAL",
    permissions: [
      P.SUPPLIER_READ, P.PRODUCT_READ, P.PROJECT_READ, P.DOCUMENT_READ, P.DOCUMENT_WRITE, P.CHANGE_READ, P.CHANGE_SUBMIT,
      P.DEVIATION_READ, P.DEVIATION_WRITE, P.NCR_READ, P.SCAR_READ, P.SCAR_RESPOND, P.TASK_READ, P.TASK_WRITE,
    ],
  },
  {
    key: ROLE_KEYS.SUPPLIER_CONTRIBUTOR,
    name: "Supplier Contributor",
    description: "Supplier user who submits documents, change requests and corrective-action responses (Phase 2 portal).",
    scope: "EXTERNAL",
    permissions: [
      P.SUPPLIER_READ, P.PRODUCT_READ, P.PROJECT_READ, P.DOCUMENT_READ, P.DOCUMENT_WRITE, P.CHANGE_READ, P.CHANGE_SUBMIT,
      P.DEVIATION_READ, P.DEVIATION_WRITE, P.NCR_READ, P.SCAR_READ, P.SCAR_RESPOND, P.TASK_READ,
    ],
  },
  {
    key: ROLE_KEYS.SUPPLIER_READ_ONLY,
    name: "Supplier Read-only User",
    description: "Supplier user with read-only access to records authorized for the supplier (Phase 2 portal).",
    scope: "EXTERNAL",
    permissions: [P.SUPPLIER_READ, P.PRODUCT_READ, P.PROJECT_READ, P.DOCUMENT_READ, P.CHANGE_READ, P.DEVIATION_READ, P.NCR_READ, P.SCAR_READ, P.TASK_READ],
  },
];

/** Guards against granting an internal-only permission to an external role. */
export function isPermissionAllowedForScope(permissionKey: string, scope: "INTERNAL" | "EXTERNAL"): boolean {
  if (scope === "INTERNAL") return PERMISSION_DEFINITIONS.some((p) => p.key === permissionKey);
  const def = PERMISSION_DEFINITIONS.find((p) => p.key === permissionKey);
  return !!def && def.externalAllowed;
}
