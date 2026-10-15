# Backup and restore

SQMS keeps state in two places that must be backed up together: the MySQL database (all records, the audit trail
and file metadata with SHA-256 hashes) and the object-storage bucket (file contents). Redis only holds queues
that are rebuilt from the database (pending scans, deliveries and outbox events are re-queued by the worker's sweep
jobs), so it does not need backups. Back up the database first and the bucket immediately after: every object
referenced by the database dump is then present in the bucket copy.

Retention of backups follows your organization's records policy; the system does not prescribe one.

## Database

The dump must include triggers: they enforce the append-only audit trail.

```bash
# Compose deployment (run from the repository directory)
docker compose --env-file .env.compose exec -T mysql sh -c \
  'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --events --set-gtid-purged=OFF --databases sqms' \
  | gzip > "backups/sqms-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
```

`--single-transaction` gives a consistent InnoDB snapshot without locking the application. For managed MySQL
(e.g. RDS, Cloud SQL, Azure Database for MySQL) use the provider's automated backups with point-in-time recovery and
take periodic logical dumps as above for portability.

### Restore

1. Stop the application services so nothing writes during the restore:
   `docker compose --env-file .env.compose stop api worker web`
2. Load the dump (it recreates the `sqms` schema, data and triggers):

   ```bash
   gunzip -c backups/sqms-<timestamp>.sql.gz | docker compose --env-file .env.compose exec -T mysql \
     sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"'
   ```

3. Restore the matching bucket copy (below), then run the migration job so a dump from an older release is brought
   to the current schema: `docker compose --env-file .env.compose up migrate`
4. Start the services: `docker compose --env-file .env.compose up -d`

Restore into the same database name. The audit triggers run with the privileges of the migration account
(`DEFINER`), which only has rights on the configured database.

## Object storage

```bash
# Mirror the bucket to ./backups/files using the MinIO client in the stack's MinIO image
mkdir -p backups/files
docker compose --env-file .env.compose run --rm --no-deps --user root \
  -v "$PWD/backups/files:/backup" --entrypoint sh minio-init -c \
  'export MC_CONFIG_DIR=/tmp/.mc; mc alias set src http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc mirror --overwrite "src/$S3_BUCKET" /backup'
```

Restore by swapping source and target: `mc mirror --overwrite /backup "src/$S3_BUCKET"`. With AWS S3 or another
managed store, enable bucket versioning and replication or use the provider's backup service instead.

## Verification

Restore drills should be run regularly on a separate environment:

* compare row counts (`audit_events`, `document_revisions`, `file_objects`) with the source;
* confirm `SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = 'sqms'` lists
  `audit_events_block_update` and `audit_events_block_delete`;
* open an approved qualification: the approval package view re-checks the stored content hashes and reports
  whether integrity is verified;
* download a few files and compare their SHA-256 with `file_objects.sha256`.
