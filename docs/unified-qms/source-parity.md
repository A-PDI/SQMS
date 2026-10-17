# Preserved QMS workflows and shared navigation

The workflow/theme reference is QMS-Development `9e534177cc4ebf08e559179bbb2af0b825313ec7`. Existing workflow pages, fields, forms and wording are retained directly. The latest user direction restores SQMS navigation and organization while retaining the QMS theme; see [navigation and theme](navigation-theme.md). The checksum manifest protects 80 unchanged source files and identifies six runtime/layout boundaries; run `pnpm verify:qms-source`.

## Integration boundaries

- The Next client entry hosts the original App and React Router. Both route systems now use the same `AppShell`, grouped navigation and header. Cross-boundary links use full navigation; original workflow links retain React Router behavior. The original `Layout.jsx` delegates to the integration layout.
- The original API client targets `/api/v1/qms`. A fixed route inventory declares backend permissions and dispatches the original contracts to canonical SQMS records. Authentication uses the existing HttpOnly session and CSRF mechanism. Original download and error envelopes are translated at that boundary.
- `OperationalTemplate` preserves the original editor's stable template identifier. Updating it creates a new immutable plan revision and advances the pointer, retaining the operator's existing edit/version actions. Inspection snapshots do not change.
- File bytes use the existing storage/scanning pipeline. Original names, photo captions, ordering and section/item associations remain part of the contracts. A download waits briefly for scanning rather than changing the original photo workflow.
- Deleting an operational record removes it from the original lists while retaining canonical evidence and audit history. Completed inspection editing requires the original reopen action, except the original narrowly scoped Fire Ring addition.
- Existing qualification NCRs keep their structured lifecycle controls when viewed through the original report adapter; the original three-state editor cannot bypass their approvals. Supplier responses exclude the original internal presentation fields.
- Grouped navigation replaces the previous appended flat menu. It combines SQMS organization with the QMS navy/amber palette, Inter fonts and rounded controls. Original page allow-lists still constrain the original entries, in addition to effective backend permissions. System administration remains at `/system-admin`; `/admin` contains the original forms/catalogue workflow.

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

The original-versus-integration comparison files describe commit `4941216`, before the user authorized a different shell. They remain historical evidence for that iteration and do not establish current layout equality. Current screenshots are linked from the navigation/theme document. Workflow editors and original theme files continue to be checksum-protected.

## Release and remaining acceptance

Apply both correction migrations (`20261017010000_original_qms_contract` and `20261017020000_restore_original_contract_metadata`) on the SQMS test database before deploying the API and web from the same correction commit. The second restores original presentation fields from retained source snapshots only where the new fields are unset. The normal web build now includes the source-verification script and manifest inside `apps/web`, so they are included in the existing Docker build context.

The correction is for review and internal acceptance. Do not switch operational users or make the old application read-only. A copied SQLite database and upload directory, historical PDFs, real test-safe integration credentials, and operator walkthroughs are still required to establish complete replacement parity. Nothing in this correction changes the operational QMS repository or deployment.
