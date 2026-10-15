/** Typed application errors mapped to consistent HTTP responses by AllExceptionsFilter. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  constructor(entity = "Record") {
    super(404, "NOT_FOUND", `${entity} not found`);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super(403, "FORBIDDEN", message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(401, "UNAUTHORIZED", message);
  }
}

/** State/version conflicts: stale optimistic version, invalid lifecycle transition, duplicate operation. */
export class ConflictError extends AppError {
  constructor(message: string, code = "CONFLICT", details?: unknown) {
    super(409, code, message, details);
  }
}

export class StaleVersionError extends ConflictError {
  constructor(entity = "Record") {
    super(`${entity} was modified by another user. Reload and try again.`, "STALE_VERSION");
  }
}

export class InvalidTransitionError extends ConflictError {
  constructor(entity: string, from: string, action: string) {
    super(`${entity} in status ${from} cannot be ${action}`, "INVALID_TRANSITION", { from, action });
  }
}

/** Business-rule validation failures (input is well-formed but not acceptable). */
export class BusinessRuleError extends AppError {
  constructor(message: string, details?: unknown, code = "BUSINESS_RULE_VIOLATION") {
    super(422, code, message, details);
  }
}

export interface GateCheck {
  key: string;
  label: string;
  passed: boolean;
  details?: string[];
}

export class ApprovalGateError extends AppError {
  constructor(readonly checks: GateCheck[]) {
    super(422, "APPROVAL_GATE_FAILED", "Approval requirements are not satisfied", { checks: checks.filter((c) => !c.passed) });
  }
}

export class RateLimitedError extends AppError {
  constructor(message = "Too many requests. Please try again later.") {
    super(429, "RATE_LIMITED", message);
  }
}
