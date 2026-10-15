#!/bin/sh
# Applies database migrations (MIGRATION_DATABASE_URL, DDL-capable account) and the idempotent reference seed
# (DATABASE_URL, application account). Optionally loads fictional demo data when SQMS_SEED_DEMO=true; the demo
# seed itself refuses to run when NODE_ENV=production.
set -eu
: "${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL is required}"
: "${DATABASE_URL:?DATABASE_URL is required}"

# On a fresh deployment the database may still be initializing; wait until it accepts connections
# (SQMS_DB_WAIT_SECONDS, default 300) instead of failing the first deploy.
node -e '
  const net = require("node:net");
  const url = new URL(process.env.MIGRATION_DATABASE_URL);
  const deadline = Date.now() + Number(process.env.SQMS_DB_WAIT_SECONDS || 300) * 1000;
  (function attempt() {
    const socket = net.connect(Number(url.port || 3306), url.hostname);
    socket.setTimeout(5000);
    const retry = () => {
      socket.destroy();
      if (Date.now() > deadline) {
        console.error(`[migrate] database ${url.hostname}:${url.port || 3306} is not reachable`);
        process.exit(1);
      }
      setTimeout(attempt, 3000);
    };
    socket.once("connect", () => { socket.destroy(); process.exit(0); });
    socket.once("timeout", retry);
    socket.once("error", retry);
  })();
'

cd "${SQMS_DB_PACKAGE_DIR:-/repo/packages/db}"
echo "[migrate] applying migrations"
./node_modules/.bin/prisma migrate deploy

echo "[migrate] reference data"
node dist/seed/run.js reference

if [ "${SQMS_SEED_DEMO:-false}" = "true" ]; then
  echo "[migrate] demo data (fictional; evaluation environments only)"
  cd "${SQMS_API_DIR:-/repo/apps/api}"
  node dist/seed-demo.js
fi
echo "[migrate] done"
