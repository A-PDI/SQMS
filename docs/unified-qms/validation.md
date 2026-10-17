# Local acceptance evidence

## October 17 reference correction

The original screens supersede the first implementation's replacement editors and shell. See [source parity](source-parity.md), [feature preservation](feature-preservation.md), and [render comparison results](render-comparison.json).

Verified against the corrected code:

- 81 source/style/asset hashes match QMS-Development `9e53417`; five runtime/API boundary files are declared separately.
- 119 original frontend helper tests pass.
- 88 legacy-domain tests pass, including the latest injector part mapping.
- 116 API tests in 18 suites pass on the explicitly disposable `sqms_qms_parity_test` database. This includes the original local-password, template editing/versioning, catalogue, multi-item JSON, assignment, complete/reopen, NCR narrative, reporting and repair/cache contracts, plus upgrade-field restoration and retained-evidence deletion checks.
- The API and Next.js production builds pass, and the browser-test TypeScript check passes.
- The original inspection modal → serial/result entry → completion → reload → PDF browser flow passes on a separate fictional stack.
- The original NCR narrative/photo/caption → save → scanned image → reload flow passes, including navigation to the added Suppliers page and logout back to the original login.
- The complete Chromium suite passes 9/9 tests against the rebuilt correction: the two original-screen workflows, NCR/8D/SCAR closure, and Pathway C qualification, approval and supplier-change requalification. The local browser URL must match `APP_ORIGINS` (`http://localhost:3000` in this fixture); an initial run using the IP address was rejected by the origin check, then rerun successfully with the configured origin.
- All 15 migrations apply successfully, including the two correction migrations. Existing imported NCR fields, user page permissions and drawing metadata are restored from retained source snapshots where the new fields are unset. A populated NCR upgrade fixture verifies the original values are readable through the original contract.
- 22 original-versus-integration screenshot pairs cover 11 screens at desktop and mobile widths with identical empty-list fixtures. 21 are pixel-identical. One mobile native-select text area differs by 939 pixels of 351,000; both use the original source and CSS. No page JavaScript errors occurred. These comparisons do not cover every populated form, dialog or historical record.

No operational database, upload set, real integration transport or operator acceptance was used. These results support review of the correction, not production cutover. Earlier evidence below describes the first implementation's checks and must not be interpreted as proof of original workflow parity.


Evidence collected on 16 October 2026 on branch `codex/unified-qms`, based on SQMS `bf9be7f`. The assessed source was independently checked against QMS-Development `6c53d829a5e69ff095975cddc41d419c4b812ada`. The original operational checkout and the separate source checkout remain unchanged. No operational runtime, database, uploaded files, users or deployment were modified.

This is local candidate evidence. No copied operational dataset, confirmed Render service, live test-safe CarbonZapp credentials or PDI form register was supplied. Repository seeds and synthetic records do not establish operational migration or PDF parity.

## Isolated foundation

- Node 24.19.0; pinned pnpm 10.28.0 via Corepack. MySQL 8.4.11, Redis 7.4, private MinIO, real ClamAV and Mailpit ran under the explicitly named local Compose project `sqms-unified-test` with loopback ports.
- The unmodified SQMS baseline passed 73 API tests in 10 suites, 29 shared tests, 7 server-core tests and 7 worker tests. There were no unexplained baseline test failures to carry forward.
- Dedicated targets: `sqms_unified_acceptance_test` for the API suite; `sqms_browser_acceptance_test` / Redis database 2 / `sqms-browser-test-files` for browser acceptance; `sqms_unified_rehearsal_migration` / Redis database 3 / `sqms-rehearsal-test-files` for the CLI rehearsal. API fixtures use Redis database 1 and `sqms-test-files`. None points to an operational source.
- Browser/rehearsal configurations keep the portal off, mail disabled, webhooks unset, Google delivery disabled and bench transport disabled/recorded. API isolation tests deliberately turn the portal flag on inside their test context to verify supplier isolation, then separately verify portal-off session denials. SMTP tests deliver only to local Mailpit; Google and CarbonZapp transport tests use mocks.

## Automated checks

