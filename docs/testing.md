# Testing

| Suite | Location | Runs with | What it covers |
| --- | --- | --- | --- |
| Shared rules (Vitest) | `packages/shared/test` | `pnpm --filter @sqms/shared test` | applicability engine, document catalog, native form validation, risk model, numbering and file rules (29 tests) |
| Server core (Vitest) | `packages/server-core/test` | `pnpm --filter @sqms/server-core test` | ClamAV INSTREAM (clean and EICAR), S3 storage round trip, SMTP delivery against real services (7 tests) |
| Worker (Vitest) | `apps/worker/test` | `pnpm --filter @sqms/worker test` | signed webhook adapter, outbox retry/backoff, maintenance schedules (7 tests) |
| API integration (Jest + Supertest) | `apps/api/test/*.e2e-spec.ts` | `pnpm --filter @sqms/api test` | full HTTP flows against MySQL, Redis, MinIO, ClamAV, Mailpit and a spawned worker (10 suites, 73 tests) |
| End-to-end demos (Playwright) | `e2e/tests` | `pnpm test:e2e` | browser flows on a running stack (2 specs, 7 tests) |

`pnpm test` runs every unit and integration suite. Build first (`pnpm build:packages` and
`pnpm --filter @sqms/worker run build`): the API integration setup starts the compiled worker. The integration suites use dedicated resources (database
`sqms_test`, Redis database 1, bucket `sqms-test-files`); the global setup refuses to reset a database whose name
does not end in `_test`. The local infrastructure from `compose.dev.yaml` provides everything they need.

## API integration coverage

| Suite | Scenarios |
| --- | --- |
| `auth` (10) | login and anonymous rejection, HttpOnly cookies, CSRF and origin checks, signing in over an existing session, generic errors and lockout with audit, session revocation (logout, disable, other sessions), Phase 1 supplier login block, single-use reset tokens, structured errors without stack traces |
| `suppliers` (7) | creation with sites, contacts and capabilities; role-based authorization; optimistic concurrency and audited field changes; approval only through a qualification workflow; rejection comments; certifications and suspension; CSV export |
| `products` (3) | OEM and supplier cross references, supplier-product-site rules, baseline acceptance, delta acknowledgment/verification and locked controlled revisions |
| `documents` (7) | 37-type library; review, release, revision and supersession without overwriting releases; native form validation; parallel review, rejection, resubmission and information requests; concurrent approvals and releases; template and form versions; sharing restrictions |
| `files` (6) | streaming upload, quarantine, clean scan and identical bytes; ClamAV malware detection; disallowed types, mismatched signatures, empty and oversized files; CAD download-only and multi-chunk streaming; upload permission and orphan-file access; record attachments |
| `sourcing` (8) | Path A/B/C projects with pathway-specific configurations and checklists; reverse engineering on Pathway A only; checklist preview; waiver authority; intake review and document tasks; approval blocked while evidence is missing (including four-eyes evidence review); Path C approval; gate re-check at final approval |
| `changes` (5) | proposed vs authorized revisions; requalification and approval preserving the previous configuration; rejection keeps the approved configuration; approved location change; withdrawal |
| `quality` (5) | NCR containment and disposition with required concession; blocking NCRs stop product approval; SCAR from NCR with effective 8D before closure; overdue SCARs; supplier visibility of notes, NCRs and draft SCARs |
| `platform` (16) | manual and approval tasks; automatic completion of document tasks; internal vs supplier comments; timelines; notifications; saved views; administrator permissions, invitations, disabling users, supplier-role permission limits; settings, numbering and retention changes; policy versioning; workflow versioning; append-only audit trail; dashboard, reports and CSV; search within access |
| `isolation` (6) | shared/Prisma enum consistency; internal-only endpoints closed to suppliers; supplier isolation for files, documents, change requests, quality records, tasks and comments; persistence across restarts; concurrent edits (one wins, the others get 409) |

## End-to-end demos

Requires a running stack with the demo data (`pnpm db:seed:demo` locally or the Compose `demo` profile):

```bash
E2E_BASE_URL=http://localhost:3000 DEMO_USER_PASSWORD=... pnpm test:e2e
```

* **Pathway C turbocharger with ceramic coating, then a supplier change** - wizard, generated checklist, waiver,
  evidence, baseline and delta acceptance, qualification with FAI and coating test, approval through the inbox,
  then a coating sub-tier change request with impact assessments, requalification, approval with conditions,
  implementation verification and preserved configuration history.
* **NCR with containment, 8D corrective action and closure** - NCR with internal notes, containment, SCAR issue,
  8D response entered for the supplier, self-review rejected, independent review, effectiveness, closure of SCAR
  and NCR.

Each run creates new records, so the suites can be repeated. The sign-in rate limit applies (default 10 per minute
per IP); the suite signs each user in once and reuses the browser session. Reports and traces are written to
`e2e/playwright-report` and `e2e/test-results`. Locally installed Chromium can be used by setting
`PLAYWRIGHT_BROWSERS_PATH`; otherwise run `pnpm --filter @sqms/e2e exec playwright install chromium` once.
