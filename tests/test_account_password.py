"""Encrypted login passwords and the local administrator tool, on disposable MySQL."""
import json
import os
import re
import subprocess
import unittest

import test_mysql
from test_system import ROOT


class AccountPasswordTest(test_mysql.MysqlTest):
    def tool(self, *arguments):
        return subprocess.run(['java', '-Dfile.encoding=UTF-8', '-Dapp.storage=mysql',
                               f'-Dapp.data={self.data}', f'-Ddb.name={self.database}',
                               '-Ddb.host=127.0.0.1', f'-Ddb.port={self.mysql_port}',
                               '-Ddb.username=root', '-Ddb.password=', '-Ddb.sslMode=DISABLED',
                               '-Ddb.allowPublicKeyRetrieval=true', f'-Ddb.keyFile={self.data / "database.key"}',
                               '-cp', os.pathsep.join(['out', 'lib/*']), 'AccountPasswordTool', *arguments],
                              cwd=ROOT, capture_output=True, encoding='utf-8', timeout=15)

    def assert_password(self, username, password):
        result = self.tool('show', username)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual({'username': username, 'password': password}, json.loads(result.stdout))

    def restart(self):
        self.process.terminate()
        self.process.wait(timeout=10)
        self.reset_client()
        self.csrf = ''
        self.start_server()

    def test_setup_registration_and_tool_keep_secrets_out_of_api_and_list(self):
        self.setup_account()
        self.assert_password('test-user', 'Test-password-2026')
        ciphertext = self.sql("SELECT password_ciphertext FROM lw_user WHERE username='test-user'")
        self.assertNotIn('Test-password-2026', ciphertext)
        self.assertTrue(self.sql("SELECT password_hash FROM lw_user WHERE username='test-user'").startswith('pbkdf2_sha256$'))
        self.assertNotIn(ciphertext, json.dumps(self.call('GET', '/api/session')))
        result = self.tool('list')
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual([{'username': 'test-user', 'status': 'enabled', 'passwordAvailable': True}], json.loads(result.stdout))
        self.assertNotIn('Test-password-2026', result.stdout)
        self.assertNotIn(ciphertext, result.stdout)
        password = 'Second-密码-"quotes"-2026'
        self.csrf = self.register_account({'username': 'second-user', 'password': password})['csrf']
        self.assert_password('second-user', password)
        self.assert_password('test-user', 'Test-password-2026')
        self.assertNotIn('password_ciphertext', self.call('GET', '/api/session'))
        self.call('GET', '/api/account/password', expected=404)

    def test_legacy_copy_requires_successful_login_and_preserves_data(self):
        self.setup_account()
        paper = self.create()
        saved_hash = self.sql("SELECT password_hash FROM lw_user WHERE username='test-user'")
        version = self.sql("SELECT version FROM lw_user WHERE username='test-user'")
        self.sql("UPDATE lw_user SET password_ciphertext='' WHERE username='test-user'")
        self.reset_client()
        self.csrf = ''
        self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Wrong-password-2026'}, expected=401)
        self.assertEqual('', self.sql("SELECT password_ciphertext FROM lw_user WHERE username='test-user'"))
        missing = self.tool('show', 'test-user')
        self.assertEqual(1, missing.returncode)
        self.assertEqual('', missing.stdout)
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        self.assert_password('test-user', 'Test-password-2026')
        self.assertEqual(saved_hash, self.sql("SELECT password_hash FROM lw_user WHERE username='test-user'"))
        self.assertEqual(version, self.sql("SELECT version FROM lw_user WHERE username='test-user'"))
        self.assertEqual(paper['id'], self.call('GET', '/api/papers')[0]['id'])

    def test_password_change_and_email_reset_update_copy(self):
        self.csrf = self.register_account({'username': 'recover-user', 'password': 'Original-password-2026',
                                          'email': 'owner@qq.com'})['csrf']
        paper = self.create()
        self.csrf = self.call('POST', '/api/password', {'currentPassword': 'Original-password-2026',
                                                       'newPassword': 'Changed-password-2026'})['csrf']
        self.assert_password('recover-user', 'Changed-password-2026')
        self.call('POST', '/api/password', {'currentPassword': 'wrong-password',
                                           'newPassword': 'Do-not-save-password'}, expected=401)
        self.assert_password('recover-user', 'Changed-password-2026')
        self.call('POST', '/api/password-reset/code', {'username': 'recover-user', 'email': 'owner@qq.com'})
        message = self.inbox.messages.get(timeout=3)
        code = re.search(r'\b[0-9]{6}\b', message.get_content()).group()
        self.call('POST', '/api/password-reset', {'username': 'recover-user', 'email': 'owner@qq.com',
                                                 'code': code, 'newPassword': 'Recovered-password-2026'})
        self.assert_password('recover-user', 'Recovered-password-2026')
        self.restart()
        self.csrf = self.call('POST', '/api/login', {'username': 'recover-user', 'password': 'Recovered-password-2026'})['csrf']
        self.assertEqual(paper['id'], self.call('GET', '/api/papers')[0]['id'])
        self.assert_password('recover-user', 'Recovered-password-2026')

    def test_copy_is_bound_to_user_and_rejected_when_hash_mismatches(self):
        self.setup_account()
        first = self.sql("SELECT password_ciphertext FROM lw_user WHERE username='test-user'")
        self.csrf = self.register_account({'username': 'other-user', 'password': 'Other-password-2026'})['csrf']
        self.sql(f"UPDATE lw_user SET password_ciphertext='{first}' WHERE username='other-user'")
        invalid = self.tool('show', 'other-user')
        self.assertEqual(1, invalid.returncode)
        self.assertEqual('', invalid.stdout)
        self.assertNotIn('Test-password-2026', invalid.stderr)
        self.sql("UPDATE lw_user SET password_hash=(SELECT h FROM (SELECT password_hash h FROM lw_user WHERE username='other-user') t) WHERE username='test-user'")
        mismatch = self.tool('show', 'test-user')
        self.assertEqual(1, mismatch.returncode)
        self.assertEqual('', mismatch.stdout)
        self.assertEqual(1, self.tool('show', 'unknown-user').returncode)
        self.assertEqual(2, self.tool('show').returncode)

    def test_migration_preserves_existing_hashes_and_resumes_after_ddl(self):
        self.setup_account()
        paper = self.create()
        saved_hash = self.sql("SELECT password_hash FROM lw_user WHERE username='test-user'")
        self.process.terminate()
        self.process.wait(timeout=10)
        self.sql('ALTER TABLE lw_user DROP COLUMN password_ciphertext')
        self.sql('DELETE FROM lw_schema_version WHERE version=15')
        self.start_server()
        self.assertEqual('', self.sql("SELECT password_ciphertext FROM lw_user WHERE username='test-user'"))
        self.assertEqual(saved_hash, self.sql("SELECT password_hash FROM lw_user WHERE username='test-user'"))
        self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_schema_version WHERE version=15'))
        self.reset_client()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        self.assert_password('test-user', 'Test-password-2026')
        self.sql('DELETE FROM lw_schema_version WHERE version=15')
        self.restart()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        self.assertEqual(paper['id'], self.call('GET', '/api/papers')[0]['id'])
        self.assert_password('test-user', 'Test-password-2026')
        self.assertEqual(saved_hash, self.sql("SELECT password_hash FROM lw_user WHERE username='test-user'"))


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(AccountPasswordTest(name) for name in sorted(vars(AccountPasswordTest)) if name.startswith('test_'))
