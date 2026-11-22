"""Opt-in integration tests using a disposable MySQL server, never the installed service.

PowerShell: $env:RUN_MYSQL_TESTS='1'; python -m unittest discover -s tests -p test_mysql.py -v
Set MYSQL_TEST_BIN to the directory containing mysqld, mysql and mysqladmin if needed.
"""
import base64
import os
import pathlib
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
import urllib.error
import uuid

from test_system import ApiTestCase, ROOT
import test_system
import test_business


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


@unittest.skipUnless(os.environ.get('RUN_MYSQL_TESTS') == '1', 'Set RUN_MYSQL_TESTS=1 for isolated MySQL tests')
class MysqlTest(ApiTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        configured = os.environ.get('MYSQL_TEST_BIN')
        candidates = [pathlib.Path(configured)] if configured else list(pathlib.Path('C:/Program Files/MySQL').glob('*/bin'))
        cls.bin = next((p for p in candidates if (p/'mysqld.exe').exists()), None)
        if cls.bin is None:
            raise RuntimeError('Set MYSQL_TEST_BIN to a MySQL 8.0+ bin directory')
        if not list((ROOT/'lib').glob('mysql-connector-j-*.jar')):
            raise RuntimeError('MySQL JDBC driver is required in lib/')
        (ROOT/'.test-data').mkdir(exist_ok=True)
        cls.mysql_temp = tempfile.TemporaryDirectory(prefix='mysql-', dir=ROOT/'.test-data')
        cls.addClassCleanup(cls.mysql_temp.cleanup)
        cls.mysql_data = pathlib.Path(cls.mysql_temp.name)
        cls.mysql_port = free_port()
        options = [str(cls.bin/'mysqld.exe'), '--no-defaults', f'--basedir={cls.bin.parent}',
                   f'--datadir={cls.mysql_data}', f'--log-error={cls.mysql_data / "mysql.log"}']
        subprocess.run([*options, '--initialize-insecure'], check=True, capture_output=True, timeout=60)
        cls.mysql_process = subprocess.Popen([*options, f'--port={cls.mysql_port}', '--bind-address=127.0.0.1',
                                              '--mysqlx=OFF', '--skip-log-bin', '--innodb-buffer-pool-size=32M'],
                                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.addClassCleanup(cls.stop_mysql)
        for _ in range(200):
            ping = subprocess.run([str(cls.bin/'mysqladmin.exe'), '--no-defaults', '--host=127.0.0.1',
                                   f'--port={cls.mysql_port}', '--user=root', '--connect-timeout=1', 'ping'],
                                  capture_output=True)
            if ping.returncode == 0:
                return
            if cls.mysql_process.poll() is not None:
                break
            time.sleep(.1)
        raise RuntimeError((cls.mysql_data/'mysql.log').read_text(errors='replace'))

    @classmethod
    def stop_mysql(cls):
        if cls.mysql_process.poll() is None:
            subprocess.run([str(cls.bin/'mysqladmin.exe'), '--no-defaults', '--host=127.0.0.1',
                            f'--port={cls.mysql_port}', '--user=root', 'shutdown'], capture_output=True, timeout=20)
            try:
                cls.mysql_process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                cls.mysql_process.terminate()
                cls.mysql_process.wait(timeout=10)

    def start_server(self):
        if not hasattr(self, 'databases'):
            self.databases = {}
        self.database = self.databases.setdefault(str(self.data), 'lw_test_' + uuid.uuid4().hex)
        self.process = subprocess.Popen(['java', '-Dapp.storage=mysql', f'-Dapp.port={self.port}',
                                         f'-Dapp.data={self.data}', f'-Ddb.name={self.database}',
                                         '-Ddb.host=127.0.0.1', f'-Ddb.port={self.mysql_port}',
                                         '-Ddb.username=root', '-Ddb.password=', '-Ddb.sslMode=DISABLED',
                                         '-Ddb.allowPublicKeyRetrieval=true', f'-Ddb.keyFile={self.data / "database.key"}',
                                         '-cp', os.pathsep.join(['out', 'lib/*']), 'Main'], cwd=ROOT,
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(160):
            if self.process.poll() is not None:
                self.fail('MySQL application server exited during startup')
            try:
                self.call('GET', '/api/session')
                return
            except (OSError, urllib.error.URLError):
                time.sleep(.05)
        self.process.terminate()
        self.process.wait(timeout=10)
        self.fail('MySQL application server did not start')

    def sql(self, statement):
        result = subprocess.run([str(self.bin/'mysql.exe'), '--no-defaults', '--host=127.0.0.1',
                                 f'--port={self.mysql_port}', '--user=root', '--default-character-set=utf8mb4',
                                 '--batch', '--skip-column-names', self.database, '-e', statement],
                                check=True, capture_output=True, encoding='utf-8')
        return result.stdout.strip()

    test_access_setup_and_request_protection = test_system.SystemTest.test_access_setup_and_request_protection
    test_registration_allows_new_accounts_and_rejects_only_duplicate_names = test_system.SystemTest.test_registration_allows_new_accounts_and_rejects_only_duplicate_names
    test_home_password_change_verifies_credentials_and_invalidates_sessions = test_system.SystemTest.test_home_password_change_verifies_credentials_and_invalidates_sessions
    test_home_password_change_and_login_share_rate_limit = test_system.SystemTest.test_home_password_change_and_login_share_rate_limit
    test_accounts_have_independent_data_and_survive_switching_and_restart = test_system.SystemTest.test_accounts_have_independent_data_and_survive_switching_and_restart
    test_password_changes_revoke_only_the_matching_accounts_sessions = test_system.SystemTest.test_password_changes_revoke_only_the_matching_accounts_sessions
    test_backup_restore_is_scoped_to_the_current_account = test_system.SystemTest.test_backup_restore_is_scoped_to_the_current_account
    test_restore_preserves_target_account = test_system.SystemTest.test_setup_validates_account_and_restore_preserves_current_account
    test_finance_credentials_history_and_conflicts = test_system.SystemTest.test_finance_credentials_history_and_conflicts
    test_validation_and_failed_changes_are_atomic = test_system.SystemTest.test_validation_and_failed_changes_are_atomic
    test_other_expenses_do_not_settle_balances = test_system.SystemTest.test_other_expenses_do_not_settle_writer_or_customer_balances
    test_login_rate_limiting = test_system.SystemTest.test_failed_login_attempts_are_rate_limited
    test_restart_backup_restore_and_password_change = test_system.SystemTest.test_encryption_restart_backup_restore_and_password_change
    test_static_routes_and_json_rejection = test_system.SystemTest.test_static_routes_and_json_rejection
    test_business_relationships = test_business.BusinessTest.test_customer_writing_submission_finance_relationships
    test_resubmission_journal_history_is_persistent_and_scoped_to_each_paper = test_business.BusinessTest.test_resubmission_journal_history_is_persistent_and_scoped_to_each_paper
    test_submission_validation_and_hidden_password = test_business.BusinessTest.test_submission_version_validation_and_preserve_hidden_password
    test_writing_validation_and_customer_reassignment = test_business.BusinessTest.test_writing_validation_customer_identity_and_reassignment
    test_customer_cooperation_date_persistence_validation_and_backup = test_business.BusinessTest.test_customer_cooperation_date_persistence_validation_and_backup
    test_full_and_half_workflows = test_business.BusinessTest.test_full_and_half_service_types_persist_with_independent_workflows
    test_service_type_validation = test_business.BusinessTest.test_service_type_validation_prevents_accidental_writing_data_loss
    test_schema2_backup_without_service_type = test_business.BusinessTest.test_schema2_backup_without_service_type_preserves_writing

    def test_half_papers_have_no_writing_task_and_schema_upgrade_preserves_old_tasks(self):
        self.setup_account()
        full = self.call('POST', '/api/papers', {'title': '已有写作论文', 'writer': '原写作人'}, expected=201)
        self.process.terminate()
        self.process.wait(timeout=10)
        self.sql('ALTER TABLE lw_paper DROP COLUMN service_type')
        self.sql('DELETE FROM lw_schema_version WHERE version=3')
        self.reset_client()
        self.csrf = ''
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        old = self.call('GET', f"/api/papers/{full['id']}")
        self.assertEqual('full', old['serviceType'])
        self.assertEqual('原写作人', old['writer'])
        half = self.call('POST', '/api/papers', {'title': '半包不产生写作任务', 'serviceType': 'half'}, expected=201)
        self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_writing_task'))
        self.assertEqual('0', self.sql(f"SELECT COUNT(*) FROM lw_writing_task WHERE paper_id='{half['id']}'"))
        self.assertEqual('half', self.sql(f"SELECT service_type FROM lw_paper WHERE id='{half['id']}'"))
        self.process.terminate()
        self.process.wait(timeout=10)
        # Simulate an interrupted upgrade after DDL but before recording its checksum.
        self.sql('DELETE FROM lw_schema_version WHERE version=3')
        self.reset_client()
        self.csrf = ''
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        self.assertEqual('half', self.call('GET', f"/api/papers/{half['id']}")['serviceType'])
        self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_schema_version WHERE version=3'))

    def test_customer_cooperation_date_schema_upgrade_and_repeat_start(self):
        self.setup_account()
        customer = self.call('POST', '/api/customers', {'name': '已有客户'}, expected=201)
        self.process.terminate()
        self.process.wait(timeout=10)
        # Recreate the deployed V001 shape, preserving the existing customer and account.
        self.sql('ALTER TABLE lw_customer DROP COLUMN cooperation_started_at')
        self.sql('DELETE FROM lw_schema_version WHERE version=2')
        self.start_server()
        self.reset_client()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        path = f"/api/customers/{customer['id']}"
        self.assertEqual('', self.call('GET', path)['cooperationStartedAt'])
        self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_customer WHERE cooperation_started_at IS NULL'))
        customer = self.call('PUT', path, {'version': customer['version'], 'cooperationStartedAt': '2026-01-12'})
        self.assertEqual('2026-01-12', self.sql('SELECT cooperation_started_at FROM lw_customer'))
        self.process.terminate()
        self.process.wait(timeout=10)
        self.start_server()
        self.reset_client()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        self.assertEqual('2026-01-12', self.call('GET', path)['cooperationStartedAt'])
        self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_schema_version WHERE version=2'))

    def test_customer_cooperation_date_upgrade_recovers_after_ddl(self):
        self.setup_account()
        customer = self.call('POST', '/api/customers', {'name': '已记录合作日期', 'cooperationStartedAt': '2026-01-12'}, expected=201)
        self.process.terminate()
        self.process.wait(timeout=10)
        # Simulate a crash after ALTER TABLE committed but before the version was recorded.
        self.sql('DELETE FROM lw_schema_version WHERE version=2')
        self.start_server()
        self.reset_client()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        self.assertEqual('2026-01-12', self.call('GET', f"/api/customers/{customer['id']}")['cooperationStartedAt'])
        self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_schema_version WHERE version=2'))

    def test_full_database_and_key_backup_restores_all_accounts(self):
        self.setup_account()
        first = self.create(title='云端迁移的第一账号论文')
        self.reset_client()
        self.csrf = self.call('POST', '/api/register', {'username': 'second-user', 'password': 'Second-password-2026'})['csrf']
        second = self.create(title='云端迁移的第二账号论文')
        options = self.data / 'backup-client.cnf'
        options.write_text('[client]\nhost=127.0.0.1\nport={}\nuser=root\n'.format(self.mysql_port), encoding='utf-8')
        options.chmod(0o600)
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/backup_mysql.py'), '--database', self.database,
                                 '--defaults-file', str(options), '--key-file', str(self.data / 'database.key'),
                                 '--output', str(self.data / 'snapshots'), '--mysqldump', str(self.bin / 'mysqldump.exe')],
                                cwd=ROOT, check=True, capture_output=True, encoding='utf-8')
        archive = pathlib.Path(result.stdout.strip())
        subprocess.run([sys.executable, str(ROOT / 'scripts/backup_mysql.py'), '--verify', str(archive)],
                       cwd=ROOT, check=True, capture_output=True)
        with tarfile.open(archive, 'r:gz') as stream:
            sql = stream.extractfile('database.sql').read()
            key = stream.extractfile('database.key').read()
        self.assertEqual((self.data / 'database.key').read_bytes(), key)
        self.assertIn(b'second-user', sql)
        self.assertNotIn(b'Test-password-2026', sql)
        self.assertNotIn(b'Second-password-2026', sql)
        self.assertNotIn(b'private-secret-42', sql)
        self.process.terminate()
        self.process.wait(timeout=10)
        # This is the class's disposable server/database, never the installed MySQL service.
        self.assertRegex(self.database, r'^lw_test_[a-f0-9]{32}$')
        command = [str(self.bin / 'mysql.exe'), '--no-defaults', '--host=127.0.0.1',
                   '--port={}'.format(self.mysql_port), '--user=root', '--default-character-set=utf8mb4']
        subprocess.run([*command, '-e', 'DROP DATABASE `{}`'.format(self.database)], check=True, capture_output=True)
        subprocess.run(command, input=sql, check=True, capture_output=True)
        (self.data / 'database.key').write_bytes(key)
        self.reset_client()
        self.csrf = ''
        self.start_server()
        for username, password, expected in [('test-user', 'Test-password-2026', first),
                                              ('second-user', 'Second-password-2026', second)]:
            self.reset_client()
            self.csrf = self.call('POST', '/api/login', {'username': username, 'password': password})['csrf']
            self.assertEqual([expected['id']], [p['id'] for p in self.call('GET', '/api/papers')])
            self.assertEqual('private-secret-42', self.call('POST', '/api/papers/{}/credentials'.format(expected['id']))['password'])

    def test_relational_storage_and_encryption(self):
        self.setup_account()
        paper = self.create()
        self.assertEqual('mysql', self.call('GET', '/api/session')['storage'])
        self.assertFalse((self.data/'papers.vault').exists())
        self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_writing_task'))
        self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_submission'))
        self.assertTrue(self.sql('SELECT password_hash FROM lw_user').startswith('pbkdf2_sha256$'))
        encrypted = self.sql('SELECT password_ciphertext FROM lw_submission_credential')
        self.assertTrue(encrypted)
        self.assertNotIn('private-secret-42', encrypted)
        self.assertEqual('800010', self.sql('SELECT contract_cents FROM lw_paper'))
        self.assertEqual(paper['customerId'], self.sql('SELECT customer_id FROM lw_paper'))
        # Ciphertext is authenticated against its own submission UUID.
        other = self.create(title='另一篇论文')
        self.sql(f"UPDATE lw_submission_credential SET password_ciphertext='{encrypted}' WHERE submission_id='{other['activeSubmissionId']}'")
        self.call('POST', f"/api/papers/{other['id']}/credentials", expected=500)

    def test_legacy_import_is_atomic_and_keeps_original(self):
        self.process.terminate()
        self.process.wait(timeout=10)
        subprocess.run(['javac', '-encoding', 'UTF-8', '--release', '17', '-d', 'out',
                        *[str(p) for p in (ROOT/'src').glob('*.java')], str(ROOT/'tests/LegacyFixture.java')],
                       cwd=ROOT, check=True, capture_output=True)
        subprocess.run(['java', '-cp', 'out', 'LegacyFixture', str(self.data)], cwd=ROOT, check=True, capture_output=True)
        original = (self.data/'papers.vault').read_bytes()
        self.start_server()
        self.assertTrue(self.call('GET', '/api/session')['initialized'])
        self.call('POST', '/api/setup', {'username':'test-user','password':'Test-password-2026'}, expected=409)
        self.call('POST', '/api/login', {'username':'wrong-user','password':'Test-password-2026'}, expected=401)
        self.assertEqual('0', self.sql('SELECT COUNT(*) FROM lw_user'))
        self.csrf = self.call('POST', '/api/login', {'username':'test-user','password':'Test-password-2026'})['csrf']
        paper = self.call('GET', '/api/papers')[0]
        self.assertEqual('旧写作题目', paper['title'])
        self.assertEqual(120000, paper['paidCents'])
        self.assertEqual('legacy-private-password', self.call('POST', f"/api/papers/{paper['id']}/credentials")['password'])
        self.assertEqual(original, (self.data/'papers.vault').read_bytes())
        saved = list((self.data/'backups').glob('pre-mysql-*.vault'))
        self.assertEqual(1, len(saved))
        self.assertEqual(original, saved[0].read_bytes())
        self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_storage_meta WHERE legacy_import_sha256 IS NOT NULL'))
        self.process.terminate()
        self.process.wait(timeout=10)
        self.reset_client()
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username':'test-user','password':'Test-password-2026'})['csrf']
        self.assertEqual(1, len(self.call('GET', '/api/papers')))
        self.assertEqual(1, len(list((self.data/'backups').glob('pre-mysql-*.vault'))))

    def test_restore_reassigns_retained_paper_and_deletes_previous_customer(self):
        self.setup_account()
        first = self.call('POST', '/api/customers', {'name':'原客户'}, expected=201)
        paper = self.create(customerId=first['id'])
        backup = self.call('GET', '/api/backup', raw=True)
        second = self.call('POST', '/api/customers', {'name':'后来客户'}, expected=201)
        self.call('PUT', f"/api/papers/{paper['id']}", {'version':paper['version'], 'customerId':second['id']})
        self.call('DELETE', f"/api/customers/{first['id']}", {'version':first['version']})
        self.call('POST', '/api/restore', {'backup':base64.b64encode(backup).decode(), 'password':'Test-password-2026'})
        self.assertEqual(first['id'], self.call('GET', '/api/papers')[0]['customerId'])
        self.assertEqual([first['id']], [c['id'] for c in self.call('GET', '/api/customers')])

    def test_mysql_backup_can_be_restored_in_file_mode(self):
        self.setup_account()
        paper = self.create()
        backup = self.call('GET', '/api/backup', raw=True)
        self.process.terminate()
        self.process.wait(timeout=10)
        ApiTestCase.start_server(self)
        self.setup_account(username='local-account')
        self.call('POST', '/api/restore', {'backup':base64.b64encode(backup).decode(), 'password':'Test-password-2026'})
        self.assertEqual('local-account', self.call('GET', '/api/session')['username'])
        self.assertEqual(paper['id'], self.call('GET', '/api/papers')[0]['id'])
        self.assertEqual('private-secret-42', self.call('POST', f"/api/papers/{paper['id']}/credentials")['password'])
