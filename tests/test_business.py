"""Relationships, multiple submissions and financial rollups against the real server."""
import base64
import json
import pathlib
import subprocess
from datetime import date, timedelta
from test_system import ApiTestCase, ROOT


class BusinessTest(ApiTestCase):
    def test_delivery_date_synchronizes_status_and_stops_overdue(self):
        self.setup_account()
        today = date.today()
        start, due, delivered = (today - timedelta(days=3)).isoformat(), (today - timedelta(days=1)).isoformat(), today.isoformat()
        for status in ('待分配', '写作中', '待修改', '已交稿', '已完成', '已取消'):
            with self.subTest(status=status):
                paper = self.call('POST', '/api/papers', {
                    'title': '交稿状态-' + status, 'writingStatus': status,
                    'writingStartAt': start, 'writingDueAt': due, 'writingDeliveredAt': delivered}, expected=201)
                expected = '已交稿' if status in ('待分配', '写作中') else status
                self.assertEqual(expected, paper['writingStatus'])
                self.assertFalse(paper['writingOverdue'])
                self.assertEqual(delivered, paper['writingDeliveredAt'])
                self.assertEqual(3, paper['writingDays'])
        paper = self.call('POST', '/api/papers', {
            'title': '先写作再交稿', 'writingStatus': '写作中',
            'writingStartAt': start, 'writingDueAt': due}, expected=201)
        path = '/api/papers/' + paper['id']
        self.assertTrue(paper['writingOverdue'])
        paper = self.call('PUT', path, {'version': paper['version'], 'writingDeliveredAt': delivered})
        self.assertEqual('已交稿', paper['writingStatus'])
        self.assertFalse(paper['writingOverdue'])
        self.call('PUT', path, {'version': paper['version'], 'writingDeliveredAt': (today + timedelta(days=1)).isoformat()}, expected=400)
        self.assertEqual(paper['version'], self.call('GET', path)['version'])
        self.call('PUT', path, {'version': paper['version'], 'writingDeliveredAt': (today - timedelta(days=4)).isoformat()}, expected=400)
        self.assertEqual(paper['version'], self.call('GET', path)['version'])
        paper = self.call('PUT', path, {'version': paper['version'], 'writingStatus': '写作中', 'writingDeliveredAt': ''})
        self.assertEqual('写作中', paper['writingStatus'])
        self.assertTrue(paper['writingOverdue'])
        paper = self.call('PUT', path, {'version': paper['version'], 'writingStatus': '已完成'})
        self.assertEqual(delivered, paper['writingDeliveredAt'])
        self.assertFalse(paper['writingOverdue'])

    def test_legacy_delivered_writing_records_are_consistent_in_every_view(self):
        self.setup_account()
        customer = self.call('POST', '/api/customers', {'name': '交稿回归客户'}, expected=201)
        today = date.today()
        paper = self.call('POST', '/api/papers', {
            'title': '已有交稿日期的旧记录', 'customerId': customer['id'], 'writingStatus': '已交稿',
            'writingStartAt': (today - timedelta(days=3)).isoformat(),
            'writingDueAt': (today - timedelta(days=1)).isoformat(), 'writingDeliveredAt': today.isoformat()}, expected=201)
        archive = self.data / 'legacy-writing.vault'
        archive.write_bytes(self.call('GET', '/api/backup', raw=True))
        helper = self.data / 'writing-fixture'
        helper.mkdir()
        subprocess.run(['javac', '-encoding', 'UTF-8', '--release', '17', '-d', str(helper),
                        *[str(p) for p in (ROOT / 'src').glob('*.java')],
                        str(ROOT / 'tests/WritingFixture.java')], cwd=ROOT, check=True, capture_output=True)
        subprocess.run(['java', '-cp', str(helper), 'WritingFixture',
                        str(archive), 'Test-password-2026'], cwd=ROOT, check=True, capture_output=True)
        self.call('POST', '/api/restore', {'backup': base64.b64encode(archive.read_bytes()).decode(), 'password': 'Test-password-2026'})
        path = '/api/papers/' + paper['id']
        views = [self.call('GET', path), self.call('GET', '/api/papers')[0],
                 self.call('GET', '/api/customers/' + customer['id'])['papers'][0]]
        for result in views:
            self.assertEqual('已交稿', result['writingStatus'])
            self.assertFalse(result['writingOverdue'])
            self.assertEqual(3, result['writingDays'])
            self.assertEqual(paper['version'], result['version'])
            self.assertEqual(today.isoformat(), result['writingDeliveredAt'])
        paper = self.call('PUT', path, {'version': paper['version'], 'notes': '保留原始交稿日期'})
        self.process.terminate()
        self.process.wait(timeout=10)
        self.reset_client()
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        restored = self.call('GET', path)
        self.assertEqual('已交稿', restored['writingStatus'])
        self.assertFalse(restored['writingOverdue'])
        self.assertEqual(today.isoformat(), restored['writingDeliveredAt'])

    def test_customer_deposit_terms_persist_without_creating_payments(self):
        self.setup_account()
        customer = self.call('POST', '/api/customers', {'name': '定金约定客户'}, expected=201)
        papers = []
        for service in ('full', 'half'):
            paper = self.call('POST', '/api/papers', {'title': service + '客户收款约定', 'serviceType': service,
                              'customerId': customer['id'], 'contractAmount': '3000.10',
                              'contractDepositAmount': '1000.05', 'contractBalanceAmount': '9999'}, expected=201)
            path = f"/api/papers/{paper['id']}"
            self.assertEqual(100005, paper['contractDepositCents'])
            self.assertEqual(200005, paper['contractBalanceCents'])
            self.assertEqual(0, paper['receivedCents'])
            self.assertEqual(300010, paper['receivableCents'])
            self.assertEqual([], paper['transactions'])
            if service == 'full':
                paper = self.call('PUT', path, {'version': paper['version'], 'writerFee': '500', 'writerDepositAmount': '100'})
                self.assertEqual(10000, paper['writerDepositCents'])
                self.assertEqual(100005, paper['contractDepositCents'])
            paper = self.call('PUT', path, {'version': paper['version'], 'title': '更新题目-' + service})
            self.assertEqual(100005, paper['contractDepositCents'])
            for changes in ({'contractDepositAmount': '3000.11'}, {'contractAmount': '1000'},
                            {'contractDepositAmount': '-1'}, {'contractDepositAmount': '0.001'}):
                self.call('PUT', path, {'version': paper['version'], **changes}, expected=400)
                self.assertEqual(paper['version'], self.call('GET', path)['version'])
                self.assertEqual(100005, self.call('GET', path)['contractDepositCents'])
            paper = self.call('POST', path + '/transactions', {'version': paper['version'], 'type': 'incoming_deposit',
                              'amount': '250', 'date': '2026-01-01'}, expected=201)
            self.assertEqual(25000, paper['receivedCents'])
            self.assertEqual(275010, paper['receivableCents'])
            self.assertEqual(100005, paper['contractDepositCents'])
            paper = self.call('POST', path + '/submissions', {'version': paper['version'], 'journal': '改投期刊'}, expected=201)
            self.assertEqual(100005, paper['contractDepositCents'])
            self.assertEqual(200005, paper['contractBalanceCents'])
            papers.append(paper)
        backup = self.call('GET', '/api/backup', raw=True)
        for paper in papers:
            self.call('PUT', f"/api/papers/{paper['id']}", {'version': paper['version'], 'contractDepositAmount': '0'})
        self.call('POST', '/api/restore', {'backup': base64.b64encode(backup).decode(), 'password': 'Test-password-2026'})
        self.process.terminate()
        self.process.wait(timeout=10)
        self.reset_client()
        self.csrf = ''
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        restored = self.call('GET', '/api/papers')
        self.assertEqual(2, len(restored))
        for paper in restored:
            self.assertEqual(100005, paper['contractDepositCents'])
            self.assertEqual(200005, paper['contractBalanceCents'])
            self.assertEqual(25000, paper['receivedCents'])

    def test_delete_paper_preserves_customer_and_other_papers_after_restart(self):
        self.setup_account()
        customer = self.call('POST', '/api/customers', {'name': '保留的客户'}, expected=201)
        paper = self.call('POST', '/api/papers', {'title': '要删除的全包论文', 'serviceType': 'full',
                          'customerId': customer['id'], 'writer': '写作人', 'writingStatus': '写作中',
                          'contractAmount': '1000', 'writerFee': '300'}, expected=201)
        path = f"/api/papers/{paper['id']}"
        for journal in ('原投期刊', '改投期刊'):
            paper = self.call('POST', path + '/submissions', {'version': paper['version'],
                              'journal': journal, 'submissionAccount': 'test-account',
                              'submissionPassword': 'disposable-test-secret'}, expected=201)
        paper = self.call('POST', path + '/transactions', {'version': paper['version'],
                          'type': 'incoming_deposit', 'amount': '100', 'date': '2026-01-01'}, expected=201)
        paper = self.call('POST', path + '/transactions', {'version': paper['version'],
                          'type': 'outgoing_deposit', 'amount': '50', 'date': '2026-01-02'}, expected=201)
        other = self.call('POST', '/api/papers', {'title': '保留的半包论文', 'serviceType': 'half',
                          'customerId': customer['id'], 'contractAmount': '200'}, expected=201)
        other_path = f"/api/papers/{other['id']}"
        other = self.call('POST', other_path + '/transactions', {'version': other['version'],
                          'type': 'incoming_deposit', 'amount': '30', 'date': '2026-01-03'}, expected=201)
        other = self.call('GET', other_path)
        stale_version = paper['version']
        paper = self.call('PUT', path, {'version': paper['version'], 'title': '其他页面已修改的论文'})
        paper = self.call('GET', path)
        self.call('DELETE', path, {'version': stale_version}, expected=409)
        self.assertEqual(paper, self.call('GET', path))
        self.deleted_paper_id = paper['id']
        self.deleted_submission_ids = [item['id'] for item in paper['submissions']]
        self.assertEqual(2, len(self.deleted_submission_ids))
        self.assertEqual(2, len(paper['transactions']))
        self.call('DELETE', path, {'version': paper['version']})
        self.call('GET', path, expected=404)
        for submission_id in self.deleted_submission_ids:
            self.call('POST', path + f'/submissions/{submission_id}/credentials', expected=404)
        self.assertEqual({other['id']}, {item['id'] for item in self.call('GET', '/api/papers')})
        self.assertEqual(other, self.call('GET', other_path))
        summary = self.call('GET', f"/api/customers/{customer['id']}")
        self.assertEqual(1, summary['paperCount'])
        self.assertEqual(20000, summary['contractCents'])
        self.assertEqual(3000, summary['receivedCents'])
        self.assertEqual(17000, summary['receivableCents'])
        self.process.terminate(); self.process.wait(timeout=10)
        self.reset_client(); self.csrf = ''; self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username':'test-user','password':'Test-password-2026'})['csrf']
        self.call('GET', path, expected=404)
        self.assertEqual({other['id']}, {item['id'] for item in self.call('GET', '/api/papers')})
        self.assertEqual(other, self.call('GET', other_path))
        self.assertEqual(1, self.call('GET', f"/api/customers/{customer['id']}")['paperCount'])

    def test_resubmission_journal_history_is_persistent_and_scoped_to_each_paper(self):
        self.setup_account()
        first = self.call('POST', '/api/papers', {'title': '同名论文'}, expected=201)
        second = self.call('POST', '/api/papers', {'title': '同名论文'}, expected=201)
        first_path, second_path = f"/api/papers/{first['id']}", f"/api/papers/{second['id']}"
        second = self.call('POST', second_path + '/submissions', {'version': second['version'],
                           'journal': '另一篇论文的专属期刊'}, expected=201)
        for submission in [
            {'journal': '期刊甲', 'title': '首次投稿题目', 'status': '已拒稿', 'submittedAt': '2026-01-01',
             'endedAt': '2026-01-15', 'notes': '原期刊拒稿原因', 'submissionPassword': 'first-journal-secret'},
            {'journal': '期刊乙', 'title': '改投后的题目', 'status': '已撤稿', 'submittedAt': '2026-02-01',
             'endedAt': '2026-02-10', 'notes': '撤稿后继续改投'},
            {'journal': '期刊甲', 'title': '同一期刊再次投稿的题目', 'status': '待投稿'},
        ]:
            first = self.call('POST', first_path + '/submissions', {'version': first['version'], **submission}, expected=201)
        before = self.call('GET', first_path)
        self.assertEqual(['期刊甲', '期刊乙', '期刊甲'], [s['journal'] for s in before['submissions']])
        self.assertEqual(3, len({s['id'] for s in before['submissions']}))
        self.assertEqual(before['submissions'][-1]['id'], before['activeSubmissionId'])
        self.process.terminate()
        self.process.wait(timeout=10)
        self.reset_client()
        self.csrf = ''
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        restored = self.call('GET', first_path)
        self.assertEqual(before['submissions'], restored['submissions'])
        self.assertEqual(before['activeSubmissionId'], restored['activeSubmissionId'])
        self.assertEqual('first-journal-secret', self.call('POST', first_path + f"/submissions/{before['submissions'][0]['id']}/credentials")['password'])
        self.assertEqual(['另一篇论文的专属期刊'], [s['journal'] for s in self.call('GET', second_path)['submissions']])

    def test_schema2_backup_without_service_type_preserves_writing(self):
        self.setup_account()
        fixture = self.data / 'old-schema2'
        fixture.mkdir()
        subprocess.run(['javac', '-encoding', 'UTF-8', '--release', '17', '-d', 'out',
                        *[str(p) for p in (ROOT / 'src').glob('*.java')], str(ROOT / 'tests' / 'LegacyFixture.java')],
                       cwd=ROOT, check=True, capture_output=True)
        subprocess.run(['java', '-cp', 'out', 'LegacyFixture', str(fixture), '2'], cwd=ROOT, check=True, capture_output=True)
        backup = (fixture / 'papers.vault').read_bytes()
        self.call('POST', '/api/restore', {'backup': base64.b64encode(backup).decode(), 'password': 'Test-password-2026'})
        paper = self.call('GET', '/api/papers')[0]
        self.assertEqual('full', paper['serviceType'])
        self.assertEqual('旧写作者', paper['writer'])
        self.assertEqual(0, paper['contractDepositCents'])
        self.assertEqual(paper['contractCents'], paper['contractBalanceCents'])
        self.assertEqual(120000, paper['paidCents'])
        self.assertEqual(1, len(paper['submissions']))
        saved = self.call('PUT', f"/api/papers/{paper['id']}", {'version': paper['version'], 'title': '旧数据更新'})
        self.assertEqual('full', saved['serviceType'])
        self.assertEqual('旧写作者', saved['writer'])

    def test_full_and_half_service_types_persist_with_independent_workflows(self):
        self.setup_account()
        customer = self.call('POST', '/api/customers', {'name': '全包与半包客户'}, expected=201)
        full = self.call('POST', '/api/papers', {'title': '需要写作的全包论文', 'serviceType': 'full',
                         'customerId': customer['id'], 'writer': '写作人', 'writingStatus': '写作中',
                         'writerFee': '1000', 'writerDepositAmount': '200', 'contractAmount': '3000'}, expected=201)
        half = self.call('POST', '/api/papers', {'title': '客户提供的半包论文', 'serviceType': 'half',
                         'customerId': customer['id'], 'journal': '半包投稿期刊', 'contractAmount': '1500'}, expected=201)
        path = f"/api/papers/{half['id']}"
        self.assertEqual('full', full['serviceType'])
        self.assertEqual('写作中', full['writingStatus'])
        self.assertEqual('half', half['serviceType'])
        self.assertEqual('', half['writingStatus'])
        self.assertEqual('', half['writer'])
        self.assertEqual(0, half['writerFeeCents'])
        self.assertEqual(0, half['writerDepositCents'])
        self.assertEqual(0, half['payableCents'])
        self.assertIsNone(half['writingDays'])
        self.assertFalse(half['writingOverdue'])
        self.assertEqual(1, len(half['submissions']))
        self.assertEqual('半包投稿期刊', half['submissions'][0]['journal'])
        for kind in ['outgoing_deposit', 'outgoing_balance']:
            self.call('POST', path + '/transactions', {'version': half['version'], 'type': kind,
                      'amount': '100', 'date': '2026-01-01'}, expected=400)
        half = self.call('POST', path + '/transactions', {'version': half['version'], 'type': 'incoming_deposit',
                         'amount': '500', 'date': '2026-01-01'}, expected=201)
        half = self.call('POST', path + '/transactions', {'version': half['version'], 'type': 'outgoing_other',
                         'amount': '100', 'date': '2026-01-01'}, expected=201)
        half = self.call('PUT', path, {'version': half['version'], 'title': '半包论文更新'})
        self.assertEqual('half', half['serviceType'])
        self.assertEqual(10000, half['otherExpenseCents'])
        self.assertEqual(0, half['writerPaidCents'])
        summary = self.call('GET', f"/api/customers/{customer['id']}")
        self.assertEqual(2, summary['paperCount'])
        self.assertEqual(450000, summary['contractCents'])
        self.assertEqual(100000, summary['writerFeeCents'])
        backup = self.call('GET', '/api/backup', raw=True)
        self.call('DELETE', path, {'version': half['version']})
        self.call('POST', '/api/restore', {'backup': base64.b64encode(backup).decode(), 'password': 'Test-password-2026'})
        self.process.terminate()
        self.process.wait(timeout=10)
        self.reset_client()
        self.csrf = ''
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        restored = self.call('GET', path)
        self.assertEqual('half', restored['serviceType'])
        self.assertEqual('', restored['writingStatus'])
        self.assertEqual(2, len(restored['transactions']))
        self.assertEqual('full', self.call('GET', f"/api/papers/{full['id']}")['serviceType'])

    def test_service_type_validation_prevents_accidental_writing_data_loss(self):
        self.setup_account()
        for invalid in ['unknown', '', None, 123]:
            self.call('POST', '/api/papers', {'title': '无效服务类型', 'serviceType': invalid}, expected=400)
        for values in [{'writer': '写作人'}, {'writingStatus': '写作中'}, {'writerFee': '100'},
                       {'writerDepositAmount': '100'}, {'writingDueAt': '2026-12-01'}]:
            self.call('POST', '/api/papers', {'title': '半包不能带写作安排', 'serviceType': 'half', **values}, expected=400)
        self.assertEqual([], self.call('GET', '/api/papers'))
        full = self.call('POST', '/api/papers', {'title': '保留旧写作数据', 'writer': '旧写作人', 'writerFee': '100'}, expected=201)
        path = f"/api/papers/{full['id']}"
        self.assertEqual('full', full['serviceType'])
        self.call('PUT', path, {'version': full['version'], 'serviceType': 'half'}, expected=400)
        reloaded = self.call('GET', path)
        self.assertEqual('full', reloaded['serviceType'])
        self.assertEqual('旧写作人', reloaded['writer'])
        self.assertEqual(full['version'], reloaded['version'])

    def test_customer_cooperation_date_persistence_validation_and_backup(self):
        self.setup_account()
        customer = self.call('POST', '/api/customers', {'name': '合作时间测试'}, expected=201)
        path = f"/api/customers/{customer['id']}"
        self.assertEqual('', customer['cooperationStartedAt'])
        for invalid in ['2026-02-30', '2026-1-1', '2999-01-01', '0001-01-01', 123]:
            self.call('PUT', path, {'version': customer['version'], 'cooperationStartedAt': invalid}, expected=400)
        unchanged = self.call('GET', path)
        self.assertEqual(customer['version'], unchanged['version'])
        self.assertEqual('', unchanged['cooperationStartedAt'])
        customer = self.call('PUT', path, {'version': customer['version'], 'cooperationStartedAt': '2026-01-12'})
        customer = self.call('PUT', path, {'version': customer['version'], 'name': '合作客户（更名）'})
        self.assertEqual('2026-01-12', customer['cooperationStartedAt'])
        self.call('PUT', path, {'version': 1, 'cooperationStartedAt': '2026-01-13'}, expected=409)
        backup = self.call('GET', '/api/backup', raw=True)
        customer = self.call('PUT', path, {'version': customer['version'], 'cooperationStartedAt': ''})
        self.assertEqual('', self.call('GET', path)['cooperationStartedAt'])
        self.call('POST', '/api/restore', {'backup': base64.b64encode(backup).decode(), 'password': 'Test-password-2026'})
        self.process.terminate()
        self.process.wait(timeout=10)
        self.reset_client()
        self.csrf = ''
        self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        self.assertEqual('2026-01-12', self.call('GET', path)['cooperationStartedAt'])
        self.assertEqual('2026-01-12', self.call('GET', '/api/customers')[0]['cooperationStartedAt'])

    def test_customer_writing_submission_finance_relationships(self):
        self.setup_account()
        customer = self.call('POST', '/api/customers', {'name': '客户甲', 'phone': '13800000001',
                             'email': 'client@example.com', 'organization': '研究所'}, expected=201)
        paper = self.call('POST', '/api/papers', {'title': '原始写作题目', 'customerId': customer['id'],
                          'writer': '写作人乙', 'writingStatus': '写作中', 'writingStartAt': '2026-01-01',
                          'writingDueAt': '2026-01-15', 'writerFee': '3000.20', 'writerDepositAmount': '1000.05',
                          'contractAmount': '8000.10'}, expected=201)
        path = f"/api/papers/{paper['id']}"
        self.assertEqual([], paper['submissions'])
        self.assertEqual(200015, paper['writerBalanceCents'])
        self.assertTrue(paper['writingOverdue'])
        self.assertEqual(customer['id'], paper['customerId'])
        first = self.call('POST', path + '/submissions', {'version': paper['version'], 'title': '第一次投稿题目',
                          'journal': '期刊甲', 'status': '已发表', 'submittedAt': '2026-01-03',
                          'endedAt': '2026-02-03', 'publishedAt': '2026-03-03',
                          'submissionAccount': 'first-account', 'submissionPassword': 'first-secret'}, expected=201)
        first_id = first['submissions'][0]['id']
        self.assertEqual(31, first['submissions'][0]['durationDays'])
        self.assertTrue(first['published'])
        second = self.call('POST', path + '/submissions', {'version': first['version'], 'journal': '期刊乙',
                           'title': '另一个投稿题目', 'status': '审稿中', 'submittedAt': '2026-03-05',
                           'boundPhone': '13800000002', 'boundEmail': 'submit@example.com',
                           'submissionPassword': 'second-secret'}, expected=201)
        second_id = second['activeSubmissionId']
        self.assertEqual(2, len(second['submissions']))
        self.assertEqual('期刊乙', second['journal'])
        self.assertEqual('原始写作题目', second['title'])
        self.assertEqual(['期刊甲'], second['publishedJournals'])
        for endpoint in ['/api/papers', '/api/customers', f"/api/customers/{customer['id']}", path]:
            encoded = json.dumps(self.call('GET', endpoint))
            self.assertNotIn('first-secret', encoded)
            self.assertNotIn('second-secret', encoded)
            self.assertNotIn('submissionPassword', encoded)
        self.assertEqual('first-secret', self.call('POST', path + f'/submissions/{first_id}/credentials')['password'])
        self.assertEqual('second-secret', self.call('POST', path + f'/submissions/{second_id}/credentials')['password'])
        for kind, amount in [('incoming_deposit', '2000.01'), ('outgoing_deposit', '1000.05')]:
            second = self.call('POST', path + '/transactions', {'version': second['version'], 'type': kind,
                               'amount': amount, 'date': '2026-01-01'}, expected=201)
        summary = self.call('GET', f"/api/customers/{customer['id']}")
        self.assertEqual(1, summary['paperCount'])
        self.assertEqual(1, summary['publishedPaperCount'])
        self.assertEqual(['期刊甲'], summary['publishedJournals'])
        self.assertEqual(800010, summary['contractCents'])
        self.assertEqual(200001, summary['receivedCents'])
        self.assertEqual(600009, summary['receivableCents'])
        self.call('DELETE', f"/api/customers/{customer['id']}", {'version': customer['version']}, expected=409)
        renamed = self.call('PUT', f"/api/customers/{customer['id']}", {'version': customer['version'], 'name': '客户甲（新名称）'})
        self.assertEqual('客户甲（新名称）', self.call('GET', path)['customer'])
        self.call('PUT', f"/api/customers/{customer['id']}", {'version': customer['version'], 'name': '旧页面修改'}, expected=409)
        updated = self.call('PUT', path, {'version': second['version'], 'title': '修改后的写作题目',
                            'writingStatus': '已交稿', 'writingDeliveredAt': '2026-01-12'})
        self.assertEqual('修改后的写作题目', updated['title'])
        self.assertEqual('另一个投稿题目', updated['submissions'][1]['title'])
        self.assertEqual('期刊乙', updated['journal'])
        self.assertEqual(11, updated['writingDays'])
        self.assertFalse(updated['writingOverdue'])
        self.assertEqual('second-secret', self.call('POST', path + f'/submissions/{second_id}/credentials')['password'])
        self.call('POST', path + '/submissions', {'version': second['version'], 'journal': '过期页面'}, expected=409)
        updated = self.call('DELETE', path + f'/submissions/{second_id}', {'version': updated['submissions'][1]['version']})
        self.assertEqual(first_id, updated['activeSubmissionId'])
        self.assertEqual('期刊甲', updated['journal'])
        self.assertEqual(200001, updated['contractReceivedCents'])
        reloaded = self.call('GET', path)
        self.assertEqual(first_id, reloaded['activeSubmissionId'])
        self.assertEqual('期刊甲', reloaded['journal'])
        self.call('DELETE', path, {'version': updated['version']})
        self.assertEqual(0, self.call('GET', f"/api/customers/{customer['id']}")['paperCount'])


    def test_submission_edits_keep_identity_count_and_current_pointer(self):
        self.setup_account()
        paper = self.call('POST', '/api/papers', {'title': '编辑投稿回归'}, expected=201)
        path = f"/api/papers/{paper['id']}"
        paper = self.call('POST', path + '/submissions', {
            'version': paper['version'], 'journal': '原期刊', 'submissionPassword': 'retained-test-secret'}, expected=201)
        original_id = paper['activeSubmissionId']
        for status in ['修改中', '已录用', '已发表', '修改中']:
            sub = paper['submissions'][0]
            paper = self.call('PUT', path + '/submissions/' + original_id, {
                'version': sub['version'], 'status': status, 'submittedAt': '2026-01-01', **({'endedAt':'2026-02-01'} if status=='已录用' else {})})
            self.assertEqual([original_id], [s['id'] for s in paper['submissions']])
            self.assertEqual(original_id, paper['activeSubmissionId'])
            self.assertEqual(status, paper['status'])
            self.assertEqual(status, paper['submissions'][0]['status'])
            self.assertEqual(sub['version'] + 1, paper['submissions'][0]['version'])
        paper = self.call('GET', path)
        self.call('PUT', path + '/submissions/missing-record', {'version': 1, 'journal': '意外新增'}, expected=404)
        self.call('PUT', path + '/submissions/' + original_id, {'version': 1, 'status': '已发表'}, expected=409)
        self.assertEqual(paper, self.call('GET', path))
        paper = self.call('POST', path + '/submissions', {
            'version': paper['version'], 'journal': '改投期刊', 'status': '审稿中', 'submittedAt': '2026-02-01'}, expected=201)
        paper = self.call('GET', path)
        current_id = paper['activeSubmissionId']
        current = paper['submissions'][1].copy()
        sub = paper['submissions'][0]
        paper = self.call('PUT', path + '/submissions/' + original_id, {
            'version': sub['version'], 'status': '已拒稿', 'notes': '只修改历史投稿'})
        self.assertEqual([original_id, current_id], [s['id'] for s in paper['submissions']])
        self.assertEqual(current_id, paper['activeSubmissionId'])
        self.assertEqual(current, paper['submissions'][1])
        self.assertEqual('审稿中', paper['status'])
        self.assertEqual('retained-test-secret', self.call('POST', path + '/submissions/' + original_id + '/credentials')['password'])
        paper = self.call('PUT', path, {'version': paper['version'], 'title': '仅修改论文档案'})
        self.assertEqual([original_id, current_id], [s['id'] for s in paper['submissions']])

    def test_duplicate_journal_creation_is_atomic_and_existing_edits_still_work(self):
        self.setup_account()
        paper = self.call('POST', '/api/papers', {'title': '同名论文'}, expected=201)
        path = f"/api/papers/{paper['id']}"
        paper = self.call('POST', path + '/submissions', {
            'version': paper['version'], 'journal': 'Nature Communications', 'status': '修改中',
            'submittedAt': '2026-01-01'}, expected=201)
        paper = self.call('GET', path)
        for journal in ['Nature Communications', ' nature communications ', 'ＮＡＴＵＲＥ　ＣＯＭＭＵＮＩＣＡＴＩＯＮＳ']:
            self.call('POST', path + '/submissions', {'version': paper['version'], 'journal': journal}, expected=409)
            self.assertEqual(paper, self.call('GET', path))
        original_id = paper['activeSubmissionId']
        paper = self.call('PUT', path + '/submissions/' + original_id, {
            'version': paper['submissions'][0]['version'], 'status': '已发表'})
        paper = self.call('GET', path)
        error = self.call('POST', path + '/submissions', {
            'version': paper['version'], 'journal': 'nature communications'}, expected=409)
        self.assertIn('已发表', error['error'])
        self.assertEqual(paper, self.call('GET', path))
        other = self.call('POST', '/api/papers', {'title': '同名论文'}, expected=201)
        other = self.call('POST', f"/api/papers/{other['id']}/submissions", {
            'version': other['version'], 'journal': 'nature communications'}, expected=201)
        self.assertEqual(1, len(other['submissions']))
        paper = self.call('POST', path + '/submissions', {
            'version': paper['version'], 'journal': '其他期刊'}, expected=201)
        paper = self.call('GET', path)
        current = paper['submissions'][1]
        self.call('PUT', path + '/submissions/' + current['id'], {
            'version': current['version'], 'journal': 'Ｎａｔｕｒｅ Communications'}, expected=409)
        self.assertEqual(paper, self.call('GET', path))

    def test_reopening_an_old_attempt_cannot_duplicate_an_active_attempt(self):
        self.setup_account()
        paper = self.call('POST', '/api/papers', {'title': '再次投稿'}, expected=201)
        path = f"/api/papers/{paper['id']}"
        paper = self.call('POST', path + '/submissions', {
            'version': paper['version'], 'journal': '同一期刊', 'status': '已拒稿',
            'submittedAt': '2026-01-01', 'endedAt': '2026-01-15'}, expected=201)
        old = paper['submissions'][0]
        paper = self.call('POST', path + '/submissions', {
            'version': paper['version'], 'journal': '同一期刊', 'status': '修改中', 'submittedAt': '2026-02-01'}, expected=201)
        paper = self.call('GET', path)
        self.call('PUT', path + '/submissions/' + old['id'], {
            'version': old['version'], 'status': '修改中'}, expected=409)
        self.assertEqual(paper, self.call('GET', path))
        paper = self.call('PUT', path + '/submissions/' + old['id'], {
            'version': old['version'], 'notes': '补充原投稿的拒稿原因'})
        self.assertEqual('已拒稿', paper['submissions'][0]['status'])
        self.assertEqual('修改中', paper['submissions'][1]['status'])
        self.assertEqual(2, len(paper['submissions']))

    def test_submission_version_validation_and_preserve_hidden_password(self):
        self.setup_account()
        paper = self.call('POST', '/api/papers', {'title': '关联论文'}, expected=201)
        path = f"/api/papers/{paper['id']}"
        for changes in [{'journal': ''}, {'status': 'unknown'}, {'status': '审稿中'}, {'submittedAt': '2026-02-30'},
                        {'submissionUrl': 'javascript:alert(1)'}, {'boundEmail': 'invalid'},
                        {'status': '已拒稿', 'submittedAt': '2026-01-10', 'endedAt': '2026-01-01'}]:
            self.call('POST', path+'/submissions', {'version': paper['version'], 'journal': '测试期刊', **changes}, expected=400)
        self.assertEqual([], self.call('GET', path)['submissions'])
        paper = self.call('POST', path+'/submissions', {'version': paper['version'], 'journal': '测试期刊',
                          'status': '审稿中', 'submittedAt': '2026-01-01', 'submissionPassword': 'kept-secret'}, expected=201)
        sub = paper['submissions'][0]
        paper = self.call('PUT', path+f"/submissions/{sub['id']}", {'version': sub['version'], 'status': '已拒稿', 'endedAt': '2026-01-15'})
        self.assertEqual(14, paper['submissions'][0]['durationDays'])
        self.assertEqual('kept-secret', self.call('POST', path+f"/submissions/{sub['id']}/credentials")['password'])
        self.call('PUT', path+f"/submissions/{sub['id']}", {'version': sub['version'], 'journal': '过期更新'}, expected=409)
        sub = paper['submissions'][0]
        paper = self.call('PUT', path+f"/submissions/{sub['id']}", {'version': sub['version'], 'status': '审稿中'})
        self.assertEqual('', paper['submissions'][0]['endedAt'])
        self.assertEqual('', paper['submissions'][0]['publishedAt'])
        self.assertGreater(paper['submissions'][0]['durationDays'], 14)
        sub = paper['submissions'][0]
        paper = self.call('PUT', path+f"/submissions/{sub['id']}", {'version': sub['version'], 'submissionPassword': ''})
        self.assertFalse(paper['submissions'][0]['hasPassword'])
        self.assertFalse(paper['hasPassword'])


    def test_writing_validation_customer_identity_and_reassignment(self):
        self.setup_account()
        for values in [{'writerFee':'100','writerDepositAmount':'101'}, {'writingStatus':'invalid'},
                       {'writingStartAt':'2026-02-01','writingDueAt':'2026-01-01'},
                       {'writingDeliveredAt':'2999-01-01'}, {'customerId':'non-existent'}]:
            self.call('POST', '/api/papers', {'title':'校验', **values}, expected=400 if 'customerId' not in values else 404)
        self.assertEqual([], self.call('GET', '/api/papers'))
        first = self.call('POST','/api/customers',{'name':'同名客户','phone':'13800000001'},expected=201)
        second = self.call('POST','/api/customers',{'name':'同名客户','phone':'13800000002'},expected=201)
        paper = self.call('POST','/api/papers',{'title':'明确归属','customerId':second['id']},expected=201)
        self.assertEqual(0,self.call('GET',f"/api/customers/{first['id']}")['paperCount'])
        self.assertEqual(1,self.call('GET',f"/api/customers/{second['id']}")['paperCount'])
        paper = self.call('PUT',f"/api/papers/{paper['id']}",{'version':paper['version'],'customerId':first['id']})
        self.assertEqual(1,self.call('GET',f"/api/customers/{first['id']}")['paperCount'])
        self.assertEqual(0,self.call('GET',f"/api/customers/{second['id']}")['paperCount'])
        self.call('DELETE',f"/api/customers/{second['id']}",{'version':second['version']})


    def test_migration_of_legacy_encrypted_data_and_backup(self):
        self.process.terminate()
        self.process.wait(timeout=10)
        fixture_path = pathlib.Path(__file__).with_name('LegacyFixture.java')
        subprocess.run(['javac','-encoding','UTF-8','--release','17','-d','out',*[str(p) for p in (ROOT/'src').glob('*.java')],str(fixture_path)],
                       cwd=ROOT,check=True,capture_output=True)
        subprocess.run(['java','-cp','out','LegacyFixture',str(self.data)],cwd=ROOT,check=True,capture_output=True)
        before = (self.data/'papers.vault').read_bytes()
        self.start_server()
        self.csrf = self.call('POST','/api/login',{'username':'test-user','password':'Test-password-2026'})['csrf']
        migrated = self.call('GET','/api/papers')
        self.assertEqual(1,len(migrated))
        paper = migrated[0]
        self.assertEqual('旧写作题目',paper['title'])
        self.assertEqual('旧写作者',paper['writer'])
        self.assertEqual(1,len(paper['submissions']))
        self.assertEqual('旧期刊',paper['submissions'][0]['journal'])
        self.assertIsNone(paper['submissions'][0]['durationDays'])
        self.assertEqual(120000,paper['paidCents'])
        self.assertEqual(1,len(self.call('GET','/api/customers')))
        self.assertEqual(1,self.call('GET',f"/api/customers/{paper['customerId']}")['publishedPaperCount'])
        self.assertEqual('legacy-private-password',self.call('POST',f"/api/papers/{paper['id']}/submissions/{paper['submissions'][0]['id']}/credentials")['password'])
        self.assertEqual(before,(self.data/'papers.vault.bak').read_bytes())
        import base64
        self.call('POST','/api/restore',{'backup':base64.b64encode(before).decode(),'password':'Test-password-2026'})
        self.assertEqual(1,len(self.call('GET','/api/customers')))
        self.process.terminate()
        self.process.wait(timeout=10)
        self.reset_client();self.csrf='';self.start_server()
        self.csrf=self.call('POST','/api/login',{'username':'test-user','password':'Test-password-2026'})['csrf']
        self.assertEqual(1,len(self.call('GET','/api/papers')[0]['submissions']))
