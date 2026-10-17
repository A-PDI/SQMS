# One-way migration rehearsal and final refresh

## Obtain a consistent source copy

The QMS source is SQLite, not MySQL. Do not copy a live `.db` file independently of its WAL. The operational owner should obtain a standalone SQLite backup through the SQLite online-backup API or the app's verified backup process, and a corresponding copy of uploads/drawings. This document is a prepared procedure; the implementation has no operational database/upload access and does not run it against production.

For a live online backup, the authorized owner can use Python `sqlite3.connect('file:...?...mode=ro', uri=True)` and `connection.backup(destination)` to include committed WAL transactions in a consistent snapshot without executing application startup code. Never use `immutable=1` on the live database. For final release, stop source writes/uploads first, finish the backup, copy matching files, run `PRAGMA quick_check` and `foreign_key_check` on the standalone copy, and record the time, source commit, source timezone, row counts and file manifest. A database backup alone is insufficient. Test a restore on a separate directory and verify representative records/files before approving it as the release baseline.

Transfer an immutable baseline into private storage outside the repository. Keep the supplied baseline unchanged; make a working copy for intake. Hash the baseline and copied files. Source timezone must come from reliable configuration/operator evidence, not the tester's workstation. Record unknown historical timezones and template versions as unknown. Preserve all available backups for investigating records absent from this dataset; absence is not a claim that deletion is unrecoverable.

## Tools and private inputs

`tools/migration/intake.py` reads a standalone copy with SQLite read-only/query-only/immutable settings and never imports legacy application code. Nonempty WAL/journal files cause refusal. It verifies the source hash before/after, profiles table/type/period/status/source grouping, enumerates exact supplier/part strings and foreign-key issues, and hashes explicitly mapped files beneath a copied attachment root. Files escaping that root, symlinks out of it, mismatched signatures and missing paths require review.

The intake contains local credential hashes and business data. It is written mode 0600 with exclusive creation. Never attach it to a PR, log it, or use an operational upload directory as its file root. Generic settings, sessions, tokens, API keys and production integration credentials are excluded. Safe configuration is recreated explicitly in SQMS.

```sh
python3 tools/migration/intake.py --help
python3 tools/migration/intake.py \
  --source-copy /private/qms-baseline/inspection.db \
  --attachment-copy /private/qms-baseline/uploads \
  --path-map /private/qms-work/path-map.json \
  --dataset COPIED-2026-10-16 \
  --source-timezone America/Denver \
  --output /private/qms-work/intake.json
```

Do not guess the timezone. Omit it when unknown. `path-map.json` maps exact `table:sourceId` keys to reviewed relative files, for example `inspection_attachments:SOURCE_UUID` → `inspection/SOURCE_UUID/photo.jpg`. Windows paths in the source database are evidence, not usable target filesystem paths.

For fixtures only:

```sh
python3 tools/migration/seed-rehearsal.py --legacy-repository /readonly/QMS-Development --output-root /private/qms-seed-rehearsal
```

This copies only the repository seed and its upload fixtures. It is labeled **repository seed fixture**, never production data. `synthetic-fixture.py` provides a self-contained CI fallback; neither fixture represents the operational inventory.

## Isolation and reviewed mappings

Start a dedicated local target database ending `_test` or `_migration`, isolated file bucket ending `-test`/`-test-files`/`-migration`/`-migration-files`, and a local scanner/worker. Reference-seed the roles, document catalog and migration operator. Use a migration account only for schema changes; the application/import account uses DML. Supply the target manifest in `tools/migration/target.example.json` and review every identity in it.

The CLI refuses a target unless all of these match: explicit disposable purpose/dataset ID, exact loopback database host/name, exact loopback S3 endpoint and bucket, explicit loopback Redis database 1–15, NODE_ENV test/development, portal false, mail disabled, webhook unset, bench disabled/no API key and sheet delivery disabled. This tool is deliberately not a remote production importer. For an isolated Render candidate, use a verified backup/restore of the reconciled local dataset after verifying Render identity, or a reviewed loopback tunnel to an explicitly disposable target. Do not weaken the guards to reach an unknown service.

Mappings are versioned private JSON, based on `tools/migration/mappings.example.json`:

