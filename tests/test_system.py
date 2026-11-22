"""End-to-end tests against a real Java process and an isolated encrypted store."""
import base64
import concurrent.futures
import http.cookiejar
import json
import pathlib
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]


class ApiTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        subprocess.run(['javac', '-encoding', 'UTF-8', '--release', '17', '-d', 'out',
                        *[str(p) for p in (ROOT / 'src').glob('*.java')]], cwd=ROOT, check=True,
                       capture_output=True)

    def setUp(self):
        directory = ROOT / '.test-data'
        directory.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=directory)
        self.data = pathlib.Path(self.temp.name)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            self.port = sock.getsockname()[1]
        self.base = f'http://127.0.0.1:{self.port}'
        self.csrf = ''
        self.reset_client()
        self.start_server()

    def reset_client(self):
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def start_server(self):
        self.process = subprocess.Popen(['java', '-Dapp.storage=file', f'-Dapp.port={self.port}', f'-Dapp.data={self.data}',
                                         '-cp', 'out', 'Main'], cwd=ROOT, stdout=subprocess.DEVNULL,
                                        stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                self.call('GET', '/api/session')
                return
            except (OSError, urllib.error.URLError):
                time.sleep(.05)
        self.fail('Java server did not start')

    def tearDown(self):
        self.process.terminate()
        self.process.wait(timeout=10)
        self.temp.cleanup()

    def call(self, method, path, data=None, expected=200, headers=None, raw=False):
        encoded = json.dumps(data or {}, ensure_ascii=False).encode() if method != 'GET' else None
        request = urllib.request.Request(self.base + path, data=encoded, method=method,
                                         headers={'Content-Type': 'application/json', 'X-CSRF-Token': self.csrf,
                                                  **(headers or {})})
        try:
            response = self.client.open(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        try:
            content = response.read()
        finally:
            response.close()
        self.assertEqual(expected, response.code, content.decode(errors='replace')[:500])
        return content if raw else json.loads(content)

    def setup_account(self, username='test-user'):
        self.csrf = self.call('POST', '/api/setup', {'username': username, 'password': 'Test-password-2026'})['csrf']

    def create(self, **changes):
        payload = {'title': '面向复杂系统的研究', 'authors': '张三', 'customer': '委托人甲', 'writer': '合作人乙',
                   'status': '待投稿', 'contractAmount': '8000.10', 'writerFee': '3000.20',
                   'submissionAccount': 'test-account', 'submissionPassword': 'private-secret-42',
                   'boundEmail': 'test@example.com', 'boundPhone': '13800000000', **changes}
        return self.call('POST', '/api/papers', payload, expected=201)

    def payload(self, paper, **changes):
        return {**paper, 'contractAmount': f"{paper['contractCents']/100:.2f}",
                'writerFee': f"{paper['writerFeeCents']/100:.2f}", **changes}


class SystemTest(ApiTestCase):
    def test_registration_allows_new_accounts_and_rejects_only_duplicate_names(self):
        self.call('POST', '/api/register', {'username': 'ab', 'password': 'Test-password-2026'}, expected=400)
        self.call('POST', '/api/register', {'username': 'test-user', 'password': 'short'}, expected=400)
        result = self.call('POST', '/api/register', {'username': 'test-user', 'password': 'Test-password-2026'})
        self.csrf = result['csrf']
        self.assertEqual('test-user', result['username'])
        self.assertTrue(self.call('GET', '/api/session')['authenticated'])
        paper = self.create()
        first_client, first_csrf = self.client, self.csrf
        self.reset_client()
        self.csrf = ''
        self.assertEqual('', self.call('GET', '/api/session')['username'])
        self.assertFalse(self.call('GET', '/api/session')['authenticated'])
        result = self.call('POST', '/api/register', {'username': 'second-user', 'password': 'Different-password'})
        self.csrf = result['csrf']
        self.assertEqual('second-user', self.call('GET', '/api/session')['username'])
        self.assertEqual([], self.call('GET', '/api/papers'))
        self.call('POST', '/api/register', {'username': 'test-user', 'password': 'Different-password'}, expected=409)
        self.call('POST', '/api/register', {'username': 'second-user', 'password': 'Different-password'}, expected=409)
        self.assertEqual('second-user', self.call('GET', '/api/session')['username'])
        self.client, self.csrf = first_client, first_csrf
        self.assertEqual('test-user', self.call('GET', '/api/session')['username'])
        self.assertEqual(paper['id'], self.call('GET', '/api/papers')[0]['id'])

    def test_home_password_change_verifies_credentials_and_invalidates_sessions(self):
        self.setup_account()
        paper = self.create()
        error = self.call('POST', '/api/password', {'currentPassword': 'wrong-password', 'newPassword': 'Changed-password-2026'}, expected=401)
        self.assertTrue(error['authenticated'])
        original_client, original_csrf = self.client, self.csrf
        self.reset_client()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        second_client, second_csrf = self.client, self.csrf
        self.reset_client()
        self.csrf = ''
        payload = {'username': 'test-user', 'currentPassword': 'Test-password-2026', 'newPassword': 'Changed-password-2026'}
        self.call('POST', '/api/change-password', {**payload, 'username': 'wrong-user'}, expected=401)
        self.call('POST', '/api/change-password', {**payload, 'currentPassword': 'wrong-password'}, expected=401)
        self.call('POST', '/api/change-password', {**payload, 'newPassword': 'short'}, expected=400)
        self.call('POST', '/api/change-password', payload, expected=403, headers={'Origin': 'https://evil.example'})
        anonymous_client = self.client
        self.client, self.csrf = original_client, original_csrf
        self.assertEqual(paper['id'], self.call('GET', '/api/papers')[0]['id'])
        self.client, self.csrf = anonymous_client, ''
        self.call('POST', '/api/change-password', payload)
        self.assertFalse(self.call('GET', '/api/session')['authenticated'])
        for client, csrf in [(original_client, original_csrf), (second_client, second_csrf)]:
            self.client, self.csrf = client, csrf
            self.call('GET', '/api/papers', expected=401)
        self.client, self.csrf = anonymous_client, ''
        self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'}, expected=401)
        self.process.terminate()
        self.process.wait(timeout=10)
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': payload['newPassword']})['csrf']
        self.assertEqual(paper['id'], self.call('GET', '/api/papers')[0]['id'])
        self.assertEqual('private-secret-42', self.call('POST', f"/api/papers/{paper['id']}/credentials")['password'])

    def test_home_password_change_and_login_share_rate_limit(self):
        self.setup_account()
        self.call('POST', '/api/logout')
        for _ in range(3):
            self.call('POST', '/api/change-password', {'username': 'test-user', 'currentPassword': 'wrong-password',
                                                     'newPassword': 'Changed-password-2026'}, expected=401)
        for _ in range(2):
            self.call('POST', '/api/login', {'username': 'test-user', 'password': 'wrong-password'}, expected=401)
        self.call('POST', '/api/change-password', {'username': 'test-user', 'currentPassword': 'Test-password-2026',
                                                 'newPassword': 'Changed-password-2026'}, expected=429)

    def test_accounts_have_independent_data_and_survive_switching_and_restart(self):
        self.setup_account()
        first = self.create(title='账号甲的论文')
        first_client, first_csrf = self.client, self.csrf
        self.reset_client()
        self.csrf = self.call('POST', '/api/register', {'username': 'second-user', 'password': 'Second-password-2026'})['csrf']
        second_client, second_csrf = self.client, self.csrf
        self.assertEqual([], self.call('GET', '/api/papers'))
        self.assertEqual([], self.call('GET', '/api/customers'))
        for method, path, payload in [
            ('GET', f"/api/papers/{first['id']}", None),
            ('PUT', f"/api/papers/{first['id']}", {'version': first['version'], 'title': '越权修改'}),
            ('DELETE', f"/api/papers/{first['id']}", {'version': first['version']}),
            ('POST', f"/api/papers/{first['id']}/credentials", {}),
            ('POST', f"/api/papers/{first['id']}/submissions/{first['activeSubmissionId']}/credentials", {}),
            ('GET', f"/api/customers/{first['customerId']}", None),
        ]:
            self.call(method, path, payload, expected=404)
        self.call('POST', '/api/papers', {}, expected=403, headers={'X-CSRF-Token': first_csrf})
        second = self.create(title='账号乙的论文', submissionPassword='Second-private-secret')

        def read_for(client):
            with client.open(self.base + '/api/papers', timeout=10) as response:
                return json.loads(response.read())

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            clients = [first_client, second_client] * 6
            for index, papers in enumerate(pool.map(read_for, clients)):
                self.assertEqual([first['id'] if index % 2 == 0 else second['id']], [paper['id'] for paper in papers])
        self.call('POST', '/api/logout')
        self.client, self.csrf = first_client, first_csrf
        self.assertEqual('test-user', self.call('GET', '/api/session')['username'])
        self.assertEqual(first['id'], self.call('GET', '/api/papers')[0]['id'])
        self.process.terminate()
        self.process.wait(timeout=10)
        self.reset_client()
        self.csrf = ''
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'second-user', 'password': 'Second-password-2026'})['csrf']
        self.assertEqual(second['id'], self.call('GET', '/api/papers')[0]['id'])
        self.assertEqual('Second-private-secret', self.call('POST', f"/api/papers/{second['id']}/credentials")['password'])
        second_client, second_csrf = self.client, self.csrf
        self.reset_client()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        self.assertEqual(first['id'], self.call('GET', '/api/papers')[0]['id'])
        self.assertEqual('private-secret-42', self.call('POST', f"/api/papers/{first['id']}/credentials")['password'])
        self.client, self.csrf = second_client, second_csrf
        self.assertEqual('second-user', self.call('GET', '/api/session')['username'])

    def test_password_changes_revoke_only_the_matching_accounts_sessions(self):
        self.setup_account()
        first_client, first_csrf = self.client, self.csrf
        self.reset_client()
        self.csrf = self.call('POST', '/api/register', {'username': 'second-user', 'password': 'Second-password-2026'})['csrf']
        second = self.create(title='第二个账号仍可使用')
        # A public password change for account A must preserve the caller's account B cookie.
        self.call('POST', '/api/change-password', {'username': 'test-user', 'currentPassword': 'Test-password-2026',
                                                 'newPassword': 'Changed-password-2026'})
        self.assertEqual('second-user', self.call('GET', '/api/session')['username'])
        self.assertEqual(second['id'], self.call('GET', '/api/papers')[0]['id'])
        second_client, second_csrf = self.client, self.csrf
        self.client, self.csrf = first_client, first_csrf
        self.call('GET', '/api/papers', expected=401)
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Changed-password-2026'})['csrf']
        first_client, first_csrf = self.client, self.csrf
        self.client, self.csrf = second_client, second_csrf
        result = self.call('POST', '/api/password', {'currentPassword': 'Second-password-2026', 'newPassword': 'Second-changed-password'})
        self.csrf = result['csrf']
        self.assertEqual(second['id'], self.call('GET', '/api/papers')[0]['id'])
        self.client, self.csrf = first_client, first_csrf
        self.assertEqual('test-user', self.call('GET', '/api/session')['username'])
        self.assertEqual([], self.call('GET', '/api/papers'))

    def test_backup_restore_is_scoped_to_the_current_account(self):
        self.setup_account()
        original = self.create(title='需要迁移的论文')
        backup = self.call('GET', '/api/backup', raw=True)
        first_client, first_csrf = self.client, self.csrf
        self.reset_client()
        self.csrf = self.call('POST', '/api/register', {'username': 'second-user', 'password': 'Second-password-2026'})['csrf']
        self.create(title='替换前的第二账号论文')
        self.call('POST', '/api/restore', {'backup': base64.b64encode(backup).decode(), 'password': 'Test-password-2026'})
        self.assertEqual('second-user', self.call('GET', '/api/session')['username'])
        imported = self.call('GET', '/api/papers')[0]
        self.assertEqual(original['title'], imported['title'])
        self.assertEqual('private-secret-42', self.call('POST', f"/api/papers/{imported['id']}/credentials")['password'])
        self.call('PUT', f"/api/papers/{imported['id']}", {'version': imported['version'], 'title': '仅修改第二账号的副本'})
        self.client, self.csrf = first_client, first_csrf
        self.assertEqual(original['id'], self.call('GET', '/api/papers')[0]['id'])
        self.assertEqual(original['title'], self.call('GET', '/api/papers')[0]['title'])

    def test_access_setup_and_request_protection(self):
        self.assertFalse(self.call('GET', '/api/session')['initialized'])
        self.call('GET', '/api/papers', expected=401)
        self.call('POST', '/api/setup', {'username': 'test-user', 'password': 'short'}, expected=400)
        self.setup_account()
        self.call('POST', '/api/setup', {'username': 'test-user', 'password': 'Another-password'}, expected=409)
        self.assertTrue(self.call('GET', '/api/session')['authenticated'])
        self.call('POST', '/api/papers', {}, expected=403, headers={'X-CSRF-Token': 'wrong'})
        self.call('POST', '/api/papers', {}, expected=403, headers={'Origin': 'https://evil.example'})
        self.call('GET', '/api/papers', expected=403, headers={'Host': f'evil.example:{self.port}'})
        self.call('POST', '/api/logout')
        self.call('GET', '/api/papers', expected=401)
        self.call('POST', '/api/login', {'username': 'other-user', 'password': 'Test-password-2026'}, expected=401)
        self.call('POST', '/api/login', {'password': 'Test-password-2026'}, expected=401)
        self.call('POST', '/api/login', {'username': 'test-user', 'password': 'wrong'}, expected=401)
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        self.assertEqual('test-user', self.call('GET', '/api/session')['username'])
        self.assertEqual([], self.call('GET', '/api/papers'))

    def test_setup_validates_account_and_restore_preserves_current_account(self):
        for username in ['', 'ab', 'invalid account', '<script>']:
            self.call('POST', '/api/setup', {'username': username, 'password': 'Test-password-2026'}, expected=400)
        self.setup_account()
        paper = self.create()
        backup = self.call('GET', '/api/backup', raw=True)
        self.assertNotIn(b'test-user', backup)
        self.process.terminate()
        self.process.wait(timeout=10)
        self.data = self.data / 'new-installation'
        self.data.mkdir()
        self.csrf = ''
        self.reset_client()
        self.start_server()
        self.setup_account('second-user')
        self.call('POST', '/api/restore', {'backup': base64.b64encode(backup).decode(), 'password': 'Test-password-2026'})
        self.assertEqual('second-user', self.call('GET', '/api/session')['username'])
        self.assertEqual(paper['title'], self.call('GET', '/api/papers')[0]['title'])
        self.call('POST', '/api/logout')
        self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'}, expected=401)
        self.csrf = self.call('POST', '/api/login', {'username': 'second-user', 'password': 'Test-password-2026'})['csrf']

    def test_duplicate_start_exits_cleanly_and_keeps_existing_service(self):
        self.setup_account()
        self.create()
        before = (self.data / 'papers.vault').read_bytes()
        duplicate = subprocess.run(['java', '-Dapp.storage=file', '-Dsun.stdout.encoding=UTF-8', '-Dsun.stderr.encoding=UTF-8',
                                    f'-Dapp.port={self.port}', f'-Dapp.data={self.data}',
                                    '-cp', 'out', 'Main'], cwd=ROOT, capture_output=True,
                                   encoding='utf-8', timeout=10)
        self.assertEqual(0, duplicate.returncode)
        self.assertIn('已经在运行', duplicate.stdout)
        self.assertIn(str(self.data), duplicate.stdout)
        self.assertNotIn('Exception', duplicate.stderr)
        self.assertEqual(before, (self.data / 'papers.vault').read_bytes())
        self.assertEqual(1, len(self.call('GET', '/api/papers')))

    def test_occupied_port_reports_configuration_and_releases_lock(self):
        other_data = self.data / 'other-instance'
        result = subprocess.run(['java', '-Dapp.storage=file', '-Dsun.stdout.encoding=UTF-8', '-Dsun.stderr.encoding=UTF-8',
                                 f'-Dapp.port={self.port}', f'-Dapp.data={other_data}',
                                 '-cp', 'out', 'Main'], cwd=ROOT, capture_output=True,
                                encoding='utf-8', timeout=10)
        self.assertEqual(0, result.returncode)
        self.assertIn('已被其他程序占用', result.stdout)
        self.assertIn('-Dapp.port=8088', result.stdout)
        self.assertNotIn('Exception', result.stderr)
        # Bind failure must release the store lock so it can be used immediately.
        probe = subprocess.run(['java', '-Dapp.storage=file', '-Dsun.stdout.encoding=UTF-8', '-Dsun.stderr.encoding=UTF-8',
                                f'-Dapp.port={self.port}', f'-Dapp.data={other_data}',
                                '-cp', 'out', 'Main'], cwd=ROOT, capture_output=True,
                               encoding='utf-8', timeout=10)
        self.assertIn('已被其他程序占用', probe.stdout)
        self.assertNotIn('已经在运行', probe.stdout)

    def test_finance_credentials_history_and_conflicts(self):
        self.setup_account()
        paper = self.create()
        original = dict(paper)
        path = f"/api/papers/{paper['id']}"
        self.assertNotIn('submissionPassword', paper)
        self.assertTrue(paper['hasPassword'])
        self.assertEqual('private-secret-42', self.call('POST', path + '/credentials')['password'])
        for kind, amount in [('incoming_deposit', '2000.01'), ('outgoing_deposit', '1000.02'),
                             ('incoming_balance', '6000.09'), ('outgoing_balance', '2000.18')]:
            paper = self.call('POST', path + '/transactions', {'version': paper['version'], 'type': kind,
                              'amount': amount, 'date': '2026-01-01'}, expected=201)
        self.assertEqual(800010, paper['receivedCents'])
        self.assertEqual(300020, paper['paidCents'])
        self.assertEqual(0, paper['receivableCents'])
        self.assertEqual(0, paper['payableCents'])
        self.assertEqual(499990, paper['netCents'])
        self.call('PUT', path, self.payload(original), expected=409)
        paper = self.call('PUT', path, self.payload(paper, journal='测试期刊', status='已投稿', submittedAt='2026-01-02'))
        self.assertEqual(2, len(paper['history']))
        self.assertEqual('private-secret-42', self.call('POST', path + '/credentials')['password'])
        listing = self.call('GET', '/api/papers')
        self.assertNotIn('submissionPassword', listing[0])
        self.assertNotIn('history', listing[0])
        txid = paper['transactions'][0]['id']
        paper = self.call('DELETE', path + '/transactions/' + txid, {'version': paper['version']})
        self.assertEqual(200001, paper['receivableCents'])
        paper = self.call('PUT', path, self.payload(paper, submissionPassword=''))
        self.assertFalse(paper['hasPassword'])
        self.call('DELETE', path, {'version': paper['version']})
        self.assertEqual([], self.call('GET', '/api/papers'))

    def test_validation_and_failed_changes_are_atomic(self):
        self.setup_account()
        for changes in [{'title': ''}, {'writerFee': '-1'}, {'writerFee': '0.001'}, {'writerFee': '1000001'},
                        {'status': 'unknown'}, {'submittedAt': '2026-02-30'}, {'submittedAt': '2999-01-01'},
                        {'boundEmail': 'bad'}, {'submissionUrl': 'javascript:alert(1)'}]:
            with self.subTest(changes=changes):
                payload = {'title': 'test', 'status': '待投稿', 'writerFee': '100', 'contractAmount': '200', **changes}
                self.call('POST', '/api/papers', payload, expected=400)
        paper = self.create()
        path = f"/api/papers/{paper['id']}"
        self.call('POST', path + '/transactions', {'version': paper['version'], 'type': 'incoming_deposit',
                  'amount': '0', 'date': '2026-01-01'}, expected=400)
        self.call('POST', path + '/transactions', {'version': paper['version'], 'type': 'outgoing_other',
                  'amount': '100', 'date': '2999-01-01'}, expected=400)
        self.assertEqual([], self.call('GET', path)['transactions'])
        self.assertEqual(1, self.call('GET', path)['version'])

    def test_other_expenses_do_not_settle_writer_or_customer_balances(self):
        self.setup_account()
        paper = self.create()
        path = f"/api/papers/{paper['id']}"
        for kind, amount in [('incoming_deposit', '2000.01'), ('outgoing_deposit', '1000.02'),
                             ('incoming_other', '500.03'), ('outgoing_other', '300.04')]:
            paper = self.call('POST', path + '/transactions', {'version': paper['version'], 'type': kind,
                              'amount': amount, 'date': '2026-01-01'}, expected=201)
        self.assertEqual(250004, paper['receivedCents'])
        self.assertEqual(130006, paper['paidCents'])
        self.assertEqual(200001, paper['contractReceivedCents'])
        self.assertEqual(100002, paper['writerPaidCents'])
        self.assertEqual(50003, paper['otherIncomeCents'])
        self.assertEqual(30004, paper['otherExpenseCents'])
        self.assertEqual(600009, paper['receivableCents'])
        self.assertEqual(200018, paper['payableCents'])
        self.assertEqual(119998, paper['netCents'])

    def test_failed_login_attempts_are_rate_limited(self):
        self.setup_account()
        for _ in range(5):
            self.call('POST', '/api/login', {'username': 'test-user', 'password': 'wrong-password'}, expected=401)
        self.call('POST', '/api/login', {'username': 'test-user', 'password': 'wrong-password'}, expected=429)

    def test_encryption_restart_backup_restore_and_password_change(self):
        self.setup_account()
        paper = self.create()
        backup = self.call('GET', '/api/backup', raw=True)
        for secret in [paper['title'], 'private-secret-42', 'test-account', 'test-user', '13800000000', 'Test-password-2026']:
            self.assertNotIn(secret.encode(), backup)
        self.create(title='第二篇，应在恢复后消失')
        self.call('POST', '/api/restore', {'backup': base64.b64encode(backup).decode(), 'password': 'wrong'}, expected=400)
        self.assertEqual(2, len(self.call('GET', '/api/papers')))
        tampered = bytearray(backup)
        tampered[-1] ^= 1
        self.call('POST', '/api/restore', {'backup': base64.b64encode(tampered).decode(), 'password': 'Test-password-2026'}, expected=400)
        self.assertEqual(2, len(self.call('GET', '/api/papers')))
        result = self.call('POST', '/api/password', {'currentPassword': 'Test-password-2026', 'newPassword': 'New-password-2026'})
        old_csrf = self.csrf
        self.csrf = result['csrf']
        self.call('POST', '/api/papers', {}, expected=403, headers={'X-CSRF-Token': old_csrf})
        self.call('POST', '/api/restore', {'backup': base64.b64encode(backup).decode(), 'password': 'Test-password-2026'})
        self.assertEqual(1, len(self.call('GET', '/api/papers')))
        self.process.terminate()
        self.process.wait(timeout=10)
        self.reset_client()
        self.csrf = ''
        self.start_server()
        self.call('GET', '/api/papers', expected=401)
        self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'}, expected=401)
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'New-password-2026'})['csrf']
        self.assertEqual(paper['title'], self.call('GET', '/api/papers')[0]['title'])
        self.assertEqual('private-secret-42', self.call('POST', f"/api/papers/{paper['id']}/credentials")['password'])

    def test_static_routes_and_json_rejection(self):
        for path in ['/', '/app.js', '/business.js', '/styles.css', '/favicon.svg']:
            self.assertTrue(self.call('GET', path, raw=True))
        self.call('GET', '/data/papers.vault', expected=404)
        self.call('POST', '/api/setup', {}, expected=415, headers={'Content-Type': 'text/plain'})
        request = urllib.request.Request(self.base+'/api/setup', data=b'{"password":"a","password":"b"}',
                                         headers={'Content-Type': 'application/json'}, method='POST')
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.client.open(request)
        self.assertEqual(400, error.exception.code)


if __name__ == '__main__':
    unittest.main()
