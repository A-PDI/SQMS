/** Original QMS JSON contracts. Presentation translates names only; records have one SQMS owner. */
export type Row = Record<string, any>;
export const object = (v: any): Row =>
  v && typeof v === "object" && !Array.isArray(v) ? v : {};
export const iso = (v: any) =>
  v instanceof Date ? v.toISOString() : (v ?? null);
export const date = (v: any) => iso(v)?.slice(0, 10) ?? null;
export const statusOut = (s: string) =>
  ({
    DRAFT: "draft",
    IN_PROGRESS: "partially_complete",
    COMPLETE: "complete",
    ARCHIVED: "archived",
  })[s] ?? s.toLowerCase();
export const statusIn = (s: string) =>
  ({
    draft: "DRAFT",
    partially_complete: "IN_PROGRESS",
    complete: "COMPLETE",
    review: "IN_PROGRESS",
  })[s];
export function template(r: Row): Row {
  const d = object(r.definition);
  return {
    ...d,
    id: r.id,
    form_no: d.form_no || r.plan?.code,
    title: d.title || r.plan?.title,
    form_type: d.form_type || "iqi_standard",
    active: d.active ?? (r.status === "RETIRED" ? 0 : 1),
    revision: d.revision ?? "",
    version: d.version ?? r.revision,
    sections: object(d.sections),
    header_schema: d.header_schema || [],
    created_at: iso(r.createdAt),
  };
}
export function inspection(r: Row): Row {
  const h = object(r.header),
    d = object(r.planSnapshot);
  return {
    ...h,
    id: r.id,
    template_id: h.__qms_template_id || r.planRevisionId,
    component_type: d.component_type,
    form_no: d.form_no,
    part_number: r.originalPartNumber,
    supplier: r.originalSupplier,
    date_received: date(r.receivedDate),
    section_data: r.sectionData,
    disposition: r.disposition,
    status:
      r.status === "IN_PROGRESS" && h.__qms_status === "review"
        ? "review"
        : statusOut(r.status),
    item_count: r.itemCount,
    assigned_to: r.assignedToId,
    assigned_to_name: r.assignedTo?.displayName || null,
    due_date: date(r.dueAt),
    created_by: r.createdById,
    created_at: iso(r.createdAt),
    updated_at: iso(r.updatedAt),
    completed_at: iso(r.completedAt),
  };
}
export function attachment(r: Row) {
  const c = object(r.context),
    f = r.file;
  return {
    id: r.id,
    file_name: f.originalFilename,
    mime_type: f.contentType,
    file_size_bytes: Number(f.sizeBytes),
    section_key:
      c.itemPosition > 0 && c.sectionKey
        ? `item${c.itemPosition}__${c.sectionKey}`
        : (c.sectionKey ?? null),
    item_id: c.qmsItemId ?? c.rowId ?? null,
    section_id: c.reportSectionId ?? null,
    caption: r.description || "",
    sort_order: c.sortOrder || 0,
    uploaded_at: iso(r.addedAt),
    scan_status: f.status,
  };
}
export function ncr(r: Row): Row {
  const d = object(r.qmsFields),
    exception = object(r.legacyException);
  const legacy: Row = {
    part_number: exception.originalPartNumber,
    supplier: exception.originalSupplier,
    ncr_disposition: exception.originalDisposition,
    created_by_name: exception.originalCreatorName,
  };
  const original = (key: string, canonical: unknown) =>
    Object.hasOwn(d, key)
      ? (d[key] ?? "")
      : legacy[key] !== undefined
        ? (legacy[key] ?? "")
        : (canonical ?? "");
  return {
    ...legacy,
    ...d,
    id: r.id,
    ncr_number: r.number,
    inspection_id: r.incomingInspectionId,
    form_no: r.incomingInspection?.planSnapshot?.form_no,
    part_number: original("part_number", r.internalPart?.partNumber),
    supplier: original("supplier", r.supplier?.name),
    po_number: r.purchaseOrder,
    quantity_affected: r.quantityAffected,
    description_of_defect: r.defectDescription,
    severity: r.severity.toLowerCase(),
    status:
      r.status === "CLOSED"
        ? "closed"
        : r.status === "OPEN"
          ? "open"
          : "in_progress",
    ncr_disposition:
      d.ncr_disposition ||
      legacy.ncr_disposition ||
      (
        {
          REWORK: "rework",
          SCRAP: "scrap",
          RETURN_TO_SUPPLIER: "return_to_supplier",
          USE_AS_IS_CONCESSION: "use_as_is",
        } as Row
      )[r.disposition] ||
      "pending",
    created_by: r.createdById,
    created_by_name: d.created_by_name ?? legacy.created_by_name ?? null,
    created_at: iso(r.createdAt),
    updated_at: iso(r.updatedAt),
    closed_at: iso(r.closedAt),
    corrective_action_required: d.corrective_action_required || 0,
    corrective_action_due_date: d.corrective_action_due_date || null,
  };
}
export function user(r: Row) {
  const roles =
    r.memberships?.flatMap((m: Row) => m.roles.map((rr: Row) => rr.role.key)) ||
    r.roles ||
    [];
  return {
    id: r.id,
    name: r.displayName,
    email: r.email,
    active: r.status === "ACTIVE" ? 1 : 0,
    role: roles.includes("SYSTEM_ADMIN")
      ? "admin"
      : roles.some((v: string) =>
            ["QUALITY_MANAGER", "SUPPLIER_QUALITY"].includes(v),
          )
        ? "qc_manager"
        : "inspector",
    permissions: r.legacyPermissions
      ? JSON.stringify(r.legacyPermissions)
      : null,
    created_at: iso(r.createdAt),
  };
}
export const paginate = (rows: Row[], q: Row) => {
  const page = Math.max(1, parseInt(q.page) || 1),
    limit = Math.min(1000, Math.max(1, parseInt(q.limit) || 20));
  return {
    rows: rows.slice((page - 1) * limit, page * limit),
    total: rows.length,
    page,
    limit,
  };
};
export function sort(
  rows: Row[],
  q: Row,
  allowed: string[],
  fallback = "created_at",
) {
  const key = allowed.includes(q.sort_by) ? q.sort_by : fallback,
    direction = q.sort_dir === "asc" ? 1 : -1;
  return rows.sort(
    (a, b) =>
      direction *
        String(a[key] ?? "").localeCompare(String(b[key] ?? ""), undefined, {
          numeric: true,
        }) || String(b.created_at).localeCompare(String(a.created_at)),
  );
}
