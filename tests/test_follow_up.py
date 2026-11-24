"""Follow-up context persists with the plan, including old backup compatibility."""
import base64
import subprocess
from test_system import ApiTestCase, ROOT


class FollowUpTest(ApiTestCase):
    def test_follow_up_context_roundtrip_updates_backup_and_restart(self):
        self.setup_account()
        ids = []
        reason = '客户尚未确认修改意见\n届时联系客户，确认后安排修改。'
        for service in ('full', 'half'):
            paper = self.call('POST', '/api/papers', {
                'title': service + '跟进事项', 'serviceType': service,
                'followUpAt': '2030-01-12', 'followUpReason': '  ' + reason + '  '}, expected=201)
            path = '/api/papers/' + paper['id']
            self.assertEqual(reason, paper['followUpReason'])
            paper = self.call('PUT', path, {'version': paper['version'], 'title': service + '修改标题'})
            self.assertEqual(reason, paper['followUpReason'])
            self.assertEqual('2030-01-12', paper['followUpAt'])
            updated = self.call('PUT', path, {'version': paper['version'], 'followUpReason': '已收到审稿意见，催交修改稿'})
            self.assertTrue(any('催交修改稿' in item['action'] for item in updated['history']))
            self.call('PUT', path, {'version': paper['version'], 'followUpReason': '过期页面'}, expected=409)
            ids.append(paper['id'])
        backup = self.call('GET', '/api/backup', raw=True)
        for paper in self.call('GET', '/api/papers'):
            self.call('PUT', '/api/papers/' + paper['id'], {
                'version': paper['version'], 'followUpAt': '', 'followUpReason': ''})
        self.call('POST', '/api/restore', {'backup': base64.b64encode(backup).decode(), 'password': 'Test-password-2026'})
        self.process.terminate()
        self.process.wait(timeout=10)
        self.reset_client()
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        papers = self.call('GET', '/api/papers')
        self.assertEqual(set(ids), {p['id'] for p in papers})
        for paper in papers:
            self.assertEqual('已收到审稿意见，催交修改稿', paper['followUpReason'])
            self.assertEqual('2030-01-12', paper['followUpAt'])

    def test_new_plan_requires_context_and_failed_updates_are_atomic(self):
        self.setup_account()
        for payload in ({'followUpAt': '2030-01-12'},
                        {'followUpAt': '2030-01-12', 'followUpReason': '   '},
                        {'followUpReason': '长' * 1001}, {'followUpReason': 123}):
            self.call('POST', '/api/papers', {'title': '无效跟进', **payload}, expected=400)
        self.assertEqual([], self.call('GET', '/api/papers'))
        paper = self.call('POST', '/api/papers', {'title': '暂未安排跟进'}, expected=201)
        self.assertEqual('', paper['followUpReason'])
        path = '/api/papers/' + paper['id']
        self.call('PUT', path, {'version': paper['version'], 'followUpAt': '2030-01-12'}, expected=400)
        paper = self.call('PUT', path, {'version': paper['version'], 'followUpAt': '2030-01-12', 'followUpReason': '审' * 1000})
        self.assertEqual(1000, len(paper['followUpReason']))
        for value in ('', '   ', '长' * 1001, 123):
            self.call('PUT', path, {'version': paper['version'], 'followUpReason': value}, expected=400)
            self.assertEqual(paper['version'], self.call('GET', path)['version'])
            self.assertEqual(paper['followUpReason'], self.call('GET', path)['followUpReason'])
        paper = self.call('PUT', path, {'version': paper['version'], 'followUpAt': '', 'followUpReason': ''})
        self.assertEqual('', paper['followUpAt'])
        self.assertEqual('', paper['followUpReason'])

    def test_legacy_backup_keeps_date_and_allows_context_to_be_added(self):
        self.setup_account()
        paper = self.call('POST', '/api/papers', {
            'title': '旧跟进计划', 'followUpAt': '2030-01-12', 'followUpReason': '旧事项'}, expected=201)
        archive = self.data / 'legacy-follow-up.vault'
        archive.write_bytes(self.call('GET', '/api/backup', raw=True))
        helper = self.data / 'follow-up-fixture'
        helper.mkdir(parents=True, exist_ok=True)
        subprocess.run(['javac', '-encoding', 'UTF-8', '--release', '17', '-d', str(helper),
                        *[str(p) for p in (ROOT / 'src').glob('*.java')],
                        str(ROOT / 'tests/FollowUpFixture.java')], cwd=ROOT, check=True, capture_output=True)
        subprocess.run(['java', '-cp', str(helper), 'FollowUpFixture',
                        str(archive), 'Test-password-2026'], cwd=ROOT, check=True, capture_output=True)
        self.call('POST', '/api/restore', {'backup': base64.b64encode(archive.read_bytes()).decode(), 'password': 'Test-password-2026'})
        path = '/api/papers/' + paper['id']
        paper = self.call('GET', path)
        self.assertEqual('2030-01-12', paper['followUpAt'])
        self.assertEqual('', paper['followUpReason'])
        paper = self.call('PUT', path, {'version': paper['version'], 'title': '保留旧计划'})
        self.assertEqual('2030-01-12', paper['followUpAt'])
        self.call('PUT', path, {'version': paper['version'], 'followUpAt': '2030-01-13'}, expected=400)
        paper = self.call('PUT', path, {'version': paper['version'], 'followUpReason': '查询审稿进度'})
        self.assertEqual('查询审稿进度', paper['followUpReason'])