| Check | Actual command or equivalent | Result |
| --- | --- | --- |
| Workspace types | `corepack pnpm typecheck` | Pass across application, package and browser-test projects |
| Shared rules | `corepack pnpm --filter @sqms/shared test` | 29 passed, 4 files |
| Preserved calculations/renderers | `corepack pnpm --filter @sqms/legacy-domain test` | 85 passed |
| Storage, malware and mail sink | `corepack pnpm --filter @sqms/server-core test` | 7 passed, real MinIO/ClamAV/Mailpit |
| Worker recovery and delivery adapters | `corepack pnpm --filter @sqms/worker test` | 11 passed, 3 files |
| API and database integration | Explicit disposable test URLs, then `corepack pnpm --filter @sqms/api test` | 106 passed, 17 suites |
| Internal browser workflows | Fictional demo seed and `DEMO_USER_PASSWORD`, then `corepack pnpm --filter @sqms/e2e e2e` | 10 passed in Chromium against the rebuilt candidate |
| Shared/database/core builds | `corepack pnpm build:packages` | Pass, including Prisma generation |
| API/worker production builds | `corepack pnpm --filter @sqms/api --filter @sqms/worker build` | Pass |
| Next.js production build | `API_PROXY_URL=http://127.0.0.1:4100 corepack pnpm --filter @sqms/web build` | Pass |
| Additive schema deployment | `prisma migrate deploy` into a new empty rehearsal database | All 13 migrations applied, including 8 new migrations |
| Prisma drift | Explicit rehearsal `MIGRATION_DATABASE_URL`, then `prisma migrate diff --from-config-datasource --to-schema prisma/schema --exit-code` from `packages/db` | Exit 0: no difference detected |
| Migration/backup syntax | Python compilation; `node --check tools/backup/objects.cjs`; `git diff --check` | Pass |
| Clean Docker image build | Root Dockerfile API target, pinned Node images and pnpm, verified CA/proxy configuration | Incomplete: dependency-layer preparation exhausted the 32 GiB workspace; no image/deployment success claimed |

The API command uses both `TEST_DATABASE_URL` and `TEST_MIGRATION_DATABASE_URL` for `sqms_unified_acceptance_test`. The suite intentionally truncates that explicitly disposable dataset. It does not reset another development database. `LEGACY_QMS_REPOSITORY=/workspace/scratch/qms-current` also exercises the actual repository seed in the final run.

API coverage includes local bcrypt verification/Argon2id upgrade, admin-created accounts, default-deny permissions, no ordinary Quality Manager user administration, completed inspection/evidence protection, immutable released plans, uppercase FAIL alerts, snapshot preservation, internal/unattributed NCRs, relational origin constraints, captioned/scanned photo PDFs, report totals/workbook ownership, injector report-slot deduplication, DNF, serial ambiguity, quick repairs, automatic retests and idempotent bench-to-inspection conversion. A negative regression denies document-file access to an internal account with no document permission, even when it belongs to the owning organization.

The connected-quality scenario executes rejected FAI → NCR-A → closed historical defect → accepted replacement FAI → exact supplier/part/site/revision approval → later failed incoming measurement → historical candidate → NCR-B → human-confirmed recurrence. Approval stays active until an authorized person decides otherwise. A reused balloon on a different stable feature does not match. A forced pre-commit failure leaves no partial NCR/command; retry and replay produce one NCR. Outbox leases, mocked append-before-ack Google recovery and durable scan/notification rows cover asynchronous recovery.

Chromium covers the existing NCR/containment/8D/SCAR/closure flow; Pathway C sourcing, evidence, approval and supplier-change requalification; a two-item standard inspection with shared Receiving and serials; a failed custom form through scanned row evidence, inline NCR, narrative/caption and PDF download; and recorded injector sync through quick repair, automatic retest, comparison preview and PDF download. Accessible field labels and repeatable fixture filtering are used. Screenshots were inspected locally. These are representative workflows; acceptance of every operationally used form and actual issued PDF remains a business gate.

## Command-line migration rehearsal

The real repository seed was copied with `tools/migration/seed-rehearsal.py`; the old application was never started. The standalone SQLite copy passed intake checks and source checksum preservation. The source contains 37 rows: 1 user, 13 templates, 3 inspections, 18 activity entries and 2 attachments. It contains no NCR, drawing, part-specification or injector/repair history.

