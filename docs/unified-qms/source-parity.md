# Reference UI and workflow correction

The source of truth is QMS-Development `9e534177cc4ebf08e559179bbb2af0b825313ec7`. Existing workflow steps, fields, form layouts, wording and visual styles are retained directly. The checksum manifest is `apps/web/qms-source-manifest.json`; run `pnpm verify:qms-source`.

## Integration boundaries

- The Next client entry hosts the original App and React Router. Cross-boundary navigation to the added SQMS modules uses full navigation; both surfaces use the original Layout/Sidebar.
- The original API client targets `/api/v1/qms`. A fixed route inventory declares backend permissions and dispatches the original contracts to canonical SQMS records. Authentication uses the existing HttpOnly session and CSRF mechanism. Original download and error envelopes are translated at that boundary.
- `OperationalTemplate` preserves the original editor's stable template identifier. Updating it creates a new immutable plan revision and advances the pointer, retaining the operator's existing edit/version actions. Inspection snapshots do not change.
- File bytes use the existing storage/scanning pipeline. Original names, photo captions, ordering and section/item associations remain part of the contracts. A download waits briefly for scanning rather than changing the original photo workflow.
- Deleting an operational record removes it from the original lists while retaining canonical evidence and audit history. Completed inspection editing requires the original reopen action, except the original narrowly scoped Fire Ring addition.
- Existing qualification NCRs keep their structured lifecycle controls when viewed through the original report adapter; the original three-state editor cannot bypass their approvals. Supplier responses exclude the original internal presentation fields.
- Original navigation order is retained. Links to the additional supplier-quality modules are appended and use the original navigation styling. System administration remains available at `/system-admin`; `/admin` is the original QMS Admin workflow.

## Reproducible checks

```sh
pnpm verify:qms-source
pnpm --filter @sqms/web test
pnpm --filter @sqms/legacy-domain test
pnpm --filter @sqms/api typecheck
pnpm --filter @sqms/web build
```

API integration tests use an explicitly disposable database ending in `_test`, with matching `TEST_DATABASE_URL` and `TEST_MIGRATION_DATABASE_URL`. `qms-contract.e2e-spec.ts` exercises the original payloads and actions. The original client tests are copied with import paths redirected to the preserved source.

`e2e/tests/original-qms.spec.ts` exercises the original UI against an isolated, seeded stack. Its seed account is fictional. Use `E2E_BASE_URL` and `DEMO_USER_PASSWORD` for that stack. Never run fixture provisioning against the operational deployment.

For visual comparison, run the pinned original frontend in a separate temporary directory, supply identical fictional API responses to both frontends, wait for the Inter fonts to load, and compare desktop (1440 × 900) and mobile (390 × 900) captures. The reference fixture must include the analytics definitions supplied by the original API; a blank error screen is not a successful comparison. The source and integration use the same font files for deterministic rendering. Native select text can have a small transient font-rasterization difference; record actual differences instead of claiming all screens are pixel-identical.

## Release and remaining acceptance

Apply both correction migrations (`20261017010000_original_qms_contract` and `20261017020000_restore_original_contract_metadata`) on the SQMS test database before deploying the API and web from the same correction commit. The second restores original presentation fields from retained source snapshots only where the new fields are unset. The normal web build now includes the source-verification script and manifest inside `apps/web`, so they are included in the existing Docker build context.

The correction is for review and internal acceptance. Do not switch operational users or make the old application read-only. A copied SQLite database and upload directory, historical PDFs, real test-safe integration credentials, and operator walkthroughs are still required to establish complete replacement parity. Nothing in this correction changes the operational QMS repository or deployment.
