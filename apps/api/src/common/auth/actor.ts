/** The authenticated principal for a request. Derived solely from the server-side session, never from client input. */
export interface Actor {
  userId: string;
  email: string;
  displayName: string;
  userType: "INTERNAL" | "EXTERNAL";
  timezone: string;
  sessionId: string;
  organizationId: string;
  organizationType: "INTERNAL" | "SUPPLIER";
  organizationName: string;
  /** Supplier the user belongs to (external users only). */
  supplierId: string | null;
  roles: string[];
  permissions: ReadonlySet<string>;
}

export function isInternal(actor: Actor): boolean {
  return actor.userType === "INTERNAL" && actor.organizationType === "INTERNAL";
}

export function hasPermission(actor: Actor, permission: string): boolean {
  return actor.permissions.has(permission);
}

export function hasRole(actor: Actor, roleKey: string): boolean {
  return actor.roles.includes(roleKey);
}
