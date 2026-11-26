"""Exercise real HTTP recovery and SMTP delivery with disposable accounts and a local inbox."""
import concurrent.futures
import json
import re
import subprocess
import unittest
import urllib.error
import urllib.request

from test_system import ApiTestCase, ROOT


class RecoveryCases:
    def register_recovery_account(self):
        self.csrf = self.register_account({'username': 'recover-user',
                              'password': 'Original-password-2026', 'email': 'Owner@QQ.Com'})['csrf']

    def request_code(self, username='recover-user', address='owner@qq.com'):
        return self.call('POST', '/api/password-reset/code', {'username': username, 'email': address})

    def code(self):
        message = self.inbox.messages.get(timeout=3)
        self.assertEqual('owner@qq.com', message['To'])
        self.assertIn('重置密码', str(message['Subject']))
        return re.search(r'\b[0-9]{6}\b', message.get_content()).group()

    def reset(self, code, **changes):
        return self.call('POST', '/api/password-reset', {'username': 'recover-user',
                         'email': 'owner@qq.com', 'code': code, 'newPassword': 'Recovered-password-2026', **changes})

    def restart(self):
        self.process.terminate()
        self.process.wait(timeout=10)
        self.reset_client()
        self.csrf = ''
        self.start_server()

    def test_recovery_registration_requires_qq_email_and_stores_normalized_binding(self):
        for address in ('', 'owner@163.com', 'owner@qq.com.example', 'owner@qq.com\r\nBcc: other@example.test'):
            self.register_account({'username': 'recover-user', 'password': 'Original-password-2026',
                                              'email': address}, expected=400)
        self.register_recovery_account()
        self.assertEqual('owner@qq.com', self.call('GET', '/api/session')['recoveryEmail'])
        self.assertEqual('owner@qq.com', self.call('GET', '/api/account/recovery-email')['email'])
        self.register_account({'username': 'recover-user', 'password': 'Other-password',
                                          'email': 'other@qq.com'}, expected=409)
        self.assertEqual('owner@qq.com', self.call('GET', '/api/account/recovery-email')['email'])

    def test_recovery_delivers_only_to_bound_email_and_preserves_data_after_restart(self):
        self.register_recovery_account()
        paper = self.create()
        old_client, old_csrf = self.client, self.csrf
        self.reset_client()
        wrong = self.request_code(address='other@example.test')
        unknown = self.request_code(username='unknown-user')
        self.assertEqual(wrong, unknown)
        self.assertTrue(self.inbox.messages.empty())
        response = self.request_code()
        self.assertEqual(wrong, response)
        code = self.code()
        self.assertNotIn(code, json.dumps(response))
        self.call('POST', '/api/password-reset/code', {'username': 'recover-user',
                                                     'email': 'owner@qq.com'}, expected=429)
        self.call('POST', '/api/password-reset', {'username': 'recover-user', 'email': 'owner@qq.com',
                  'code': code, 'newPassword': 'short'}, expected=400)
        self.reset(code)
        self.call('POST', '/api/password-reset', {'username': 'recover-user', 'email': 'owner@qq.com',
                  'code': code, 'newPassword': 'Reused-code-password'}, expected=400)
        self.client, self.csrf = old_client, old_csrf
        self.call('GET', '/api/papers', expected=401)
        self.restart()
        self.call('POST', '/api/login', {'username': 'recover-user', 'password': 'Original-password-2026'}, expected=401)
        self.csrf = self.call('POST', '/api/login', {'username': 'recover-user', 'password': 'Recovered-password-2026'})['csrf']
        self.assertEqual(paper['id'], self.call('GET', '/api/papers')[0]['id'])
        self.assertEqual('private-secret-42', self.call('POST', f"/api/papers/{paper['id']}/credentials")['password'])

    def test_recovery_survives_restart_before_reset_and_normal_password_changes(self):
        self.register_recovery_account()
        paper = self.create()
        self.csrf = self.call('POST', '/api/password', {'currentPassword': 'Original-password-2026',
                                  'newPassword': 'Changed-before-recovery'})['csrf']
        self.restart()
        self.request_code()
        self.reset(self.code())
        self.csrf = self.call('POST', '/api/login', {'username': 'recover-user', 'password': 'Recovered-password-2026'})['csrf']
        self.assertEqual(paper['id'], self.call('GET', '/api/papers')[0]['id'])
        self.assertEqual('owner@qq.com', self.call('GET', '/api/account/recovery-email')['email'])

    def test_recovery_email_is_read_only_and_rejected_updates_preserve_the_binding(self):
        self.register_recovery_account()
        self.request_code()
        code = self.code()
        self.call('POST', '/api/account/recovery-email', {'email': 'new-owner@example.test',
                  'currentPassword': 'Original-password-2026'}, expected=404)
        self.assertEqual('owner@qq.com', self.call('GET', '/api/session')['recoveryEmail'])
        self.assertEqual('owner@qq.com', self.call('GET', '/api/account/recovery-email')['email'])
        self.assertTrue(self.call('GET', '/api/session')['authenticated'])
        self.reset(code)
        self.reset_client()
        self.csrf = ''
        self.call('POST', '/api/account/recovery-email', {'email': 'attacker@example.test',
                  'currentPassword': 'Test-password-2026'}, expected=401)

    def test_recovery_invalidates_only_matching_sessions_and_accepts_code_once_concurrently(self):
        self.register_recovery_account()
        first_client, first_csrf = self.client, self.csrf
        self.reset_client()
        self.csrf = self.register_account({'username': 'second-user',
                  'password': 'Second-password-2026', 'email': 'other@qq.com'})['csrf']
        second = self.create()
        self.request_code()
        code = self.code()
        def send_reset():
            request = urllib.request.Request(self.base + '/api/password-reset', method='POST',
                data=json.dumps({'username': 'recover-user', 'email': 'owner@qq.com',
                                 'code': code, 'newPassword': 'Recovered-password-2026'}).encode(),
                headers={'Content-Type': 'application/json'})
            try:
                with urllib.request.urlopen(request) as result:
                    return result.code
            except urllib.error.HTTPError as error:
                error.close()
                return error.code
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as workers:
            self.assertEqual([200, 400], sorted(workers.map(lambda _: send_reset(), range(2))))
        self.assertEqual(second['id'], self.call('GET', '/api/papers')[0]['id'])
        self.client, self.csrf = first_client, first_csrf
        self.call('GET', '/api/papers', expected=401)

    def test_recovery_wrong_codes_lock_challenge_and_origin_protection_blocks_delivery(self):
        self.register_recovery_account()
        self.call('POST', '/api/password-reset/code', {'username': 'recover-user', 'email': 'owner@qq.com'},
                  expected=403, headers={'Origin': 'https://untrusted.example'})
        self.assertTrue(self.inbox.messages.empty())
        self.request_code()
        code = self.code()
        wrong = '000000' if code != '000000' else '111111'
        for _ in range(5):
            self.call('POST', '/api/password-reset', {'username': 'recover-user', 'email': 'owner@qq.com',
                      'code': wrong, 'newPassword': 'Recovered-password-2026'}, expected=400)
        self.call('POST', '/api/password-reset', {'username': 'recover-user', 'email': 'owner@qq.com',
                  'code': code, 'newPassword': 'Recovered-password-2026'}, expected=400)
        self.assertTrue(self.call('GET', '/api/session')['authenticated'])

    def test_recovery_delivery_failure_is_actionable_and_does_not_issue_a_code(self):
        self.register_recovery_account()
        self.inbox.reject = True
        self.call('POST', '/api/password-reset/code', {'username': 'recover-user', 'email': 'owner@qq.com'}, expected=503)
        self.assertTrue(self.inbox.messages.empty())
        self.inbox.reject = False
        self.request_code()
        self.reset(self.code())


