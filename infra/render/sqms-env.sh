#!/bin/sh
# Render Blueprints cannot combine several values into one setting, so the services receive connection details as
# separate variables (hosts from the private network, generated passwords) and this wrapper builds the URLs the
# application expects, then runs the given command. Variables that are already set are left unchanged.
#
#   SQMS_DB_HOST, SQMS_DB_PORT (3306), SQMS_DB_NAME (sqms)
#   SQMS_APP_USER (sqms_app), SQMS_APP_PASSWORD                -> DATABASE_URL
#   SQMS_MIGRATOR_USER (sqms_migrator), SQMS_MIGRATOR_PASSWORD -> MIGRATION_DATABASE_URL (only when the password is set)
#   SQMS_MINIO_HOST, SQMS_MINIO_PORT (9000)                    -> S3_ENDPOINT
#   SQMS_PUBLIC_URL                                            -> APP_ORIGINS, APP_BASE_URL
set -eu

if [ "$#" -eq 0 ]; then
  echo "usage: sqms-env <command> [args...]" >&2
  exit 64
fi

# Prints a mysql:// URL with percent-encoded credentials (generated passwords may contain / + =).
mysql_url() {
  node -e '
    const [user, password, host, port, db] = process.argv.slice(1);
    const e = encodeURIComponent;
    process.stdout.write(`mysql://${e(user)}:${e(password)}@${host}:${port}/${e(db)}`);
  ' "$1" "$2" "$3" "$4" "$5"
}

if [ -z "${DATABASE_URL:-}" ] && [ -n "${SQMS_DB_HOST:-}" ]; then
  : "${SQMS_APP_PASSWORD:?SQMS_APP_PASSWORD is required with SQMS_DB_HOST}"
  DATABASE_URL=$(mysql_url "${SQMS_APP_USER:-sqms_app}" "$SQMS_APP_PASSWORD" "$SQMS_DB_HOST" "${SQMS_DB_PORT:-3306}" "${SQMS_DB_NAME:-sqms}")
  export DATABASE_URL
fi

if [ -z "${MIGRATION_DATABASE_URL:-}" ] && [ -n "${SQMS_DB_HOST:-}" ] && [ -n "${SQMS_MIGRATOR_PASSWORD:-}" ]; then
  MIGRATION_DATABASE_URL=$(mysql_url "${SQMS_MIGRATOR_USER:-sqms_migrator}" "$SQMS_MIGRATOR_PASSWORD" "$SQMS_DB_HOST" "${SQMS_DB_PORT:-3306}" "${SQMS_DB_NAME:-sqms}")
  export MIGRATION_DATABASE_URL
fi

if [ -z "${S3_ENDPOINT:-}" ] && [ -n "${SQMS_MINIO_HOST:-}" ]; then
  S3_ENDPOINT="http://${SQMS_MINIO_HOST}:${SQMS_MINIO_PORT:-9000}"
  export S3_ENDPOINT
fi

if [ -n "${SQMS_PUBLIC_URL:-}" ]; then
  public_url=${SQMS_PUBLIC_URL%/}
  if [ -z "${APP_ORIGINS:-}" ]; then
    APP_ORIGINS=$public_url
    export APP_ORIGINS
  fi
  if [ -z "${APP_BASE_URL:-}" ]; then
    APP_BASE_URL=$public_url
    export APP_BASE_URL
  fi
fi

exec "$@"
