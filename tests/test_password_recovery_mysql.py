"""Run recovery tests against the same disposable MySQL harness as the business tests."""
import unittest

import test_mysql
import test_password_recovery as recovery


class MysqlRecoveryTest(recovery.RecoveryCases, test_mysql.MysqlTest):
    def test_recovery_email_migration_preserves_legacy_accounts_and_retries(self):
        self.setup_account()
        paper = self.create()
        self.sql('ALTER TABLE lw_user DROP COLUMN recovery_email')
        self.sql('DELETE FROM lw_schema_version WHERE version=14')
        self.restart()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        self.assertEqual('', self.call('GET', '/api/session')['recoveryEmail'])
        self.assertEqual(paper['id'], self.call('GET', '/api/papers')[0]['id'])
        self.sql("UPDATE lw_user SET recovery_email='owner@example.test' WHERE username='test-user'")
        self.sql('DELETE FROM lw_schema_version WHERE version=14')
        self.restart()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        self.assertEqual('owner@example.test', self.call('GET', '/api/session')['recoveryEmail'])
        self.assertEqual('1', self.sql('SELECT COUNT(*) FROM lw_schema_version WHERE version=14'))


def load_tests(loader, tests, pattern):
    names = [name for name in vars(recovery.RecoveryCases) if name.startswith('test_')]
    names.append('test_recovery_email_migration_preserves_legacy_accounts_and_retries')
    return unittest.TestSuite(MysqlRecoveryTest(name) for name in sorted(names))
