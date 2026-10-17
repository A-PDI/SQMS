// Original route inventory at QMS-Development 9e53417. Every route has an explicit backend permission.
export const QMS_ROUTES = [
  { method: "PATCH", path: "/auth/password", permission: "session:self" },
  {
    method: "POST",
    path: "/injector-tests/repairs/attempts/:id/retest",
    permission: "repair:write",
  },
  {
    method: "POST",
    path: "/injector-tests/repairs/cases/:id/attempts",
    permission: "repair:write",
  },
  {
    method: "PATCH",
    path: "/injector-tests/repairs/cases/:id/status",
    permission: "repair:write",
  },
  {
    method: "PUT",
    path: "/admin/templates/:id/part-specs/:partNumber",
    permission: "inspection_plan:manage",
  },
  {
    method: "DELETE",
    path: "/admin/templates/:id/part-specs/:partNumber",
    permission: "inspection_plan:manage",
  },
  {
    method: "GET",
    path: "/admin/templates/:id/part-specs",
    permission: "inspection_plan:manage",
  },
  {
    method: "POST",
    path: "/admin/templates/:id/version",
    permission: "inspection_plan:manage",
  },
  {
    method: "GET",
    path: "/injector-tests/repairs/cases/:id",
    permission: "injector:read",
  },
  {
    method: "GET",
    path: "/admin/templates/export",
    permission: "inspection_plan:manage",
  },
  {
    method: "GET",
    path: "/injector-tests/analytics/export.xlsx",
    permission: "injector:read",
  },
  {
    method: "GET",
    path: "/injector-tests/exports/google-sheet",
    permission: "injector:read",
  },
  {
    method: "POST",
    path: "/injector-tests/exports/google-sheet",
    permission: "injector:sync",
  },
  {
    method: "POST",
    path: "/injector-tests/repairs/cases",
    permission: "repair:write",
  },
  {
    method: "POST",
    path: "/injector-tests/reports/custom",
    permission: "report:export",
  },
  {
    method: "POST",
    path: "/injector-tests/reports/custom.xlsx",
    permission: "report:export",
  },
  {
    method: "POST",
    path: "/injector-tests/reports/customer",
    permission: "report:export",
  },
  {
    method: "POST",
    path: "/injector-tests/reports/inspection",
    permission: "report:export",
  },
  {
    method: "POST",
    path: "/injector-tests/reports/preview",
    permission: "injector:read",
  },
  {
    method: "POST",
    path: "/injector-tests/reports/shipment-evaluation",
    permission: "report:export",
  },
  {
    method: "POST",
    path: "/injector-tests/reports/supplier-evaluation",
    permission: "report:export",
  },
  {
    method: "POST",
    path: "/reports/export/excel",
    permission: "report:export",
  },
  {
    method: "POST",
    path: "/reports/export/pdf",
    permission: "report:export",
  },
  {
    method: "GET",
    path: "/admin/templates/:id",
    permission: "inspection_plan:manage",
  },
  {
    method: "PATCH",
    path: "/admin/templates/:id",
    permission: "inspection_plan:manage",
  },
  {
    method: "DELETE",
    path: "/admin/templates/:id",
    permission: "inspection_plan:manage",
  },
  {
    method: "PATCH",
    path: "/admin/users/:id",
    permission: "admin:users",
  },
  {
    method: "GET",
    path: "/attachments/download/:id",
    permission: "inspection:read",
  },
  {
    method: "GET",
    path: "/drawings/:id/download",
    permission: "document:read",
  },
  {
    method: "GET",
    path: "/drawings/:id/file",
    permission: "document:read",
  },
  {
    method: "PATCH",
    path: "/drawings/:id/set-current",
    permission: "document:write",
  },
  {
    method: "GET",
    path: "/drawings/download/:id",
    permission: "document:read",
  },
  {
    method: "GET",
    path: "/injector-tests/:id/quick-entry",
    permission: "injector:read",
  },
  {
    method: "POST",
    path: "/injector-tests/:id/quick-entry",
    permission: "repair:write",
  },
  {
    method: "GET",
    path: "/injector-tests/:id/repair-history",
    permission: "injector:read",
  },
  {
    method: "POST",
    path: "/inspections/:id/complete",
    permission: "inspection:complete",
  },
  {
    method: "POST",
    path: "/inspections/:id/log-activity",
    permission: "inspection:write",
  },
  {
    method: "GET",
    path: "/inspections/:id/pdf",
    permission: "inspection:read",
  },
  {
    method: "POST",
    path: "/inspections/:id/reopen",
    permission: "inspection:reopen",
  },
  {
    method: "POST",
    path: "/inspections/:id/review",
    permission: "inspection:write",
  },
  {
    method: "PUT",
    path: "/ncrs/:id/content",
    permission: "ncr:write",
  },
  {
    method: "POST",
    path: "/ncrs/:id/images",
    permission: "ncr:write",
  },
  {
    method: "GET",
    path: "/ncrs/:id/pdf",
    permission: "ncr:read",
  },
  {
    method: "GET",
    path: "/ncrs/images/:imageId",
    permission: "ncr:read",
  },
  {
    method: "PATCH",
    path: "/quality-alerts/:id/acknowledge",
    permission: "inspection:read",
  },
  {
    method: "PATCH",
    path: "/reports/saved/:id",
    permission: "report:read",
  },
  {
    method: "DELETE",
    path: "/reports/saved/:id",
    permission: "report:read",
  },
  {
    method: "GET",
    path: "/admin/inspection-items",
    permission: "inspection:read",
  },
  {
    method: "GET",
    path: "/admin/templates",
    permission: "inspection_plan:manage",
  },
  {
    method: "POST",
    path: "/admin/templates",
    permission: "inspection_plan:manage",
  },
  {
    method: "GET",
    path: "/admin/users",
    permission: "admin:users",
  },
  {
    method: "POST",
    path: "/admin/users",
    permission: "admin:users",
  },
  {
    method: "GET",
    path: "/auth/me",
    permission: "inspection:read",
  },
  {
    method: "GET",
    path: "/dashboard/alerts",
    permission: "inspection:read",
  },
  {
    method: "GET",
    path: "/dashboard/chart",
    permission: "inspection:read",
  },
  {
    method: "GET",
    path: "/dashboard/fire-ring-eligible",
    permission: "inspection:read",
  },
  {
    method: "GET",
    path: "/dashboard/stats",
    permission: "inspection:read",
  },
  {
    method: "GET",
    path: "/injector-tests/analytics",
    permission: "injector:read",
  },
  {
    method: "POST",
    path: "/injector-tests/report",
    permission: "report:export",
  },
  {
    method: "GET",
    path: "/injector-tests/settings",
    permission: "injector:read",
  },
  {
    method: "PUT",
    path: "/injector-tests/settings",
    permission: "injector:sync",
  },
  {
    method: "GET",
    path: "/injector-tests/steps",
    permission: "injector:read",
  },
  {
    method: "POST",
    path: "/injector-tests/sync",
    permission: "injector:sync",
  },
  {
    method: "POST",
    path: "/injector-tests/test-connection",
    permission: "injector:sync",
  },
  {
    method: "GET",
    path: "/inspections/assigned",
    permission: "inspection:read",
  },
  {
    method: "POST",
    path: "/part-specs/import",
    permission: "inspection_plan:manage",
  },
  {
    method: "POST",
    path: "/part-specs/import-from-inspections",
    permission: "inspection_plan:manage",
  },
  {
    method: "GET",
    path: "/part-specs/lookup",
    permission: "inspection:read",
  },
  {
    method: "GET",
    path: "/quality-alerts/count",
    permission: "inspection:read",
  },
  {
    method: "POST",
    path: "/reports/query",
    permission: "report:read",
  },
  {
    method: "GET",
    path: "/reports/saved",
    permission: "report:read",
  },
  {
    method: "POST",
    path: "/reports/saved",
    permission: "report:read",
  },
  {
    method: "DELETE",
    path: "/attachments/:id",
    permission: "inspection:write",
  },
  {
    method: "GET",
    path: "/attachments/:inspectionId",
    permission: "inspection:read",
  },
  {
    method: "POST",
    path: "/attachments/:inspectionId",
    permission: "inspection:write",
  },
  {
    method: "DELETE",
    path: "/drawings/:id",
    permission: "document:write",
  },
  {
    method: "GET",
    path: "/inspections/:id",
    permission: "inspection:read",
  },
  {
    method: "PATCH",
    path: "/inspections/:id",
    permission: "inspection:write",
  },
  {
    method: "DELETE",
    path: "/inspections/:id",
    permission: "inspection:write",
  },
  {
    method: "GET",
    path: "/ncrs/:id",
    permission: "ncr:read",
  },
  {
    method: "PATCH",
    path: "/ncrs/:id",
    permission: "ncr:write",
  },
  {
    method: "DELETE",
    path: "/ncrs/:id",
    permission: "ncr:disposition",
  },
  {
    method: "PATCH",
    path: "/part-specs/:id",
    permission: "inspection_plan:manage",
  },
  {
    method: "DELETE",
    path: "/part-specs/:id",
    permission: "inspection_plan:manage",
  },
  {
    method: "GET",
    path: "/templates/:id",
    permission: "inspection:read",
  },
  {
    method: "GET",
    path: "/drawings",
    permission: "document:read",
  },
  {
    method: "POST",
    path: "/drawings",
    permission: "document:write",
  },
  {
    method: "GET",
    path: "/injector-tests",
    permission: "injector:read",
  },
  {
    method: "DELETE",
    path: "/injector-tests",
    permission: "injector:sync",
  },
  {
    method: "GET",
    path: "/inspections",
    permission: "inspection:read",
  },
  {
    method: "POST",
    path: "/inspections",
    permission: "inspection:write",
  },
  {
    method: "GET",
    path: "/ncrs",
    permission: "ncr:read",
  },
  {
    method: "POST",
    path: "/ncrs",
    permission: "ncr:write",
  },
  {
    method: "GET",
    path: "/part-specs",
    permission: "inspection:read",
  },
  {
    method: "POST",
    path: "/part-specs",
    permission: "inspection_plan:manage",
  },
  {
    method: "GET",
    path: "/quality-alerts",
    permission: "inspection:read",
  },
  {
    method: "GET",
    path: "/templates",
    permission: "inspection:read",
  },
] as const;
