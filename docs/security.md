# Security

## Identity and sessions

* **Passwords** are hashed with Argon2id (memory 19 MiB, 2 iterations, parallelism 1) and transparently re-hashed
  when parameters change. Policy: 12-256 characters with at least three of lowercase, uppercase, digits and symbols.
* **Sessions** are server-side. The browser holds an opaque random token in an HttpOnly, SameSite=Lax cookie that
  is `Secure` in production; only its SHA-256 hash is stored. Sessions expire after inactivity
  (`SESSION_IDLE_MINUTES`) and absolutely (`SESSION_ABSOLUTE_HOURS`), and are revoked on sign-out, password change,
  administrator action and when another user signs in on the same browser. Users can review and end their sessions
  under My profile.
* **Brute force**: sign-in attempts are limited per IP and per email through Redis (shared by all API instances),
  accounts lock after `LOGIN_MAX_FAILURES` failures, and sign-in errors are generic. Password reset tokens are
  single-use, hashed and short-lived; reset requests never reveal whether an account exists.
* **CSRF**: unsafe requests from a session must carry an HMAC token bound to the session (`X-CSRF-Token`); a present
  `Origin`/`Referer` must be one of `APP_ORIGINS`. Signing in while another session is present additionally
  requires an allowed `Origin`.
* **Supplier users (Phase 2)** are disabled by `SUPPLIER_PORTAL_ENABLED=false`; the production configuration
  refuses to enable them until an external MFA provider is configured. MFA factors are modeled
  (`UserMfaFactor`) for that rollout.

## Authorization

* Permissions are fine-grained (`supplier:write`, `project:waive_mandatory`, `document:release`, `ncr:disposition`,
  `admin:roles`, ...) and grouped into roles; supplier roles can only contain permissions marked safe for external
  users. Every endpoint declares its permissions and audience (internal / supplier / any); the UI hides what a
  user cannot do, but the server decides.
* **Supplier isolation is enforced in the API**, not in the UI: every query on supplier-owned data is scoped to the
  caller's supplier, identifiers in requests never widen access, and out-of-scope records are reported as not found.
  Internal-only comments, notes and assessments are removed from supplier responses. Isolation tests cover files,
  documents, change requests, quality records, tasks, comments and activity.
* **Separation of duties**: approval workflows prevent self-approval (`workflow.preventSelfApproval`); SCAR
  responses, test results and first article inspections cannot be reviewed by the person who recorded them; waiving mandatory controls
  needs a dedicated permission and a justification.
* Approvals cannot be bypassed: approved states are only reachable through the workflow and the approval gate.

## Data protection

* **Files**: uploads stream through the API (no base64 payloads). The extension must be on the administrator-managed
  allow-list (executables and scripts can never be enabled), the content signature must match, sizes are limited,
  and SHA-256 is recorded. Files stay quarantined until ClamAV reports them clean; infected files are blocked,
  audited and reported. Objects live in a private bucket under opaque keys and are only streamed by the API after an
  authorization check, with `Content-Disposition`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` and a
  restrictive CSP on previews. The application uses bucket-scoped credentials, never the storage root account.
* **Database accounts**: the application connects with a DML-only account; migrations use a separate DDL account;
  a read-only reporting account exists for BI. MySQL, Redis, MinIO and ClamAV are not exposed outside the
  internal network in the Compose deployment; the MinIO console is disabled.
* **Audit trail**: security events (sign-in success/failure/lockout, denied access, rejected uploads, exports),
  data changes with before/after values, approvals, waivers and administrative changes are written in the same
  transaction as the change. Database triggers reject `UPDATE`/`DELETE` on `audit_events`, so neither administrators
  nor the application can alter history. Audit search and CSV export require `audit:read`; exports are themselves
  audited.
* **Responses and headers**: production errors never include stack traces or internal details; every response has
  a correlation id. The API sends strict security headers (Helmet, CSP `default-src 'none'`); the web app sends a CSP,
  `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and a restrictive permissions policy.
* **Secrets** are supplied through the environment / secrets manager. Example files contain local-only values,
  Compose refuses to start without the required secrets, and the demo seed (fictional users with a shared password)
  refuses to run when `NODE_ENV=production`. The first administrator is created only from explicitly supplied
  `SEED_ADMIN_*` values that satisfy the password policy.
* **Retention**: retention policies record the trigger and period per document category, but periods are left for
  your records-management and legal teams to set; the system does not assume legal retention periods.

## Production checklist

1. Terminate TLS at the gateway (`SQMS_SITE_ADDRESS=<domain>` lets Caddy obtain certificates) and keep
   `COOKIE_SECURE=true`, `APP_ORIGINS` set to the public origin only, `TRUST_PROXY=true` behind the gateway.
2. Generate unique secrets (`CSRF_SECRET`, database, Redis, MinIO) and store them in a secrets manager.
3. Keep `SUPPLIER_PORTAL_ENABLED=false` until MFA for external users is in place.
4. Leave `SWAGGER_ENABLED=false` unless the API documentation must be reachable.
5. Restrict network access so only the gateway is public; back up MySQL and object storage (see
   [backup and restore](backup-restore.md)).
6. Review roles and permissions, file types and settings in Administration; set retention periods with records
   management.
