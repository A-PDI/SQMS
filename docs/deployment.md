# Deployment

## Images

`Dockerfile` (repository root) builds four targets from one cached build stage:

| Target | Image contents | Command |
| --- | --- | --- |
| `api` | Node 22 slim, production dependencies, compiled API | `node dist/main.js` (port 4000, health check on `/api/v1/health`) |
| `worker` | same base, compiled worker | `node dist/main.js` |
| `web` | Next.js standalone server and static assets | `node apps/web/server.js` (port 3000) |
| `migrate` | full build image with the Prisma CLI | applies migrations, then the idempotent reference seed |

`infra/minio/Dockerfile` builds MinIO and the MinIO client from source at pinned versions, because MinIO no longer
publishes community images. All images run as non-root users. Behind a TLS-inspecting proxy, pass the proxy root CA
as a build secret (`SQMS_BUILD_CA_FILE` in Compose, or `--secret id=build_ca,src=...`); it is not stored in any
image layer.

## Single host with Docker Compose

```bash
cp .env.compose.example .env.compose        # replace every change-me value; never commit this file
docker compose --env-file .env.compose up -d --build
```

Start-up order is enforced: MySQL (healthy) -> `migrate` job (migrations + reference seed + first administrator)
and `minio-init` (private bucket, bucket-scoped application account) -> API and worker -> gateway. Only the gateway
publishes a port; Mailpit's UI is bound to 127.0.0.1 for evaluation.

* **HTTPS**: set `SQMS_SITE_ADDRESS` to the public DNS name, `SQMS_PUBLIC_URL=https://<name>`, publish ports 80 and
  443 on the gateway instead of 8080, and Caddy obtains and renews certificates automatically. To terminate TLS on
  an existing load balancer instead, keep the gateway on HTTP inside the private network and forward
  `X-Forwarded-*` headers.
* **Mail**: point `SMTP_*` at your relay (TLS: `SMTP_SECURE=true` for implicit TLS on 465, or
  `SMTP_REQUIRE_TLS=true` for STARTTLS) and remove the Mailpit service.
* **Evaluation data**: `docker compose --env-file .env.compose --profile demo run --rm seed-demo` loads the fictional
  demo data (requires `DEMO_USER_PASSWORD`; never on a production database).

## Upgrades

1. Back up the database and bucket ([backup and restore](backup-restore.md)).
2. Pull the new release and rebuild: `docker compose --env-file .env.compose build`.
3. `docker compose --env-file .env.compose up -d` - the `migrate` job runs first; the API and worker only start after
   it completes successfully (on failure, inspect `docker compose --env-file .env.compose logs migrate`).

Migrations are forward-only and created with `prisma migrate dev`; never edit an applied migration.

## Managed services and scaling

| Component | Production option | Notes |
| --- | --- | --- |
| MySQL | MySQL 8.4 managed service | Create the three accounts from `infra/mysql/init/01-create-accounts.sh`; set `log_bin_trust_function_creators=1` (or run migrations with a privileged account) so the audit triggers can be created; time zone UTC |
| Redis | Managed Redis 7 | `maxmemory-policy noeviction` (BullMQ); enable AUTH and TLS (`rediss://`) |
| Object storage | S3 or any S3-compatible service | Private bucket, block public access, server-side encryption, versioning; credentials limited to the bucket |
| Malware scanning | ClamAV (`clamd`) | Needs about 1.5-2 GB RAM and outbound access for signature updates |
| API, web | Stateless, run 2+ instances | Sessions live in MySQL and the login limiter in Redis, so instances need no affinity; the general API rate limit is per instance |
| Worker | 1+ instances | Jobs are distributed by BullMQ; schedules are registered idempotently |

Health endpoints: `GET /api/v1/health` (liveness) and `GET /api/v1/health/ready` (database, Redis and storage).
Logs are JSON lines (`LOG_JSON=true`) with the request correlation id; ship them to your log platform.

## Kubernetes outline

Run `migrate` as a Job (or Helm pre-upgrade hook) before rolling out the API and worker Deployments; expose only the
web and API through the Ingress (`/api` -> API service, everything else -> web); keep MySQL, Redis, storage and
ClamAV on private networks; mount configuration from Secrets; use the readiness endpoint for the API probe.
