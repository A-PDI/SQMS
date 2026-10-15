#!/bin/sh
# Creates the private SQMS bucket (idempotent) and makes sure anonymous access is disabled.
# Files are only ever served through the API after authorization checks.
set -eu
: "${MINIO_URL:?MINIO_URL is required}"
: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required}"
export MC_CONFIG_DIR=/tmp/.mc

i=0
until mc alias set sqms "$MINIO_URL" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -ge 30 ] && { echo "[minio-init] MinIO not reachable at $MINIO_URL" >&2; exit 1; }
  sleep 2
done

mc mb --ignore-existing "sqms/${S3_BUCKET}"
mc anonymous set none "sqms/${S3_BUCKET}"

# Application credentials limited to the SQMS bucket (the root account is never given to the application).
policy_file=/tmp/sqms-app-policy.json
cat > "$policy_file" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:ListBucket", "s3:GetBucketLocation"], "Resource": ["arn:aws:s3:::${S3_BUCKET}"] },
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"], "Resource": ["arn:aws:s3:::${S3_BUCKET}/*"] }
  ]
}
JSON
mc admin policy create sqms sqms-app "$policy_file" >/dev/null 2>&1 || true
if ! mc admin user info sqms "$S3_ACCESS_KEY_ID" >/dev/null 2>&1; then
  mc admin user add sqms "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
fi
mc admin policy attach sqms sqms-app --user "$S3_ACCESS_KEY_ID" >/dev/null 2>&1 || true
echo "[minio-init] bucket ${S3_BUCKET} ready (private); application user ${S3_ACCESS_KEY_ID} restricted to it"
