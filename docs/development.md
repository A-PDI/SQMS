# Local development

## Prerequisites

* Node.js 22.12 or later and pnpm 10.28 (`corepack enable` activates the version pinned in `package.json`)
* Docker with Compose v2 (for MySQL, Redis, MinIO, ClamAV and Mailpit)

## First run

```bash
corepack enable
pnpm install
cp .env.example .env                       # local-only defaults; set SEED_ADMIN_* and DEMO_USER_PASSWORD
docker compose -f compose.dev.yaml up -d   # first start builds MinIO from source and downloads ClamAV signatures
pnpm build:packages                        # shared, db (generates the Prisma client), server-core
pnpm db:migrate                            # applies migrations with MIGRATION_DATABASE_URL
pnpm db:seed                               # reference data (+ first administrator when SEED_ADMIN_* are set)
```

Then start the three processes in separate terminals:

```bash
pnpm dev:api      # http://localhost:4000/api/v1, Swagger at /api/docs
pnpm dev:worker   # scanning, email, reminders, outbox
pnpm dev:web      # http://localhost:3000 (proxies /api/* to the API)
```

Optional fictional demo data (needs the worker running, because uploaded evidence must pass malware scanning;
refused when `NODE_ENV=production`):

```bash
pnpm db:seed:demo
```

Mail sent by the system appears in Mailpit at http://localhost:8025. The MinIO console is at
http://localhost:9001 (credentials from `compose.dev.yaml`).

## Demo data

`pnpm db:seed:demo` creates fictional suppliers (Apex Turbo Systems Inc., Nordic Castings AB, Delta Precision
Machining), an approved Pathway C turbocharger with a coated turbine housing and an open change request, a
Pathway A project in progress, a Pathway B project awaiting intake review, an NCR closed under concession and an
NCR with an issued SCAR. Users (`@demo.sqms.example`, password = `DEMO_USER_PASSWORD`):

| User | Role |
| --- | --- |
| admin | System administrator |
| sam.rivera | Sourcing |
| erin.cho, devon.hart | Engineering |
| quinn.patel, jordan.moore | Supplier Quality |
| morgan.lee | Approver (management) |
| riley.ng | Read only |

## Useful commands

| Command | Purpose |
| --- | --- |
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm test` | Unit and API integration tests (see [testing](testing.md)) |
| `pnpm test:e2e` | Playwright demos against a running stack |
| `pnpm db:migrate:dev` | Create a new migration after editing `packages/db/prisma/schema` (uses `SHADOW_DATABASE_URL`) |
| `pnpm --filter @sqms/api run openapi:export ../../docs/api/openapi.json` | Refresh the OpenAPI document |
| `pnpm build` | Production build of every package and app |

## Conventions

* Business rules live in API services, never in the UI; the UI hides actions the user cannot perform, but the
  server enforces every permission, scope and state transition.
* Shared enums, permissions, rules and form schemas belong in `packages/shared` so the API, worker and UI agree.
  An integration test fails if a shared enum and the Prisma enum diverge.
* Every state change writes an audit event in the same transaction; user-visible history uses activity events.
* New list endpoints follow the pagination/sort/filter conventions in `apps/api/src/common/http/pagination.ts`.