- `roles[legacyRole]`: explicit `roleKeys`, `reviewedById`, `reason`. Start with inspector→INSPECTOR and qc_manager→QUALITY_MANAGER; review actual behavior/page exceptions before approving. Admin→SYSTEM_ADMIN only when intended. Custom per-user page grants require explicit account review. No automatic QM privilege escalation.
- `users[sourceId]`: explicit duplicate-email/ownership merge to an existing internal account. Existing credentials/grants of that account stay authoritative.
- `parts[exactOriginalString]`: a reviewed InternalPart alias. Original punctuation, leading zeros, whitespace and text remain in legacy snapshots. Case/accent collation collisions require review.
- `records['inspections:ID'|'ncrs:ID'|...]`: reviewed supplierProductId/internalPartId/supplierId, reviewer and reason. Supplier-product ownership must agree. No supplier inferred from a part number. Reliable PO/vendor evidence or manual review is required.
- `timestampOverrides['table:ID:field']`: a reviewed unambiguous ISO timestamp for unknown or ambiguous local times.
- `drawingDocumentTypeId`: `{targetId, reviewedById, reason}` for the actual controlled document type from the PDI register. Without it, bytes/part associations remain historical attachments and controlled-document classification is unresolved.
- `overwriteTestEdits['table:ID']`: exact reviewed exception with reviewer/reason. The default is to preserve target edits as CONFLICT, never overwrite them silently.

Every source entity/ID has a stable namespaced UUID mapping in LegacyRecord, preventing collisions with existing SQMS fixtures. Original IDs, text/JSON, numbers and timestamps remain in its credential-free raw snapshot. Password hashes live only in the protected User credential field, not LegacyRecord or reports. Original template snapshots and per-inspection overrides are retained; unknown historic template versions are labeled. Unclassified history is visible but cannot silently acquire a physical-feature identity. Quality can append an audited classification to closed legacy NCRs without inventing historical approvals.

## Rehearsal sequence

Build first. Set isolated environment variables through a private env file; never put real credentials in the command text. The operator must be an active internal user with admin:users and admin:settings. The CLI report is exclusive-create 0600. Use a different report path per run.

```sh
corepack pnpm build:packages
corepack pnpm --filter @sqms/api --filter @sqms/worker build
node --env-file=/private/qms-work/rehearsal.env apps/api/dist/migration/cli.js \
  --intake /private/qms-work/intake.json \
  --target /private/qms-work/target.json \
  --mappings /private/qms-work/mappings.json \
  --operator-id REVIEWED_OPERATOR_UUID \
  --attachment-copy /private/qms-baseline/uploads \
  --mode dry-run --report /private/qms-work/01-dry-run.json
```

Resolve reported failures/ambiguities using reviewed mappings. Run `--mode import` with another report. Imported files remain QUARANTINED until ClamAV scans them. The CLI queues committed files immediately; pending database rows let the worker sweep recover enqueue failure; run the normal worker with mail/webhooks/bench/sheets disabled and wait for pending scans. Then run `--mode validate`. Inspect all record outcomes, period/status/group counts, source-to-target links, business-field checks, ownership, raw snapshots, item/measurement values/specifications/units/outcomes, all file hashes/readability/associations, closed NCRs and repair attempts. Select representative standard/custom/miscellaneous, NCR/photo and injector reports for PDF comparison with the old application's issued outputs. Get inspector/test-lab/Quality acceptance.

Re-run import against the same target and same inputs: counts must not grow, stable IDs remain stable, and unchanged records report UNCHANGED. A changed reviewed mapping participates in the source fingerprint so corrections are applied intentionally. Manually edited target records become CONFLICT and remain intact. Target credential rehashes, edited roles and amended records are test edits too. A refresh never deletes records merely absent from a later copy. Exclusions/unresolved records remain accounted for; a final refresh must reconcile genuine source deletions/archive decisions explicitly rather than propagate destructive deletion.

Exit codes: 0 clean; 1 refused/unhandled failure; 2 failed/conflicting/failed semantic checks; 3 unresolved mappings or unreadable evidence. Inspect the private report; a nonzero status is not acceptance. Quarantine/scanning status can change without being mistaken for a content edit.

## Reset, rebuild and release dataset

There is no broad reset command. To rehearse a clean import, provision a **new empty** explicitly disposable database and bucket, apply migrations/reference seed, copy reviewed mapping decisions with new target IDs where needed, and use a new manifest. Preserve the previous target for comparison until its owner deliberately disposes of it. Do not run `migrate reset` on unrelated SQMS test data.

Keep fictional demo data and acceptance edits outside the final release dataset. Once the operational export is available, rehearse with it, reconcile every exception and record duration. For the final refresh after the separately authorized source freeze, build a fresh release dataset from the final standalone export plus the reviewed master/mapping/annotation package. Restore it into the verified isolated candidate and repeat acceptance. If preserving a prior target instead, every test edit/collision and every changed source record needs explicit disposition; target-test annotations must not silently become production facts.
