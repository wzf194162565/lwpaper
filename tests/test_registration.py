"""Verify registration email ownership and require an explicit login afterwards."""
import concurrent.futures
import json
import re
import unittest
import urllib.error
import urllib.request

from test_system import ApiTestCase


class RegistrationCases:
    credentials = {'username': 'registered-user', 'email': 'registered-user@qq.com',
                   'password': 'Registration-password-2026'}

    def test_registration_requires_code_and_does_not_log_in(self):
        data = dict(self.credentials)
        self.call('POST', '/api/register', data, expected=400)
        self.assertFalse(self.call('GET', '/api/session')['initialized'])
        code = self.registration_code(data)
        self.assertFalse(self.call('GET', '/api/session')['initialized'])
        result = self.call('POST', '/api/register', {**data, 'code': code})
        self.assertTrue(result['ok'])
        self.assertNotIn('csrf', result)
        self.assertNotIn(code, json.dumps(result))
        session = self.call('GET', '/api/session')
        self.assertTrue(session['initialized'])
        self.assertFalse(session['authenticated'])
        self.assertEqual('', session['csrf'])
        self.call('GET', '/api/papers', expected=401)
        self.csrf = self.call('POST', '/api/login', {'username': data['username'], 'password': data['password']})['csrf']
        self.assertTrue(self.call('GET', '/api/session')['authenticated'])
        self.assertEqual(data['email'], self.call('GET', '/api/account/recovery-email')['email'])

    def test_registration_code_is_bound_to_account_and_email(self):
        data = dict(self.credentials)
        code = self.registration_code(data)
        wrong = '000000' if code != '000000' else '111111'
        for changes in ({'code': wrong}, {'username': 'other-user', 'code': code},
                        {'email': 'someone-else@qq.com', 'code': code}):
            self.call('POST', '/api/register', {**data, **changes}, expected=400)
        self.assertFalse(self.call('GET', '/api/session')['initialized'])
        self.call('POST', '/api/register', {**data, 'code': code})
        self.call('POST', '/api/register', {**data, 'username': 'another-user', 'code': code}, expected=400)
        self.assertFalse(self.call('GET', '/api/session')['authenticated'])

    def test_registration_success_keeps_an_existing_session_on_its_original_account(self):
        self.setup_account()
        paper = self.create()
        data = dict(self.credentials)
        code = self.registration_code(data)
        self.call('POST', '/api/register', {**data, 'code': code})
        self.assertEqual('test-user', self.call('GET', '/api/session')['username'])
        self.assertEqual(paper['id'], self.call('GET', '/api/papers')[0]['id'])
        self.call('POST', '/api/register/code', {'username': data['username'], 'email': data['email']}, expected=409)
        self.assertTrue(self.inbox.messages.empty())

    def test_registration_delivery_failure_and_cooldown_do_not_create_accounts(self):
        data = dict(self.credentials)
        self.inbox.reject = True
        self.call('POST', '/api/register/code', data, expected=503)
        self.assertTrue(self.inbox.messages.empty())
        self.assertFalse(self.call('GET', '/api/session')['initialized'])
        self.inbox.reject = False
        code = self.registration_code(data)
        self.call('POST', '/api/register/code', data, expected=429)
        self.call('POST', '/api/register', {**data, 'code': code})
        self.assertFalse(self.call('GET', '/api/session')['authenticated'])

    def test_registration_codes_cannot_reset_passwords_and_reset_codes_cannot_register(self):
        self.csrf = self.register_account({'username': 'existing-user', 'email': 'owner@qq.com', 'password': 'Test-password-2026'})['csrf']
        self.call('POST', '/api/password-reset/code', {'username': 'existing-user', 'email': 'owner@qq.com'})
        reset_message = self.inbox.messages.get(timeout=3)
        reset_code = re.search(r'\b[0-9]{6}\b', reset_message.get_content()).group()
        self.call('POST', '/api/register', {**self.credentials, 'email': 'owner@qq.com', 'code': reset_code}, expected=400)
        code = self.registration_code(self.credentials)
        self.call('POST', '/api/password-reset', {'username': self.credentials['username'], 'email': self.credentials['email'],
                  'code': code, 'newPassword': 'Unwanted-new-password'}, expected=400)
        self.call('POST', '/api/register', {**self.credentials, 'code': code})
        self.assertEqual('existing-user', self.call('GET', '/api/session')['username'])
        self.call('POST', '/api/password-reset', {'username': 'existing-user', 'email': 'owner@qq.com',
                  'code': reset_code, 'newPassword': 'Recovered-password-2026'})

    def test_registration_code_is_single_use_with_concurrent_submissions(self):
        data = dict(self.credentials)
        code = self.registration_code(data)
        def submit(_):
            request = urllib.request.Request(self.base + '/api/register', method='POST',
                data=json.dumps({**data, 'code': code}).encode(), headers={'Content-Type': 'application/json'})
            try:
                with urllib.request.urlopen(request) as result:
                    return result.code
            except urllib.error.HTTPError as error:
                error.close()
                return error.code
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as workers:
            self.assertEqual([200, 409], sorted(workers.map(submit, range(2))))
        self.assertFalse(self.call('GET', '/api/session')['authenticated'])

    def test_registration_respects_origin_and_rejects_non_qq_email_before_delivery(self):
        for email in ('owner@163.com', 'owner@126.com', 'owner@qq.com.example'):
            self.call('POST', '/api/register/code', {**self.credentials, 'email': email}, expected=400)
        self.call('POST', '/api/register/code', self.credentials, expected=403,
                  headers={'Origin': 'https://untrusted.example'})
        self.assertTrue(self.inbox.messages.empty())
        self.assertFalse(self.call('GET', '/api/session')['initialized'])


class RegistrationTest(RegistrationCases, ApiTestCase):
    pass


if __name__ == '__main__':
    unittest.main()
