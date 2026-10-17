# Supplier Quality Management System (SQMS)

The shared interface combines [SQMS navigation with the QMS-Development theme](docs/unified-qms/navigation-theme.md). Existing operational workflow pages follow the [QMS-Development reference port](docs/unified-qms/source-parity.md) and remain checksum-verified during the web build.

The [engineering workspace](docs/unified-qms/engineering-workspace.md) defines the compact control scale, responsive tables and PDI color accents used by the current interface.

The unified internal PDI QMS candidate adds incoming inspections, connected NCR/recurrence workflows, injector testing and repairs, drawings, reporting and repeatable legacy migration. Start with the [implementation and acceptance package](docs/unified-qms/README.md) for the feature matrix, validation evidence, administrator guidance and prepared cutover/rollback procedures. Operational cutover and confirmed Render acceptance remain separate release gates.

SQMS manages how a heavy-duty diesel engine component business sources, qualifies, approves and controls products
from external suppliers. It keeps one controlled record of suppliers, products and their exact configurations,
generates the document checklist each sourcing project needs, drives reviews and approvals, and controls supplier
changes, nonconformances and corrective actions - with an append-only audit trail throughout.

Phase 1 (this release) is an internal application. The Phase 2 supplier portal - supplier accounts, roles,
supplier-scoped data access and APIs - is built and tested but switched off by the `SUPPLIER_PORTAL_ENABLED` flag.

## Capabilities

* **Sourcing pathways** A (company design, optional reverse engineering), B (supplier standard product) and C
  (supplier product plus a supplier-acknowledged delta specification) through a nine-step wizard with a versioned
  risk model.
* **Risk-based document checklists** generated from versioned applicability policies (REQUIRED / CONDITIONAL / not
  applicable, each with its reason); waivers need a justification and the right authority.
* **Document control** over a 37-type library with owners, approvers, retention policies, controlled templates and
  native web forms; review, release, revision, supersession and obsolescence without overwriting history; content
  hashes and supplier acknowledgments.
* **Products and configurations**: internal parts, supplier parts and sources (part + supplier part + site),
  revisioned configurations with engineering baselines, delta requirements and critical characteristics.
  Supplier approval and product approval are separate.
* **Qualification and approval** of an exact configuration revision and site: tests, first article inspections,
  inspection results, an approval gate that cannot be bypassed, and a frozen approval package with integrity check.
* **Supplier change control**: proposed configurations kept apart from the authorized one, impact assessments,
  requalification, conditional approval, implementation verification before shipment, preserved history.
* **Quality**: NCRs with containment and disposition, deviations and concessions, SCARs with 8D responses,
  four-eyes review, effectiveness verification and escalation.
* **Workflow and collaboration**: configurable, versioned approval workflows; approvals inbox; tasks with
  reminders; comments (internal vs supplier-visible); notifications by email and in the app; saved views.
* **Insights**: dashboard, reports with CSV export, global search.
* **Administration**: users and invitations, roles and permissions, settings and branding, numbering, file types,
  retention, workflows and applicability policies.
* **Security**: Argon2id, server-side sessions, CSRF protection, rate limiting and lockout, server-enforced supplier
  isolation, malware scanning with quarantine, private object storage, least-privilege database accounts.

## Quick start (Docker)

```bash
cp .env.compose.example .env.compose     # replace every change-me value
docker compose --env-file .env.compose up -d --build
# open http://localhost:8080 and sign in with SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
```

Optional fictional demo data for evaluation (set `DEMO_USER_PASSWORD` first):
`docker compose --env-file .env.compose --profile demo run --rm seed-demo`.
Mail sent by the system is visible in Mailpit at http://127.0.0.1:8025.

For development with hot reload see [docs/development.md](docs/development.md). A test environment on Render can be
created from `render.yaml` ([docs/deployment.md](docs/deployment.md#render-test-environment)).

## Technology

| Layer | Stack |
| --- | --- |
| Web | Next.js 16 (App Router), React 19, Tailwind CSS 4, Radix UI, TanStack Query, React Hook Form + Zod |
| API | NestJS 11, class-validator DTOs, OpenAPI (Swagger) |
| Data | MySQL 8.4 with Prisma 7 (MariaDB driver adapter) |
| Jobs | BullMQ on Redis 7 (scanning, email, reminders, escalation, outbox) |
| Files | S3-compatible object storage (MinIO locally), ClamAV |
| Delivery | Docker multi-stage images, Docker Compose, Caddy gateway |
| Tests | Vitest, Jest + Supertest, Playwright |

## Repository layout

```
apps/api        NestJS REST API, demo seed, integration tests
apps/worker     BullMQ background worker
apps/web        Next.js user interface
packages/shared enums, permissions, catalog, rule engine, risk model, forms, settings
packages/db     Prisma schema, migrations, reference seed
packages/server-core  configuration, storage, scanner, mail, queues
e2e             Playwright demo tests
infra           MySQL, MinIO, Caddy and migration job configuration
docs            documentation
```

## Documentation

| Topic | Document |
| --- | --- |
| Architecture and design decisions | [docs/architecture.md](docs/architecture.md) |
| Data model and ERD | [docs/data-model.md](docs/data-model.md) |
| Business processes | [docs/workflows.md](docs/workflows.md) |
| Local development | [docs/development.md](docs/development.md) |
| Configuration reference | [docs/configuration.md](docs/configuration.md) |
| REST API | [docs/api.md](docs/api.md), [docs/api/openapi.json](docs/api/openapi.json) |
| Security | [docs/security.md](docs/security.md) |
| Deployment | [docs/deployment.md](docs/deployment.md) |
| Backup and restore | [docs/backup-restore.md](docs/backup-restore.md) |
| Testing | [docs/testing.md](docs/testing.md) |

## Known limitations

* External supplier sign-in stays disabled until an MFA provider is integrated (`EXTERNAL_MFA_PROVIDER` currently
  supports `none` only); the production configuration enforces this.
* Sign-in uses local accounts; single sign-on (OIDC/SAML) is not implemented yet.
* Seven document types have native web forms (INT-01, INT-02, SUP-01, ENG-04, ENG-06, ENG-08, VAL-11); the others
  are submitted as uploaded documents. Controlled template files are uploaded by administrators.
* Integration adapters: a log adapter and an HMAC-signed webhook; ERP/accounting/BI connectors plug into the
  outbox adapter contract.
* Retention periods are intentionally left unset until records management defines them.
