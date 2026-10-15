#!/bin/sh
# Single-container MinIO start for platforms without one-shot init jobs (the Render Blueprint, render.yaml).
# Runs as root only to prepare the persistent disk, starts MinIO as the unprivileged minio user, then provisions the
# private bucket and the bucket-scoped application account with sqms-init-bucket (idempotent) once MinIO answers.
set -eu

data_dir=${MINIO_DATA_DIR:-/data/minio}
mkdir -p "$data_dir"
chown minio:minio "$data_dir"

su minio -s /bin/sh -c 'exec minio server "$0" --address :9000' "$data_dir" &
minio_pid=$!
trap 'kill -TERM "$minio_pid" 2>/dev/null || true' TERM INT

if ! MINIO_URL=http://127.0.0.1:9000 sqms-init-bucket; then
  echo "[minio] bucket provisioning failed; stopping" >&2
  kill -TERM "$minio_pid" 2>/dev/null || true
  wait "$minio_pid" || true
  exit 1
fi

status=0
wait "$minio_pid" || status=$?
# A trapped signal interrupts the first wait; wait again until MinIO has finished shutting down.
if kill -0 "$minio_pid" 2>/dev/null; then
  status=0
  wait "$minio_pid" || status=$?
fi
exit "$status"
