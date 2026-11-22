"""Back up the entire Paper Desk MySQL database together with its credential encryption key."""
import argparse
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
import uuid


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def backup(database, defaults_file, key_file, output, mysqldump='mysqldump'):
    if not re.fullmatch(r'[A-Za-z0-9_]{1,64}', database):
        raise ValueError('Database name must contain 1-64 letters, digits or underscores.')
    defaults_file, key_file, output = (pathlib.Path(p).resolve() for p in (defaults_file, key_file, output))
    if not defaults_file.is_file() or not key_file.is_file():
        raise ValueError('The MySQL client options file and matching database.key must exist.')
    if os.name != 'nt' and defaults_file.stat().st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise ValueError('Protect the MySQL client options file with chmod 600 before backing up.')
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    archive_path = output / ('paper-desk-mysql-{}-{}-{}.tar.gz'.format(database, stamp, uuid.uuid4().hex[:8]))
    with tempfile.TemporaryDirectory(prefix='.mysql-backup-', dir=output) as temporary:
        stage = pathlib.Path(temporary)
        shutil.copyfile(key_file, stage / 'database.key')
        os.chmod(stage / 'database.key', 0o600)
        command = [str(mysqldump), '--defaults-file=' + str(defaults_file), '--single-transaction',
                   '--quick', '--hex-blob', '--no-tablespaces', '--set-gtid-purged=OFF',
                   '--default-character-set=utf8mb4', '--databases', database]
        with (stage / 'database.sql').open('wb') as sql:
            result = subprocess.run(command, stdout=sql, stderr=subprocess.PIPE)
        if result.returncode:
            # Client errors can quote sensitive options; never echo their raw stderr or configuration.
            raise RuntimeError('mysqldump failed (exit {}). Check the client options, database and permissions.'.format(result.returncode))
        if not (stage / 'database.sql').stat().st_size:
            raise RuntimeError('mysqldump produced an empty export; no backup was created.')
        manifest = {'format': 'paper-desk-mysql-backup-v1', 'createdAt': stamp, 'database': database,
                    'scope': 'all-accounts-and-workspaces',
                    'files': {name: {'sha256': sha256(stage / name), 'bytes': (stage / name).stat().st_size}
                              for name in ('database.sql', 'database.key')}}
        (stage / 'MANIFEST.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        staged_archive = stage / 'backup.tar.gz'
        with staged_archive.open('xb') as stream:
            os.chmod(staged_archive, 0o600)
            with tarfile.open(fileobj=stream, mode='w:gz') as archive:
                for name in ('database.sql', 'database.key', 'MANIFEST.json'):
                    path = stage / name
                    info = archive.gettarinfo(str(path), arcname=name)
                    info.uid = info.gid = 0
                    info.uname = info.gname = ''
                    info.mode = 0o600
                    with path.open('rb') as data:
                        archive.addfile(info, data)
        # Stage and publish on the same filesystem; a failed dump never becomes a usable-looking backup.
        os.replace(staged_archive, archive_path)
    return archive_path


def verify_backup(path):
    with tarfile.open(path, 'r:gz') as archive:
        members = archive.getmembers()
        if len(members) != 3 or {m.name for m in members} != {'database.sql', 'database.key', 'MANIFEST.json'} or any(not m.isfile() for m in members):
            raise ValueError('Unexpected backup entries; extraction is not safe.')
        with archive.extractfile('MANIFEST.json') as stream:
            manifest = json.load(stream)
        if not isinstance(manifest, dict) or manifest.get('format') != 'paper-desk-mysql-backup-v1' or not isinstance(manifest.get('files'), dict) or set(manifest['files']) != {'database.sql', 'database.key'}:
            raise ValueError('Unsupported or incomplete backup manifest.')
        for name in ('database.sql', 'database.key'):
            if not isinstance(manifest['files'][name], dict):
                raise ValueError('Invalid backup file metadata: ' + name)
            digest, size = hashlib.sha256(), 0
            with archive.extractfile(name) as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(chunk)
                    size += len(chunk)
            if digest.hexdigest() != manifest['files'][name].get('sha256') or size != manifest['files'][name].get('bytes'):
                raise ValueError('Backup checksum mismatch: ' + name)
        return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify', type=pathlib.Path, help='Verify an existing backup without extracting or restoring it.')
    parser.add_argument('--database')
    parser.add_argument('--defaults-file', type=pathlib.Path,
                        help='Private MySQL [client] options file; passwords are never command-line arguments.')
    parser.add_argument('--key-file', type=pathlib.Path)
    parser.add_argument('--output', type=pathlib.Path)
    parser.add_argument('--mysqldump', default='mysqldump', help='Path to a MySQL 8.0+ mysqldump executable.')
    args = parser.parse_args()
    if not args.verify and not all((args.database, args.defaults_file, args.key_file, args.output)):
        parser.error('--database, --defaults-file, --key-file and --output are required when creating a backup.')
    try:
        if args.verify:
            verify_backup(args.verify)
            print('Verified: ' + str(args.verify))
            return
        path = backup(args.database, args.defaults_file, args.key_file, args.output, args.mysqldump)
    except (OSError, ValueError, RuntimeError, tarfile.TarError) as error:
        parser.exit(1, 'Backup failed: {}\n'.format(error))
    print(path)


if __name__ == '__main__':
    main()
