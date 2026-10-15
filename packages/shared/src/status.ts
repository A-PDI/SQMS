/** Consistent status presentation across the application. */

export type StatusTone = "neutral" | "info" | "pending" | "success" | "warning" | "danger" | "muted";

const TONES: Record<string, StatusTone> = {
  DRAFT: "neutral",
  PROSPECTIVE: "neutral",
  DEVELOPMENT: "neutral",
  PLANNED: "neutral",
  OPEN: "pending",
  PENDING: "pending",
  PROPOSED: "pending",
  SUBMITTED: "pending",
  IN_REVIEW: "pending",
  UNDER_REVIEW: "pending",
  UNDER_EVALUATION: "pending",
  DOCUMENTATION_PENDING: "pending",
  EVALUATION: "pending",
  VALIDATION: "pending",
  VALIDATION_REQUIRED: "warning",
  INFO_REQUIRED: "warning",
  INFO_REQUESTED: "warning",
  APPROVAL_REVIEW: "pending",
  IN_PROGRESS: "info",
  QUALIFICATION: "info",
  IN_QUALIFICATION: "info",
  ACTIVE: "info",
  ISSUED: "pending",
  RESPONSE_SUBMITTED: "pending",
  RESPONSE_REJECTED: "warning",
  VERIFICATION: "info",
  CONTAINED: "info",
  UNDER_INVESTIGATION: "info",
  DISPOSITIONED: "info",
  APPROVED: "success",
  CONDITIONALLY_APPROVED: "warning",
  RELEASED: "success",
  ACCEPTED: "success",
  CLEAN: "success",
  VALID: "success",
  EFFECTIVE: "success",
  IMPLEMENTATION_VERIFIED: "success",
  VERIFIED: "success",
  DONE: "success",
  CLOSED: "muted",
  ON_HOLD: "warning",
  HOLD: "warning",
  QUARANTINED: "warning",
  UPLOADING: "neutral",
  EXPIRING: "warning",
  OVERDUE: "danger",
  REJECTED: "danger",
  FAILED: "danger",
  INFECTED: "danger",
  SCAN_FAILED: "danger",
  SUSPENDED: "danger",
  DISQUALIFIED: "danger",
  REVOKED: "danger",
  EXPIRED: "danger",
  CANCELLED: "muted",
  WITHDRAWN: "muted",
  SUPERSEDED: "muted",
  OBSOLETE: "muted",
  INACTIVE: "muted",
  NOT_APPLICABLE: "muted",
  WAIVED: "muted",
  REQUIRED: "warning",
  CONDITIONAL: "info",
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "danger",
  SAFETY_CRITICAL: "danger",
  MINOR: "neutral",
  MAJOR: "warning",
};

export function statusTone(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";
  return TONES[status] ?? "neutral";
}

export function humanize(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .split("_")
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}
