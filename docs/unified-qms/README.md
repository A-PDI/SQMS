# Unified internal PDI QMS implementation

This candidate consolidates operational QMS capabilities into SQMS. The implementation branch is `codex/unified-qms`; its starting point is SQMS `bf9be7f`, including the four evaluation-deployment fixes absent from the historical `main` reference. Source-port evidence is QMS-Development `6c53d829a5e69ff095975cddc41d419c4b812ada`, inspected in a separate read-only source checkout. The original operational repository/runtime was not changed.

The implementation prompt is authoritative over the older assessment: local accounts remain the login, SSO is future work, the supplier portal stays disabled, and users move only after the complete replacement is accepted. The old QMS remains the only operational writer. No production cutover or Render update has been performed.

## Review package

- [Feature preservation matrix](feature-preservation.md): source evidence, target behavior, migration and validation.
- [Implementation and integrity rules](implementation.md): permissions, snapshots, origins, recurrence and durable work.
- [Migration rehearsal](migration.md): copied-source intake, reconciliation, account mapping, imports, repeat runs and refresh.
- [Acceptance evidence](validation.md): actual local checks and their limits.
- [Administrator and shop-floor guide](user-guide.md): plans, inspections, NCRs, injector testing and accounts.
- [Test deployment](render-test.md): Render identity/configuration verification, durable services and acceptance.
- [Cutover and rollback](cutover-rollback.md): prepared release procedure; not permission to execute it.
- [Remaining work and release blockers](remaining-work.md).

## Local development

Use Node >=22.12 and the pinned package manager, `corepack pnpm` (10.28.0). Install with the lockfile. Configure only isolated resources in `.env`; `compose.dev.yaml` provides MySQL, Redis, MinIO, ClamAV and Mailpit on loopback ports. Do not start the old QMS to obtain data: its startup mutates its database.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build:packages
corepack pnpm --filter @sqms/api --filter @sqms/worker build
corepack pnpm --filter @sqms/web build
```

Follow the existing root README for database users, migration and reference seed. New defaults are portal off, CarbonZapp disabled and sheet delivery disabled. `MAIL_TRANSPORT=disabled` disables deliveries; local Mailpit is also a valid test sink. Leave `OUTBOX_WEBHOOK_URL` and production integration credentials unset during acceptance.

The API tests require a dedicated database ending `_test` and truncate that database. Always pass both `TEST_DATABASE_URL` and `TEST_MIGRATION_DATABASE_URL` for the same explicitly disposable target. Do not aim these at a development database containing unrelated records. The migration CLI has stricter local target-manifest checks and never resets a database.