class RecoveryTest(RecoveryCases, ApiTestCase):
    def test_recovery_smtp_accepts_whitespace_and_case_without_changing_password(self):
        self.register_recovery_account()
        self.inbox.expected_credentials = ('sender@example.test', ' exact-test-password ')
        self.JAVA_OPTIONS += ['-Dmail.host= 127.0.0.1 ', f'-Dmail.port= {self.inbox.server_address[1]} ',
                              '-Dmail.security= NoNe ', '-Dmail.from= sender@example.test ',
                              '-Dmail.username= sender@example.test ', '-Dmail.password= exact-test-password ']
        self.restart()
        self.request_code()
        self.assertEqual(self.inbox.expected_credentials, self.inbox.authenticated.get(timeout=3))
        self.reset(self.code())

    def test_recovery_material_is_encrypted_and_not_in_portable_business_backups(self):
        self.register_recovery_account()
        self.create()
        record = (self.data / 'account-recovery.json').read_bytes()
        for secret in (b'owner@qq.com', b'Original-password-2026', b'private-secret-42'):
            self.assertNotIn(secret, record)
        backup = self.call('GET', '/api/backup', raw=True)
        self.assertNotIn(record, backup)
        self.assertTrue((self.data / 'recovery.key').exists())


class RecoveryClockTest(unittest.TestCase):
    def test_recovery_expiry_resend_and_source_limits(self):
        sources = [str(path) for path in (ROOT / 'src').glob('*.java')]
        subprocess.run(['javac', '-encoding', 'UTF-8', '--release', '17', '-d', 'out',
                        *sources, str(ROOT / 'tests/RecoveryFixture.java')], cwd=ROOT, check=True, capture_output=True)
        subprocess.run(['java', '-cp', 'out', 'RecoveryFixture'], cwd=ROOT, check=True, capture_output=True)


if __name__ == '__main__':
    unittest.main()
