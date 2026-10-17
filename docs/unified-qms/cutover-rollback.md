# Prepared cutover and rollback runbook

**Do not execute production cutover under this implementation assignment.** The operational QMS remains the sole writer. This package becomes an executable release plan only after the business approves the complete candidate and names the responsible people.

## Responsibilities and entry evidence

Name a release lead, operational QMS owner, database/storage operator, Quality decision maker, inspector/Test Lab acceptance leads and rollback decision maker. Record exact source/target hosts, database/bucket identities, immutable export IDs, implementation SHA, migration manifest/mapping versions, timezone decisions and approved test URLs. Record retention obligations separately. Identify every integration, scheduler and outbound destination.

Go/no-go requires the completed feature matrix, all required local and confirmed-Render checks, verified source/target restores, operational-data reconciliation with every exception explained/accepted, all file hashes/readability/associations, representative PDF comparisons, account/role/ownership acceptance, and the FAI → replacement approval → production recurrence scenario. Injector testing/repairs, drawings, reporting and custom forms must no longer depend on the old app. No partial operational cutover is permitted. Unknown supplier attribution can be accepted only as an explicit labeled exception, never silently inferred.

## Backups and restore proof

Source: the authorized operational owner stops source writes/uploads for final export, makes a standalone SQLite online-backup or cold-backup set and matching file manifest/copy, records checksums and verifies integrity/restore in a separate location. Include code/configuration metadata and secrets through the approved secret-backup process, not ordinary migration settings. Never run the old app against the only baseline copy: startup mutates data.

Target: quiesce target application writes and pause worker/integration dispatch before the final database-and-object snapshot. Back up MySQL with a DDL/backup account using `mysqldump --single-transaction --no-tablespaces --set-gtid-purged=OFF --routines --triggers --events DATABASE`, plus schema/migration metadata, roles, audit, outbox, files/associations and all object bytes. Stream credentials from protected configuration; never pass actual passwords in a shared command/log. Archive object storage through its S3 API/native versioned backup. Preserve source keys, hashes, lengths and any bucket version/retention configuration. Redis is recoverable job state; committed pending email/scan/outbox work is authoritative in MySQL.

Restore into separately named empty resources, never over an unrelated database/bucket. Apply database/file configuration and access policies, verify all table counts and business checks, read/hash every object and test representative downloads/PDFs. Verify append-only audit and released-plan triggers, DML-only runtime permissions, portal-off state and delivery disabled/test-sink configuration. Record measured backup/restore duration and resource IDs. A backup without a successful separate restore is not release evidence.

Local executable rehearsal tools (loopback S3/named Compose test databases only):

```sh
python3 tools/backup/database.py --mode backup \
  --container sqms-unified-test-mysql-1 --project sqms-unified-test \
  --database sqms_unified_acceptance_test --directory /private/release-drill/sql
node --env-file=/private/rehearsal.env tools/backup/objects.cjs \
  --mode backup --bucket sqms-test-files --directory /private/release-drill/objects
python3 tools/backup/database.py --mode restore \
  --container sqms-unified-test-mysql-1 --project sqms-unified-test \
  --database sqms_unified_restore_test --directory /private/release-drill/sql
S3_ENDPOINT=http://127.0.0.1:19000 node --env-file=/private/rehearsal.env tools/backup/objects.cjs \
  --mode restore --bucket sqms-test-files --directory /private/release-drill/objects
```

Create the parent private directory first. Archive directories must be new; restore destinations must be different and empty. These tools never reset an existing database/bucket. The SQL tool verifies container project/service identity, backup checksum and every restored table count. The object tool validates all archive bytes before restore and verifies every restored hash. They are rehearsal helpers, not unattended production reset/deployment tools. For Render, the operator must use the confirmed private resources and appropriate protected backup credentials and demonstrate equivalent restore evidence.

The object example uses a second empty local MinIO service on port 19000 and preserves the bucket name, so restored `FileObject.bucket` metadata remains accurate. Configure the restored application to use that endpoint. A different bucket name requires an explicitly reviewed metadata/configuration mapping. Recreate the database users and schema-scoped grants before exercising the restored application: DML-only application, DDL/trigger-capable migrator and read-only reporter. Preserve or deliberately recreate trigger definers; a restored trigger whose definer lacks privileges can block normal writes. The local drill reapplied the named migrator/application grants before checking the audit and released-plan triggers.

