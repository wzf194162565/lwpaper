"""Check the generated archives, then boot their JAR with isolated runtime data."""
import hashlib
import http.cookiejar
import io
import json
import os
import pathlib
import socket
import struct
import subprocess
import tarfile
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
RELEASES = sorted((ROOT / 'dist').glob('paper-desk-aliyun-*.tar.gz'))


@unittest.skipUnless(RELEASES, 'Build a deployment bundle with scripts/package_release.py first')
class ReleaseTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.archive = RELEASES[-1]
        with tarfile.open(cls.archive, 'r:gz') as archive:
            cls.entries = archive.getmembers()
            cls.name = cls.entries[0].name
            cls.files = {entry.name[len(cls.name) + 1:]: archive.extractfile(entry).read()
                         for entry in cls.entries if entry.isfile()}

    def test_archives_match_checksums_and_exclude_local_data(self):
        for suffix in ('.tar.gz', '.zip'):
            archive = self.archive.with_name(self.name + suffix)
            expected = archive.with_name(archive.name + '.sha256').read_text(encoding='utf-8').split()[0]
            self.assertEqual(expected, hashlib.sha256(archive.read_bytes()).hexdigest())
        with zipfile.ZipFile(self.archive.with_name(self.name + '.zip')) as archive:
            zipped = {name[len(self.name) + 1:]: archive.read(name) for name in archive.namelist()}
        self.assertEqual(self.files, zipped)
        for name in self.files:
            self.assertNotIn('..', pathlib.PurePosixPath(name).parts)
            self.assertFalse(name.startswith(('.idea/', '.test-data/', '.qa-data/', 'tests/', 'out/')))
            self.assertFalse(name.endswith(('.key', '.vault', '.bak', '.log')))
        self.assertEqual(['data/.keep'], [name for name in self.files if name.startswith('data/')])
        self.assertIn(b'app.storage=file', self.files['config/application.properties'])
        self.assertIn(b'db.password=YOUR_DATABASE_PASSWORD', self.files['config/application.mysql.example.properties'])
        metadata = json.loads(self.files['RELEASE.json'])
        self.assertEqual(17, metadata['javaRelease'])
        for name, checksum in metadata['files'].items():
            self.assertEqual(checksum, hashlib.sha256(self.files[name]).hexdigest(), name)
        for line in self.files['SHA256SUMS'].decode().splitlines():
            checksum, name = line.split('  ', 1)
            self.assertEqual(checksum, hashlib.sha256(self.files[name]).hexdigest(), name)

    def test_linux_scripts_permissions_and_java17_artifact(self):
        for entry in self.entries:
            self.assertFalse(entry.issym() or entry.islnk())
            if entry.name.endswith('.sh'):
                self.assertEqual(0o755, entry.mode)
                content = self.files[entry.name[len(self.name) + 1:]]
                self.assertTrue(content.startswith(b'#!/usr/bin/env bash\n'))
                self.assertNotIn(b'\r', content)
        with zipfile.ZipFile(io.BytesIO(self.files['paper-desk.jar'])) as jar:
            self.assertEqual(61, struct.unpack('>H', jar.read('Main.class')[6:8])[0])
            manifest = jar.read('META-INF/MANIFEST.MF').decode()
            self.assertIn('Main-Class: Main', manifest)
            self.assertIn('Class-Path: lib/mysql-connector-j-', manifest)
            self.assertFalse(any('Fixture' in name or 'Test' in name for name in jar.namelist()))
            self.assertIn('AccountRegistry.class', jar.namelist())
            self.assertIn('ServiceTermination.class', jar.namelist())
        for name in ('db/mysql/V001__initial_schema.sql', 'db/mysql/V002__customer_cooperation_date.sql',
                     'web/files.js', 'db/mysql/V005__paper_files.sql', 'db/mysql/V006__follow_up_reason.sql', 'db/mysql/V007__customer_classification.sql', 'db/mysql/V008__service_termination.sql', 'db/mysql/V009__publication_fees.sql', 'deploy/backup.sh',
                     'db/mysql/V003__paper_service_type.sql', 'db/mysql/V004__customer_payment_deposit.sql', 'deploy/nginx.conf.example', 'deploy/paper-desk.service',
                     'tools/backup_mysql.py', 'deploy/mysql-init.sql.example', 'deploy/backup.cron.example',
                     'config/mysql-client.example.cnf'):
            self.assertIn(name, self.files)

    def test_packaged_jar_can_initialize_save_pay_and_restart(self):
        directory = ROOT / '.qa-data'
        directory.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='release smoke ', dir=directory) as temporary:
            folder = pathlib.Path(temporary)
            for name, content in self.files.items():
                target = folder / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            base = f'http://127.0.0.1:{port}'
            csrf = ''
            client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

            def call(method, path, body=None, expected=200, raw=False, origin=None):
                request = urllib.request.Request(base + path, method=method,
                    data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
                    headers={'Content-Type': 'application/json', 'X-CSRF-Token': csrf,
                             'Origin': origin or base})
                try:
                    response = client.open(request, timeout=15)
                except urllib.error.HTTPError as error:
                    response = error
                with response:
                    result = response.read()
                    self.assertEqual(expected, response.code, result[:300])
                return result if raw else json.loads(result)

            def start():
                environment = dict(os.environ, APP_STORAGE='file')
                process = subprocess.Popen(['java', f'-Dapp.root={folder}', f'-Dapp.port={port}',
                    '-jar', str(folder / 'paper-desk.jar')], cwd=folder, env=environment,
                    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                for _ in range(100):
                    if process.poll() is not None:
                        message = process.stderr.read().decode(errors='replace')
                        process.stderr.close()
                        self.fail('Packaged JAR exited: ' + message)
                    try:
                        call('GET', '/api/session')
                        return process
                    except urllib.error.URLError:
                        time.sleep(.05)
                process.terminate()
                process.wait(timeout=10)
                process.stderr.close()
                self.fail('Packaged JAR did not start')

            def stop(process):
                process.terminate()
                process.wait(timeout=10)
                process.stderr.close()

            process = start()
            try:
                for path in ('/', '/app.js', '/business.js', '/styles.css', '/favicon.svg'):
                    expected_file = 'web/index.html' if path == '/' else 'web' + path
                    self.assertEqual(self.files[expected_file], call('GET', path, raw=True))
                call('POST', '/api/setup', {'username': 'release-admin', 'password': 'Package-test-2026'},
                     expected=403, origin='https://untrusted.example')
                csrf = call('POST', '/api/setup', {'username': 'release-admin', 'password': 'Package-test-2026'})['csrf']
                paper = call('POST', '/api/papers', {'title': '部署包收支核验', 'serviceType': 'full',
                    'contractAmount': '66000', 'contractDepositAmount': '16000.50', 'writerFee': '43000'}, expected=201)
                self.assertEqual(1600050, paper['contractDepositCents'])
                self.assertEqual(4999950, paper['contractBalanceCents'])
                self.assertEqual(0, paper['receivedCents'])
                self.assertEqual(6600000, paper['receivableCents'])
                self.assertEqual(4300000, paper['payableCents'])
                path = f"/api/papers/{paper['id']}"
                paper = call('POST', path + '/transactions', {'version': paper['version'],
                    'type': 'incoming_deposit', 'amount': '1000', 'date': '2026-01-01'}, expected=201)
                self.assertEqual(6500000, paper['receivableCents'])
                self.assertEqual(1, len(call('GET', '/api/papers')))
                self.assertGreater(len(call('GET', '/api/backup', raw=True)), 100)
                first_client, first_csrf = client, csrf
                client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
                csrf = call('POST', '/api/register', {'username': 'release-second', 'password': 'Second-package-password'})['csrf']
                self.assertEqual([], call('GET', '/api/papers'))
                second = call('POST', '/api/papers', {'title': '第二账号的半包论文', 'serviceType': 'half'}, expected=201)
                self.assertEqual('half', second['serviceType'])
                client, csrf = first_client, first_csrf
                self.assertEqual([paper['id']], [p['id'] for p in call('GET', '/api/papers')])
            finally:
                stop(process)
            process = start()
            try:
                csrf = call('POST', '/api/login', {'username': 'release-admin', 'password': 'Package-test-2026'})['csrf']
                paper = call('GET', '/api/papers')[0]
                self.assertEqual(1600050, paper['contractDepositCents'])
                self.assertEqual(4999950, paper['contractBalanceCents'])
                self.assertEqual(6500000, paper['receivableCents'])
                self.assertEqual(1, len(paper['transactions']))
                client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
                csrf = call('POST', '/api/login', {'username': 'release-second', 'password': 'Second-package-password'})['csrf']
                self.assertEqual([second['id']], [p['id'] for p in call('GET', '/api/papers')])
            finally:
                stop(process)


if __name__ == '__main__':
    unittest.main()
