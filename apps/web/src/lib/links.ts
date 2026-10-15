/** Application route of a record, by entity type (used by tasks, notifications, links and search). */
const ROUTES: Record<string, (id: string) => string> = {
  SUPPLIER: (id) => `/suppliers/${id}`,
  INTERNAL_PART: (id) => `/products/${id}`,
  SUPPLIER_PRODUCT: (id) => `/products/supplier-products/${id}`,
  CONFIGURATION_REVISION: (id) => `/configurations/revisions/${id}`,
  SOURCING_PROJECT: (id) => `/projects/${id}`,
  DOCUMENT: (id) => `/documents/${id}`,
  PRODUCT_QUALIFICATION: (id) => `/qualifications/${id}`,
  CHANGE_REQUEST: (id) => `/changes/${id}`,
  NCR: (id) => `/quality/ncrs/${id}`,
  SCAR: (id) => `/quality/scars/${id}`,
  DEVIATION: (id) => `/quality/deviations/${id}`,
};

export function entityHref(entityType: string | null | undefined, entityId: string | null | undefined): string | null {
  if (!entityType || !entityId) return null;
  return ROUTES[entityType]?.(entityId) ?? null;
}