The compiled CLI was invoked with `--intake`, `--target`, `--mappings`, `--operator-id`, `--attachment-copy` and a distinct private `--report` for each mode. The target manifest exactly names the loopback database, storage bucket and Redis database. A reference-seeded internal administrator supplied the reviewed fixture role mapping. No source secrets/settings or active sessions were imported.

| Step | Outcome | Duration |
| --- | --- | --- |
| Dry run | 34 mapped, 3 unresolved; no target business rows/files created | 251 ms |
| Import | 3 inspections, 2 files; 34 mapped and 3 explicitly unresolved | 1,558 ms |
| Repeat import | All 37 source rows unchanged; target counts identical | 270 ms |
| Validate | All 37 field-level checks passed; both files CLEAN/readable/hash-matched | 353 ms |

Each step returns exit 3 because the three source inspections have no attributable supplier/site and their original historical template versions are unknown. This is the documented unresolved-exception exit, not silent success. No suppliers or historical approvals were invented. There were zero failed records, conflicts, failed business checks or unreadable attachments. Seed timings are not production-size performance estimates.

A separate richer synthetic integration fixture exercises closed/dispositioned NCR exceptions without invented concessions, narrative and row-photo associations, orphaned alerts, saved report configurations (including the source's double encoding), draft controlled drawing revisions, injector measurements/units/outcomes, permanent repairs/attempts/changes/deltas and repeated imports. Ambiguous daylight-saving timestamps require explicit reviewed overrides. Tests also preserve manually edited targets instead of overwriting them.

Private intake, mappings, account hashes, SQL archives and detailed reports stay outside Git. A sanitized summary is included in `evidence/local-validation.json`.

## Separate restore drill

`tools/backup/database.py` backed up `sqms_unified_acceptance_test` and restored it into the new `sqms_unified_restore_test`, without dropping or resetting an existing database. The SQL checksum and every table count matched: **111 tables, 7,947 test rows**. The schema-scoped application/migrator grants were reapplied, including privileges for preserved trigger definers. Attempts to update audit history or alter a released inspection definition were rejected by the restored triggers.

`tools/backup/objects.cjs` archived **234 objects, 48,670,125 bytes** and restored them to a second empty MinIO instance at `http://127.0.0.1:19000`, preserving bucket and object keys. Every archive/restored hash matched. A read-only verification against the restored database read all **46 CLEAN file records**, checked their byte counts and SHA-256 hashes against the restored objects, and verified NCR origin integrity. The bucket also contains test leftovers and quarantined/infected-state evidence, so object count is not presented as the managed CLEAN-file count.

The prepared runbook includes source SQLite/WAL-aware backup, final refresh, test-edit handling, named release responsibilities and rollback before/after target writes. Actual operational source restore, confirmed Render persistence and a business-operated post-cutover-delta rollback drill have not been performed.

## Failures and remaining gates

Implementation failures found during development were corrected and retested: PDF text assertions, binary workbook parsing, immediate migration scan queueing, accessible browser selectors, and internal document-file permission checks. Disk exhaustion during image building interrupted local Redis/worker processing; only this task's disposable build/download cache was removed. After restart, committed pending scans and integration events recovered. The database and every bucket were preserved. No production-directed integration writes occurred.

The clean image build still requires a build host with enough free disk. Operational data reconciliation/PDF parity, PDI register review, user/operator sign-off and confirmed Render deployment/restore/persistence remain open in [remaining work](remaining-work.md). Passing local fixtures does not close those gates or authorize cutover.

## Final check record

The final complete API run passed **106/106 tests in 17 suites** (95.898 seconds), including the new document-file denial and unmapped inspection-part PDF assertions. The focused file-authorization suite also passed 7/7. The rebuilt browser candidate passed **10/10 Chromium tests** (1.1 minutes), including the original part number displayed as unmapped on the NCR. The 132 shared/calculation/infrastructure/worker tests passed. Workspace types, API/worker and Next.js production builds passed. No local automated test failures remain.

The clean Docker image build, operational-data acceptance and Render acceptance remain explicitly incomplete. No merge, production cutover or supplier-portal activation was performed.
