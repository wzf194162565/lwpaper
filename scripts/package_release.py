"""Build a clean Java 17 deployment bundle without local data or credentials."""
import argparse
import datetime as dt
import hashlib
import json
import pathlib
import shutil
import stat
import subprocess
import tarfile
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
WEB_FILES = ('index.html', 'app.js', 'business.js', 'files.js', 'ledger.js', 'styles.css', 'favicon.svg')
SQL_FILES = ('V001__initial_schema.sql', 'V002__customer_cooperation_date.sql', 'V003__paper_service_type.sql', 'V004__customer_payment_deposit.sql', 'V005__paper_files.sql', 'V006__follow_up_reason.sql', 'V007__customer_classification.sql', 'V008__service_termination.sql', 'V009__publication_fees.sql', 'V010__submission_costs_and_financial_audit.sql')


def copy_file(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


def write_text(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8', newline='\n')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'dist')
    args = parser.parse_args()
    output = args.output.resolve()
    if output != ROOT / 'dist':
        raise SystemExit('Release output must be the workspace dist directory.')
    output.mkdir(exist_ok=True)
    version = dt.datetime.now().strftime('%Y%m%d-%H%M%S')
    name = f'paper-desk-aliyun-{version}'
    drivers = sorted((ROOT / 'lib').glob('mysql-connector-j-*.jar'))
    if len(drivers) != 1:
        raise SystemExit('Place exactly one MySQL Connector/J JAR in lib/ before packaging.')
    if any((output / (name + suffix)).exists() for suffix in ('.zip', '.tar.gz')):
        raise SystemExit('A release with this timestamp already exists; retry in a second.')

    # Everything staged here comes from the explicit allowlist below; never copy data/ or real config.
    with tempfile.TemporaryDirectory(prefix='release-build-', dir=output) as temporary:
        work = pathlib.Path(temporary)
        classes = work / 'classes'
        classes.mkdir()
        release = work / name
        release.mkdir()
        sources = sorted((ROOT / 'src').glob('*.java'))
        subprocess.run(['javac', '-encoding', 'UTF-8', '--release', '17', '-d', str(classes),
                        *map(str, sources)], cwd=ROOT, check=True)
        manifest = work / 'MANIFEST.MF'
        write_text(manifest, f'Class-Path: lib/{drivers[0].name}\n')
        subprocess.run(['jar', '--create', '--file', str(release / 'paper-desk.jar'),
                        '--main-class', 'Main', '--manifest', str(manifest), '-C', str(classes), '.'],
                       cwd=ROOT, check=True)
        for filename in WEB_FILES:
            copy_file(ROOT / 'web' / filename, release / 'web' / filename)
        for filename in SQL_FILES:
            copy_file(ROOT / 'db/mysql' / filename, release / 'db/mysql' / filename)
        copy_file(drivers[0], release / 'lib' / drivers[0].name)
        for filename in ('start.sh', 'start.cmd', 'install.sh', 'DEPLOY.md'):
            copy_file(ROOT / 'deploy' / filename, release / filename)
        copy_file(ROOT / 'deploy/MYSQL-MIGRATION.md', release / 'MYSQL-MIGRATION.md')
        for filename in ('paper-desk.service', 'nginx.conf.example', 'mysql-init.sql.example', 'backup.cron.example', 'backup.sh'):
            copy_file(ROOT / 'deploy' / filename, release / 'deploy' / filename)
        copy_file(ROOT / 'scripts/backup_mysql.py', release / 'tools/backup_mysql.py')
        copy_file(ROOT / 'deploy/mysql-client.example.cnf', release / 'config/mysql-client.example.cnf')
        copy_file(ROOT / 'deploy/application.properties', release / 'config/application.properties')
        copy_file(ROOT / 'config/application.example.properties', release / 'config/application.mysql.example.properties')
        copy_file(ROOT / 'README.md', release / 'README.md')
        write_text(release / 'data/.keep', 'Runtime data is created here. Do not replace this directory on upgrades.\n')

        # Shell/systemd/Nginx templates must use LF even when built on Windows.
        for path in release.rglob('*'):
            if path.is_file() and path.suffix not in ('.jar',):
                write_text(path, path.read_text(encoding='utf-8'))
        payload = sorted(path for path in release.rglob('*') if path.is_file())
        metadata = {'version': version, 'javaRelease': 17, 'mainClass': 'Main',
                    'defaultStorage': 'file', 'jdbcDriver': drivers[0].name,
                    'files': {path.relative_to(release).as_posix(): digest(path) for path in payload}}
        write_text(release / 'RELEASE.json', json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
        payload.append(release / 'RELEASE.json')
        write_text(release / 'SHA256SUMS', ''.join(
            f'{digest(path)}  {path.relative_to(release).as_posix()}\n' for path in sorted(payload)))

        # Archive permissions are explicit so Linux scripts work after extraction from Windows builds.
        def tar_metadata(info):
            info.uid = info.gid = 0
            info.uname = info.gname = ''
            info.mode = 0o755 if info.isdir() or info.name.endswith('.sh') else 0o644
            return info

        archive_paths = [output / (name + '.tar.gz'), output / (name + '.zip')]
        with tarfile.open(archive_paths[0], 'w:gz') as archive:
            archive.add(release, arcname=name, filter=tar_metadata)
        with zipfile.ZipFile(archive_paths[1], 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(release.rglob('*')):
                if path.is_file():
                    info = zipfile.ZipInfo.from_file(path, arcname=f'{name}/{path.relative_to(release).as_posix()}')
                    info.create_system = 3
                    info.external_attr = (stat.S_IFREG | (0o755 if path.suffix == '.sh' else 0o644)) << 16
                    info.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(info, path.read_bytes())
        for archive in archive_paths:
            write_text(output / (archive.name + '.sha256'), f'{digest(archive)}  {archive.name}\n')
            print(f'{archive} ({archive.stat().st_size:,} bytes)')


if __name__ == '__main__':
    build()
