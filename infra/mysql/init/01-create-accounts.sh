#!/bin/bash
# Sourced by the official MySQL image entrypoint on first initialization only.
# Creates the SQMS schema and least-privilege accounts:
#   * migrator - DDL for schema migrations (used by `prisma migrate deploy`, never by the running app)
#   * app      - DML only (SELECT/INSERT/UPDATE/DELETE); cannot create/drop tables or triggers
#   * reporter - read-only, for future BI / reporting connections
# The audit_events table is protected by triggers (created in migrations) that reject UPDATE and DELETE.
# Note: this file is sourced by the entrypoint, so do not enable `set -u` (it breaks entrypoint helpers).
set -eo pipefail

: "${SQMS_DB_NAME:=sqms}"
: "${SQMS_MIGRATOR_USER:?SQMS_MIGRATOR_USER is required}"
: "${SQMS_MIGRATOR_PASSWORD:?SQMS_MIGRATOR_PASSWORD is required}"
: "${SQMS_APP_USER:?SQMS_APP_USER is required}"
: "${SQMS_APP_PASSWORD:?SQMS_APP_PASSWORD is required}"
: "${SQMS_REPORTER_USER:=sqms_reporter}"
: "${SQMS_REPORTER_PASSWORD:?SQMS_REPORTER_PASSWORD is required}"
: "${SQMS_CREATE_DEV_DATABASES:=false}"

databases=("${SQMS_DB_NAME}")
if [ "${SQMS_CREATE_DEV_DATABASES}" = "true" ]; then
  databases+=("${SQMS_DB_NAME}_shadow" "${SQMS_DB_NAME}_test")
fi

sql="CREATE USER IF NOT EXISTS '${SQMS_MIGRATOR_USER}'@'%' IDENTIFIED BY '${SQMS_MIGRATOR_PASSWORD}';
CREATE USER IF NOT EXISTS '${SQMS_APP_USER}'@'%' IDENTIFIED BY '${SQMS_APP_PASSWORD}';
CREATE USER IF NOT EXISTS '${SQMS_REPORTER_USER}'@'%' IDENTIFIED BY '${SQMS_REPORTER_PASSWORD}';"

for db in "${databases[@]}"; do
  sql+="
CREATE DATABASE IF NOT EXISTS \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON \`${db}\`.* TO '${SQMS_MIGRATOR_USER}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`${db}\`.* TO '${SQMS_APP_USER}'@'%';
GRANT SELECT ON \`${db}\`.* TO '${SQMS_REPORTER_USER}'@'%';"
done

sql+="
FLUSH PRIVILEGES;"

docker_process_sql --database=mysql <<<"${sql}"
echo "SQMS: created databases (${databases[*]}) and least-privilege accounts."
