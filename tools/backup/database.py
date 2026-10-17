#!/usr/bin/env python3
"""Back up / restore an explicitly disposable local Compose MySQL dataset. Never drops an existing database."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


def digest(file):
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['backup', 'restore'], required=True)
    parser.add_argument('--container', required=True)
    parser.add_argument('--project', required=True)
    parser.add_argument('--database', required=True)
    parser.add_argument('--directory', type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z][a-z0-9_]*_(test|migration)', args.database):
        raise ValueError('Use an explicitly named disposable _test or _migration database')
    info = json.loads(subprocess.check_output(['docker', 'inspect', args.container]))[0]
    labels = info.get('Config', {}).get('Labels', {})
    if labels.get('com.docker.compose.project') != args.project or labels.get('com.docker.compose.service') != 'mysql':
        raise ValueError('Container is not the named local Compose MySQL service')

    def mysql(database, sql):
        command = ['docker', 'exec', '-i', args.container, 'sh', '-c', 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --batch --skip-column-names "$1"', 'mysql', database]
        return subprocess.run(command, input=sql, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout

    def counts(database):
        names = mysql(database, b'SHOW TABLES;').decode().splitlines()
        if any(not re.fullmatch(r'[a-z0-9_]+', table) for table in names):
            raise ValueError('Unexpected table name')
        return {table: int(mysql(database, ('SELECT COUNT(*) FROM `' + table + '`;').encode()).decode().strip()) for table in names}

    sql_file = args.directory / 'database.sql'
    manifest_file = args.directory / 'database.json'
    if args.mode == 'backup':
        args.directory.mkdir(mode=0o700)  # No overwrite of a previous archive.
        before = counts(args.database)
        descriptor = os.open(sql_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'wb') as out:
            subprocess.run(['docker', 'exec', args.container, 'sh', '-c', 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --no-tablespaces --set-gtid-purged=OFF --routines --triggers --events "$1"', 'mysqldump', args.database], stdout=out, stderr=subprocess.PIPE, check=True)
        after = counts(args.database)
        if before != after:
            raise ValueError('Target changed during backup; stop target writes and create another archive')
        manifest = {'formatVersion': 1, 'database': args.database, 'sha256': digest(sql_file), 'tableCounts': before}
        descriptor = os.open(manifest_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as out:
            json.dump(manifest, out, indent=2)
        print(json.dumps({'mode': 'backup', 'database': args.database, 'tables': len(before), 'rows': sum(before.values()), 'hashRecorded': True}))
    else:
        manifest = json.loads(manifest_file.read_text())
        if manifest['formatVersion'] != 1 or manifest['database'] == args.database or digest(sql_file) != manifest['sha256']:
            raise ValueError('Restore needs an intact backup and a different new test database')
        content = sql_file.read_bytes()
        if re.search(rb'(?im)^\s*(USE\s|(?:CREATE|DROP)\s+DATABASE\s)', content):
            raise ValueError('Archive may not switch databases; use the generated single-database backup')
        mysql('mysql', ('CREATE DATABASE `' + args.database + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;').encode())
        mysql(args.database, content)
        actual = counts(args.database)
        if actual != manifest['tableCounts']:
            raise ValueError('Restored table counts differ; preserve the target for investigation')
        print(json.dumps({'mode': 'restore', 'database': args.database, 'tables': len(actual), 'rows': sum(actual.values()), 'countsVerified': True}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Backup/restore refused or failed (' + type(error).__name__ + '). No existing database was reset; inspect the private archive and named local target.')
        raise SystemExit(1)
