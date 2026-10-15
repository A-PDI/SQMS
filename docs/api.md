# REST API

* Base path: `/api/v1` (versioned; breaking changes would be published under `/api/v2`).
* Interactive documentation: `/api/docs` (Swagger UI) and `/api/docs-json` when `SWAGGER_ENABLED=true`
  (default off in the Compose stack).
* Static OpenAPI document: [`docs/api/openapi.json`](api/openapi.json) - 217 paths, 261 operations. Regenerate with
  `pnpm --filter @sqms/api run openapi:export ../../docs/api/openapi.json` after building the API.

## Authentication and request rules

| Rule | Detail |
| --- | --- |
| Session | `POST /auth/login` sets an HttpOnly, SameSite=Lax session cookie (`Secure` outside local development) and a readable CSRF cookie; the token is also returned in the body and by `GET /auth/me`. Sessions are server-side, with idle and absolute expiry. |
| CSRF | Every `POST/PUT/PATCH/DELETE` from a signed-in session sends `X-CSRF-Token`. A present `Origin`/`Referer` must match `APP_ORIGINS`. |
| Concurrency | Updates of versioned records send `expectedVersion`; a mismatch returns `409 STALE_VERSION`. |
| Validation | Unknown properties are rejected (`400 VALIDATION_FAILED` with field messages). |
| Rate limits | Per-instance API limit (`API_RATE_LIMIT_PER_MINUTE`); sign-in limited per IP and per email (`LOGIN_RATE_LIMIT_PER_MINUTE`) with account lockout after repeated failures. |
| Files | `POST /files` takes `multipart/form-data` (field `file`); files are quarantined until scanned. Downloads: `GET /files/{id}/download`, inline preview for PDF/images: `GET /files/{id}/preview`. |
| Lists | `page`, `pageSize` (max 200), `q`, `sort`, `order` plus resource filters; responses are `{ items, total, page, pageSize }`. CSV exports are `.../export.csv`. |

## Errors

```json
{ "error": { "code": "APPROVAL_GATE_FAILED", "message": "...", "details": { "checks": [ ... ] }, "correlationId": "..." } }
```

Common codes: `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404 - also returned for records outside the
caller's supplier scope), `STALE_VERSION` / `INVALID_TRANSITION` / `CONTROLLED_RECORD` (409),
`BUSINESS_RULE_VIOLATION` / `APPROVAL_GATE_FAILED` (422), `RATE_LIMITED` (429). The `X-Request-Id` response
header carries the correlation id that also appears in the server log and the audit trail.

## Resource groups (operations)

| Group | Ops | Highlights |
| --- | --- | --- |
| auth | 12 | login/logout, me, profile, sessions, password change/reset, invitations |
| suppliers, supplier-sites | 23 | supplier master, sites, contacts, certifications, supplier qualifications, CSV export |
| products, supplier-products, product-configurations | 34 | internal parts, cross references, supplier parts, sources, configurations and revisions, baselines, delta requirements, acknowledgments, characteristics |
| sourcing-projects | 21 | checklist preview, project creation, risk re-assessment, intake submission, requirements (waive, reinstate, link, create document) |
| document-types, document-templates | 16 | library, governance fields, templates and revisions, native form versions |
| documents, files | 28 | records, revisions, files, submit/withdraw/reopen/release, obsolete/supersede, links, shares, acknowledgments, generated ENG-04/06/08 |
| qualifications | 17 | gate, tests, FAI, inspection results, submission, approval package with integrity check |
| change-requests | 13 | create/submit/withdraw, impact assessments, requalification decision, approval, implementation verification |
| ncrs, scars, deviations | 30 | containment, disposition, 8D responses, four-eyes review, effectiveness, escalation, concessions |
| approvals | 5 | inbox, decisions, reassignment, history |
| tasks, comments, activity, notifications, saved-views, directory | 20 | collaboration and personal settings |
| dashboard, reports, search, lookups | 7 | KPIs, reports with CSV, global search |
| admin, audit | 32 | users, invitations, roles, settings, numbering, file types, retention, workflows, applicability policies; audit search and export |
| portal | 1 | supplier home (Phase 2, disabled by default) |
| health | 2 | liveness and readiness |
