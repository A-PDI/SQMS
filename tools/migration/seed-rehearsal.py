#!/usr/bin/env python3
"""Prepare a LABELED repository-seed fixture; never reads operational runtime data."""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import sqlite3


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--legacy-repository", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    args = parser.parse_args()
    source = (args.legacy_repository / "server/db/seed").resolve(strict=True)
    out = args.output_root.resolve()
    out.mkdir(parents=True, exist_ok=False, mode=0o700)
    copied_db = out / "inspection-copy.db"
    shutil.copy2(source / "inspection.db", copied_db)
    shutil.copytree(source / "uploads", out / "uploads")
    connection = sqlite3.connect(copied_db.as_uri() + "?mode=ro&immutable=1", uri=True)
    maps = {}
    for identity, raw in connection.execute("SELECT id, file_path FROM inspection_attachments"):
        portable = str(raw).replace("\\", "/")
        if "/uploads/" in portable:
            relative = portable.split("/uploads/", 1)[1]
        elif portable.startswith("uploads/"):
            relative = portable[len("uploads/"):]
        else:
            continue
        candidate = (out / "uploads" / relative).resolve()
        if candidate.is_relative_to(out / "uploads") and candidate.is_file():
            maps["inspection_attachments:" + identity] = relative
    connection.close()
    spec = importlib.util.spec_from_file_location("intake", Path(__file__).with_name("intake.py"))
    intake_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(intake_module)
    result = intake_module.intake(copied_db, out / "uploads", maps, "repository-seed-fixture", "UTC")
    result["profile"]["label"] = "Repository seed fixture only; not an operational export"
    intake_module.atomic_json(out / "intake.json", result)
    intake_module.atomic_json(out / "path-map.json", maps)
    print(json.dumps(result["profile"], indent=2))


if __name__ == "__main__":
    main()
