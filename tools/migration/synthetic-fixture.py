#!/usr/bin/env python3
"""Generate clearly synthetic migration copies for CI without access to either operational application."""
import argparse
import base64
import importlib.util
import json
from pathlib import Path
import sqlite3


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", type=Path, required=True)
    root = parser.parse_args().output_root.resolve()
    root.mkdir(parents=True, exist_ok=False, mode=0o700)
    (root / "uploads").mkdir(mode=0o700)
    source = root / "inspection-copy.db"
    db = sqlite3.connect(source)
    db.executescript("""
      CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,email TEXT,role TEXT,active INTEGER,password_hash TEXT,created_at TEXT);
      CREATE TABLE inspection_templates(id TEXT PRIMARY KEY,component_type TEXT,form_no TEXT,title TEXT,form_type TEXT,header_schema TEXT,sections TEXT);
      CREATE TABLE inspections(id TEXT PRIMARY KEY,template_id TEXT,part_number TEXT,supplier TEXT,po_number TEXT,date_received TEXT,status TEXT,disposition TEXT,created_by TEXT,created_at TEXT,section_data TEXT);
      CREATE TABLE inspection_activity_log(id TEXT PRIMARY KEY,inspection_id TEXT,action_type TEXT,actor_id TEXT,actor_name TEXT,created_at TEXT);
      CREATE TABLE inspection_attachments(id TEXT PRIMARY KEY,inspection_id TEXT,file_name TEXT,file_path TEXT,mime_type TEXT,file_size_bytes INTEGER);
    """)
    db.execute("INSERT INTO users VALUES(?,?,?,?,?,?,?)", ("fixture-user", "Synthetic Quality Admin", "synthetic-qms@example.invalid", "admin", 1, None, "2026-01-01 10:00:00"))
    sections = json.dumps({"receiving": {"title": "Synthetic receiving", "section_type": "pfn_checklist", "items": [{"id": 1, "name": "Synthetic label check", "requirement": "Fixture only"}]}})
    for number in range(1, 14):
        db.execute("INSERT INTO inspection_templates VALUES(?,?,?,?,?,?,?)", (f"fixture-template-{number}", "synthetic", f"FIXTURE-{number:03}", f"Synthetic plan {number}", "iqi_standard", "[]", sections))
    for number in range(1, 4):
        identity = f"fixture-inspection-{number}"
        db.execute("INSERT INTO inspections VALUES(?,?,?,?,?,?,?,?,?,?,?)", (identity, "fixture-template-1", f"000-{number:03}", None, f"FIXTURE-PO-{number}", "2026-01-02", "complete", "PASS", "fixture-user", "2026-01-02 12:00:00", json.dumps({"receiving": [{"id": 1, "status": "P"}], "__disposition": "PASS"})))
        for event in range(6):
            db.execute("INSERT INTO inspection_activity_log VALUES(?,?,?,?,?,?)", (f"fixture-activity-{number}-{event}", identity, "fixture_history", "fixture-user", "Synthetic Quality Admin", "2026-01-02 12:00:00"))
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
    paths = {}
    for number in range(1, 3):
        filename = f"synthetic-photo-{number}.png"
        (root / "uploads" / filename).write_bytes(png)
        identity = f"fixture-attachment-{number}"
        paths["inspection_attachments:" + identity] = filename
        db.execute("INSERT INTO inspection_attachments VALUES(?,?,?,?,?,?)", (identity, f"fixture-inspection-{number}", filename, "/synthetic/uploads/" + filename, "image/png", len(png)))
    db.commit()
    db.close()
    spec = importlib.util.spec_from_file_location("intake", Path(__file__).with_name("intake.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    data = module.intake(source, root / "uploads", paths, "synthetic-ci-fixture", "UTC")
    data["profile"]["label"] = "Synthetic CI fixture; no operational data"
    module.atomic_json(root / "intake.json", data)
    module.atomic_json(root / "path-map.json", paths)
    print(json.dumps(data["profile"], indent=2))


if __name__ == "__main__":
    main()
