import type { Prisma } from "@sqms/db";
import type { DbService } from "../../common/db/db.service";

/**
 * Checklist requirements with their document type, linked document, assignee and waiver details (shared by
 * sourcing projects, change requests and qualifications so every checklist renders the same way).
 */
export async function loadRequirements(db: DbService, where: Prisma.RequiredDocumentWhereInput) {
  const reqs = await db.client.requiredDocument.findMany({
    where,
    include: {
      documentType: { select: { id: true, code: true, name: true, acronym: true, category: true, nativeFormKey: true, nativeModule: true, allowUpload: true, supplierVisibility: true } },
      document: { select: { id: true, docNumber: true, title: true, status: true, latestRevision: { select: { id: true, revisionLabel: true, status: true } }, releasedRevision: { select: { id: true, revisionLabel: true } } } },
      acceptedRevision: { select: { id: true, revisionLabel: true } },
    },
  });
  const userIds = [...new Set(reqs.flatMap((r) => [r.assignedToId, r.waivedById].filter((x): x is string => !!x)))];
  const users = userIds.length ? await db.client.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } }) : [];
  const now = new Date();
  return reqs
    .map((r) => ({ ...r, assignedTo: users.find((u) => u.id === r.assignedToId) ?? null, waivedBy: users.find((u) => u.id === r.waivedById) ?? null, overdue: !!r.dueDate && r.dueDate < now && (r.status === "OPEN" || r.status === "REJECTED") }))
    .sort((a, b) => a.documentType.code.localeCompare(b.documentType.code));
}
