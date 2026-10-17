# Render evaluation deployment: prepared procedure

**Status: not deployed or verified in this session.** The user has not identified the SQMS Render service; no Render control-plane tool/credentials are available. Repository service names alone do not establish a live resource's identity. The operational QMS deployment must not be changed.

## Identify the authorized test environment

In the Render dashboard, locate the project deploying **A-PDI/SQMS**, inspect each service's repository/branch, gateway URL, service ID (`srv-...`), region, deploy SHA and environment groups. Record the gateway, web, API, worker, MySQL, Redis/Key Value, MinIO, ClamAV and Mailpit IDs in the acceptance record. Confirm this is the test UI installation with no operational users, not A-PDI/QMS-Development. Export its configuration metadata and take database/object backups before updating; preserve unrelated tester data. Do not print secret values.

Use the implementation branch/SHA after review. `render.yaml` retains the previously reviewed private-service blueprint and durable MySQL/MinIO disks; it explicitly defaults the portal, CarbonZapp and injector sheet delivery off. The gateway is public; database, API, web, Redis, object storage and scanner remain private. Do not synchronize a blueprint blindly into an existing deployment: confirm service associations, existing database/bucket identity and disk mounts first.

## Configure and build

- Apply the same approved schema migrations and reference seed using the migrator account. Do not give the runtime application DDL privileges. Existing customized roles/settings are preserved; explicitly review module grants and PDI branding.
- Set `NODE_ENV=production`, secure cookies, exact web origins/base URL, trusted gateway/proxy and distinct test secrets. Keep `SUPPLIER_PORTAL_ENABLED=false`, `CARBONZAPP_MODE=disabled`, `INJECTOR_SHEET_MODE=disabled`; clear webhook URLs and production integration credentials.
- Route test mail only to private Mailpit or set `MAIL_TRANSPORT=disabled`. Neither supplier/customer addresses nor operational SMTP credentials belong in acceptance configuration.
- Use MySQL 8.4, dedicated Redis, private managed object storage, ClamAV and persistent disks. Confirm S3 bucket policy, scanner connectivity, object hashes and request/file size limits. No ephemeral local uploads.
- Build API/worker/web from the root Dockerfile. The production dependency stage now includes the legacy-domain runtime, plan JSON, PDI assets and ported calculations/renderers. Runtime does not contain the old database/application or source copies.
- The host production builds pass locally. A full clean Docker image build remains unverified: this 32 GiB workspace ran out of disk while preparing the dependency layer. Run the image builds on a host with sufficient free disk before deployment. Behind an environment proxy, the build supports `--build-arg NODE_USE_ENV_PROXY=1` and the existing `build_ca` secret; keep TLS verification enabled.
- Restore the reconciled isolated dataset/objects into the identified test resources, or run a reviewed local tunnel rehearsal against an explicitly disposable `_test` target. The migration CLI refuses unknown remote/production endpoints. Never relax its isolation checks to reach an unverified service.

## Acceptance and persistence

Verify gateway/API health, session/CSRF, all internal navigation and backend permission denials. Execute the matrix with a test inspector, Quality Manager, Engineering and Test Lab user. Exercise standard/custom/miscellaneous inspection, assignment, row/item evidence, completion/alert/reopen, NCR photos/captions/PDF, FAI-recurrence scenario, repair history, recorded sync/dedup, all report downloads, drawing lookup, notifications/tasks and saved reports. Portal routes/logins/files must remain inaccessible to supplier users. Inspect the worker outbox, email and scan queues for pending/failed work.

Create a uniquely labeled test record and scanned attachment, restart/redeploy web/API/worker, then verify the record, file bytes and hash. Restart MySQL and object storage separately and repeat read verification. Confirm durable mounts survive redeploys; do not delete disks. Back up both database and file bucket, restore into separate disposable test resources, compare counts and all object hashes, verify audit triggers and representative file downloads/PDFs. Record service IDs, deploy SHA, test identity/time, expected/actual results and restore resource IDs. A local Docker restore is supporting evidence, not proof of Render persistence.

Keep the deployment isolated and the old QMS as sole operational writer. Record failures and re-run the relevant acceptance checks. Production cutover is a separate decision using the cutover package; this document does not switch users, enable integrations, merge the branch or retire the old app.