## Final source freeze, refresh and acceptance

1. Approve a release window and communicate it through PDI's normal channels. Finish active inspections/test entries or explicitly hand them off. Stop source writes/uploads and any operational sync/export jobs. Record the freeze boundary, highest source IDs/timestamps and integration watermarks. Preserve an immediately usable source backup and matching files.
2. Obtain the final immutable export and intake. Record differences from prior rehearsals: changed/new/absent records, user/password/role changes, templates/specifications, all repairs and newly added files. The importer does not propagate source deletions; explicitly reconcile absence against available backups and reviewed archive decisions.
3. Build a clean release dataset from that final copy and the reviewed master/alias/identity/timezone/feature-classification package. Exclude fictional demo/test records and resolve every test-edit conflict. If a prior target is retained, inventory and approve every retained edit; do not blindly overwrite native accounts, changed passwords, roles or manually corrected records. Preserve original text, JSON, numbering and legacy exceptions.
4. Import, scan, validate and repeat import to verify idempotence. Compare every field-level/relationship/checksum/file check, record totals by period/status/group, closed NCRs, repair history and samples of all operational report types. Capture exact duration and evidence. Restore the validated dataset into the confirmed isolated Render candidate and repeat persistence/access/browser acceptance.
5. Take the final target baseline backup, verify restore, and keep deliveries/portal/bench disabled until their release configuration is separately verified. Pre-provision users and verify local login/role assignment. Review new-account password handoff/reset and disabled/stale accounts; no automatic invitation blast.
6. Quality/operations sign the go/no-go record against the actual dataset and implementation SHA. Only then may the separately authorized release operator change the operational URL/user routing and enable approved integrations. Record the moment the target becomes the sole writer. After successful release, preserve the old QMS/database/files as a read-only historical reference; do not retire it before complete-replacement acceptance.

## Rollback before target business writes

If the target has accepted no new business writes, stop target access/dispatch, preserve its logs and dataset, verify the source freeze snapshot is intact, and have the release decision maker authorize restoring the source as sole writer. Reconcile any source job/export watermarks before restarting them. Record why the target was rejected. Keep the candidate and evidence for repair; do not destroy it as part of rollback.

## Rollback after target business writes

Simply reopening the old QMS for writing is insufficient and can lose inspections, repair attempts and approval decisions.

1. Freeze target writes and pause dispatch immediately. Take and verify a new full target database/object backup **including all records since the cutover baseline**, native audit/activity, versions, new files/hashes/associations, pending/sent email/outbox delivery state and integration watermarks. Preserve an accessible read-only target/recovery copy.
2. Derive a post-cutover delta by comparing the baseline backup with the frozen target, using IDs plus versions/audit times and new object keys; include updates to pre-existing records, not only newly created IDs. Reconcile file bytes and links. Record the exact target cutoff and highest committed events.
3. Quality and operational owners classify the delta. Incoming/NCR/injector/repair records that can be represented in the old app require a controlled, reviewed transfer or manual re-entry with source/target references and verification. SQMS-only qualification/approval/change/SCAR/feature decisions stay preserved in the read-only recovery system and a controlled business register; never silently discard them or invent equivalent legacy states. Record open work and assignments.
4. Choose either forward recovery on SQMS or an explicitly reconciled return to the source. The rollback decision maker approves the handling of every post-cutover record and every external delivery before source writes resume. Maintain a controlled backlog for any items not yet transferred; operational users must have access to their evidence and a single documented writer for each pending action.
5. Reconcile sent versus pending external work before re-enabling jobs. Do not blindly replay emails/webhooks/sheet days. Record duplicate-delivery risks and approved handling. Keep frozen target backups, read-only history and mapping evidence under the retention policy.
6. Drill this procedure on a copied dataset with representative target-only inspection, file, repair and approval changes. Record completeness and recovery time. Production rollback is not accepted until the named owners have exercised this post-write case.

No long-lived dual write or production synchronization bridge is introduced. Source and target write boundaries must remain explicit throughout release and rollback.
