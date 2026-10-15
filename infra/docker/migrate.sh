#!/bin/sh
# Applies database migrations (MIGRATION_DATABASE_URL, DDL-capable account) and the idempotent reference seed
# (DATABASE_URL, application account). Optionally loads fictional demo data when SQMS_SEED_DEMO=true; the demo
# seed itself refuses to run when NODE_ENV=production.
set -eu
: "${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL is required}"
: "${DATABASE_URL:?DATABASE_URL is required}"

cd /repo/packages/db
echo "[migrate] applying migrations"
./node_modules/.bin/prisma migrate deploy

echo "[migrate] reference data"
node dist/seed/run.js reference

if [ "${SQMS_SEED_DEMO:-false}" = "true" ]; then
  echo "[migrate] demo data (fictional; evaluation environments only)"
  cd /repo/apps/api
  node dist/seed-demo.js
fi
echo "[migrate] done"
