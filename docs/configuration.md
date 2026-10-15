# Configuration

The API and worker read their configuration from environment variables, validated at start-up
(`packages/server-core/src/config.ts`). An invalid or unsafe configuration stops the process with a message naming
the offending variable. Local development reads `.env` (copy `.env.example`); containers receive variables from
the orchestrator or secrets manager. Secrets never belong in source control.

## API and worker

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` enables the safety checks below; `test` only for automated tests |
| `PORT` | `4000` | API listen port |
| `APP_ORIGINS` | (none) | Comma-separated browser origins allowed for unsafe requests. **Required in production.** |
| `APP_BASE_URL` | `http://localhost:3000` | Used for links in emails |
| `TRUST_PROXY` | `false` | `true` behind the gateway so client IPs come from `X-Forwarded-For` |
| `DATABASE_URL` | (required) | `mysql://user:password@host:3306/sqms` - application account (DML only) |
| `DATABASE_CONNECTION_LIMIT` | `10` | Pool size per process |
| `REDIS_URL` | `redis://127.0.0.1:6379` | BullMQ queues and the shared login limiter |
| `CSRF_SECRET` | (required) | At least 32 random characters; rotating it invalidates outstanding CSRF tokens |
| `COOKIE_SECURE` | `true` | Must be `true` in production; `false` only for plain-HTTP local development |
| `SESSION_COOKIE_NAME`, `CSRF_COOKIE_NAME` | `sqms_session`, `sqms_csrf` | |
| `SESSION_IDLE_MINUTES` / `SESSION_ABSOLUTE_HOURS` | `480` / `72` | Server-side session expiry |
| `LOGIN_MAX_FAILURES` / `LOGIN_LOCKOUT_MINUTES` | `5` / `15` | Account lockout |
| `LOGIN_RATE_LIMIT_PER_MINUTE` | `10` | Sign-in attempts per IP and per email |
| `API_RATE_LIMIT_PER_MINUTE` | `600` | Per API instance |
| `SUPPLIER_PORTAL_ENABLED` | `false` | Phase 1 keeps external sign-in and supplier endpoints off |
| `EXTERNAL_MFA_PROVIDER` | `none` | Production refuses `SUPPLIER_PORTAL_ENABLED=true` while this is `none` |
| `S3_ENDPOINT` | (AWS) | e.g. `http://minio:9000`; omit for AWS S3 |
| `S3_REGION` / `S3_BUCKET` | `us-east-1` / (required) | Private bucket |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | (required) | Bucket-scoped credentials, never the storage root account |
| `S3_FORCE_PATH_STYLE` | `true` | MinIO needs path-style addressing |
| `S3_AUTO_CREATE_BUCKET` | `false` | Development convenience only; rejected in production |
| `SCANNER_MODE` | `clamav` | `eicar-test` exists for automated tests and is rejected unless `NODE_ENV=test` |
| `CLAMAV_HOST` / `CLAMAV_PORT` / `CLAMAV_TIMEOUT_MS` | `127.0.0.1` / `3310` / `60000` | clamd TCP endpoint |
| `MAIL_TRANSPORT` | `smtp` | `disabled` records deliveries without sending |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_REQUIRE_TLS` | `127.0.0.1` / `1025` / `false` / `false` | Use your relay with TLS in production |
| `SMTP_USER` / `SMTP_PASSWORD` | (none) | |
| `MAIL_FROM` | `SQMS <no-reply@sqms.local>` | |
| `LOG_LEVEL` / `LOG_JSON` | `log` / `false` | JSON logs for aggregation |
| `SWAGGER_ENABLED` | `true` | Set `false` in production unless the docs are needed |
| `OUTBOX_WEBHOOK_URL` / `OUTBOX_WEBHOOK_SECRET` | (none) | Worker only: enables the HMAC-signed webhook integration adapter |

## Migrations and seeding

| Variable | Used by | Notes |
| --- | --- | --- |
| `MIGRATION_DATABASE_URL` | `prisma migrate deploy` | DDL-capable migration account; never given to the running application |
| `SHADOW_DATABASE_URL` | `prisma migrate dev` | Development only |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` | reference seed | Creates the first administrator when the email does not exist yet |
| `SEED_INTERNAL_ORG_NAME` | reference seed | Name of the internal organization |
| `DEMO_USER_PASSWORD` | demo seed | Required by the demo seed, which refuses `NODE_ENV=production` |

## Web application

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` / `HOSTNAME` | `3000` / `0.0.0.0` in the image | Next.js standalone server |
| `API_PROXY_URL` | `http://127.0.0.1:4000` in `next dev` | Development only; deployed environments route `/api/*` at the gateway |

## Compose stack (`.env.compose`)

`compose.yaml` maps these onto the variables above: `SQMS_PUBLIC_URL` (becomes `APP_ORIGINS` and `APP_BASE_URL`),
`SQMS_SITE_ADDRESS` and `SQMS_HTTP_PORT` (gateway), `MYSQL_ROOT_PASSWORD`, `SQMS_DB_NAME`, `SQMS_MIGRATOR_USER`,
`SQMS_MIGRATOR_PASSWORD`, `SQMS_APP_USER`, `SQMS_APP_PASSWORD`, `SQMS_REPORTER_PASSWORD`, `REDIS_PASSWORD`,
`MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `CSRF_SECRET`,
`SMTP_*`, `MAIL_FROM`, the session settings, `SEED_ADMIN_*`, `DEMO_USER_PASSWORD`, `MAILPIT_UI_PORT` and
`SQMS_BUILD_CA_FILE` (optional root CA for image builds behind a TLS-inspecting proxy).

## Runtime settings (Administration > Settings)

Stored in the database, validated by `packages/shared/src/settings.ts`, and audited when changed: `branding`,
`files.maxUploadMb`, `workflow.preventSelfApproval`, `qualification.workflowMatrix` (approval workflow by pathway and
risk), `scar.defaultResponseDays`, `scar.escalationDays`, `certifications.expiryAlertDays`,
`tasks.reminderLeadHours`. Numbering patterns, allowed file types, retention policies, workflows and applicability
policies are also managed in Administration.

## Tests

API integration tests use dedicated resources and can be redirected with `TEST_DATABASE_URL`,
`TEST_MIGRATION_DATABASE_URL` (database name must end in `_test`), `TEST_REDIS_URL`, `TEST_S3_ENDPOINT`,
`TEST_S3_ACCESS_KEY_ID`, `TEST_S3_SECRET_ACCESS_KEY`, `TEST_SCANNER_MODE`, `TEST_CLAMAV_HOST`, `TEST_SMTP_HOST`.
Playwright demos use `E2E_BASE_URL` and `DEMO_USER_PASSWORD`.
