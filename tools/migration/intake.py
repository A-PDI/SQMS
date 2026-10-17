#!/usr/bin/env python3
"""Read a consistent standalone SQLite BACKUP COPY without importing the old application's code.

The private intake JSON contains account password hashes. Store it with the backup, never commit it.
The printed profile contains counts, schema names and reconciliation identifiers; it contains no credential hashes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import time
from collections import Counter

TABLES = [
    "users", "inspection_templates", "part_specs", "inspections", "inspection_notes",
    "inspection_activity_log", "inspection_attachments", "ncrs", "ncr_sections", "ncr_images",
    "engineering_drawings", "quality_alerts", "saved_reports", "injector_test_reports",
    "injector_repair_cases", "injector_repair_attempts", "injector_repair_changes",
    "injector_repair_result_deltas",
]
# Never import generic app_settings. Bench keys, cloud credentials and delivery settings are intentionally excluded.


def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Exclusive creation prevents accidentally overwriting an immutable intake baseline.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as out:
        json.dump(value, out, ensure_ascii=False, indent=2)
        out.write("\n")


def intake(source, attachment_root, path_map, dataset, timezone):
    start = time.monotonic()
    source = source.resolve(strict=True)
    if not source.is_file():
        raise ValueError("The source must be a standalone SQLite backup file")
    for suffix in ("-wal", "-journal"):
        sidecar = Path(str(source) + suffix)
        if sidecar.exists() and sidecar.stat().st_size:
            raise ValueError("Source has a WAL/journal: create a consistent standalone backup with sqlite3.Connection.backup first")
    before = sha(source)
    db = sqlite3.connect(source.as_uri() + "?mode=ro&immutable=1", uri=True)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA query_only=ON")
        if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("SQLite integrity check failed")
        available = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        tables = {name: [dict(r) for r in db.execute('SELECT * FROM "' + name + '"')] for name in TABLES if name in available}
        # A settings value must never be retained through a different table's password/token columns.
        for name, rows in tables.items():
            for row in rows:
                for key in list(row):
                    if key != "password_hash" or name != "users":
                        if any(word in key.lower() for word in ("password", "token", "secret", "api_key")):
                            row.pop(key)
        files = []
        root = attachment_root.resolve(strict=True) if attachment_root else None
        for entity in ("inspection_attachments", "ncr_images", "engineering_drawings"):
            for row in tables.get(entity, []):
                identity = str(row["id"])
                # Explicit mappings handle absolute Windows paths. Never trust source file_path as a local path.
                relative = path_map.get(entity + ":" + identity)
                if relative is None:
                    files.append({"entity": entity, "sourceId": identity, "status": "UNRESOLVED", "reason": "No reviewed relative attachment path"})
                    continue
                if root is None:
                    raise ValueError("An attachment root is required for mapped files")
                candidate = (root / relative).resolve(strict=True)
                if not candidate.is_relative_to(root) or not candidate.is_file():
                    raise ValueError("Attachment mapping escapes the copied attachment root")
                files.append({"entity": entity, "sourceId": identity, "status": "READY", "relativePath": str(candidate.relative_to(root)), "sizeBytes": candidate.stat().st_size, "sha256": sha(candidate)})
        foreign_keys = [list(row) for row in db.execute("PRAGMA foreign_key_check")]
        grouped = {}
        for name, rows in tables.items():
            grouped[name] = {
                "byPeriod": dict(sorted(Counter(str(r.get("created_at") or r.get("test_datetime") or r.get("opened_at") or "UNKNOWN")[:7] for r in rows).items())),
                "byStatus": dict(sorted(Counter(str(r.get("status") or r.get("result_status") or r.get("role") or "UNKNOWN") for r in rows).items())),
                "bySourceGroup": dict(sorted(Counter(str(r.get("form_no") or r.get("component_type") or r.get("template_id") or "UNSPECIFIED") for r in rows).items())),
            }
        profile = {"datasetId": dataset, "label": "Copied data; operational provenance must be supplied by the operator", "sourceSha256": before,
                   "counts": {k: len(v) for k, v in tables.items()}, "groups": grouped, "absentTables": sorted(set(TABLES) - available),
                   "supplierStrings": sorted({str(r["supplier"]) for rows in tables.values() for r in rows if r.get("supplier")}),
                   "partStrings": sorted({str(r["part_number"]) for rows in tables.values() for r in rows if r.get("part_number")}),
                   "unhandledTables": sorted(available - set(TABLES) - {"schema_migrations", "sqlite_sequence", "app_settings"}),
                   "excludedSettings": "All application settings, sessions, tokens and production integration credentials",
                   "foreignKeyIssues": foreign_keys, "fileCounts": {s: sum(f["status"] == s for f in files) for s in ("READY", "UNRESOLVED")},
                   "sourceTimezone": timezone or "UNKNOWN", "durationSeconds": round(time.monotonic() - start, 3)}
    finally:
        db.close()
    if sha(source) != before:
        raise ValueError("Source changed during intake; discard this result and obtain a consistent backup")
    return {"formatVersion": 1, "datasetId": dataset, "sourceSha256": before, "sourceTimezone": timezone or None,
            "profile": profile, "tables": tables, "files": files}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source-copy", type=Path, required=True)
    p.add_argument("--attachment-copy", type=Path)
    p.add_argument("--path-map", type=Path, help="JSON object: table:sourceId -> path relative to the copied attachment root")
    p.add_argument("--dataset", required=True)
    p.add_argument("--source-timezone", help="Known IANA zone; omit when historical timestamps are uncertain")
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    if args.source_timezone:
        from zoneinfo import ZoneInfo
        ZoneInfo(args.source_timezone)
    result = intake(args.source_copy, args.attachment_copy, json.loads(args.path_map.read_text()) if args.path_map else {}, args.dataset, args.source_timezone)
    atomic_json(args.output, result)
    print(json.dumps(result["profile"], indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, sqlite3.Error) as error:
        print("Intake refused: " + str(error), file=sys.stderr)
        sys.exit(1)
