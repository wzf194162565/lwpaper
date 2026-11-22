"""Relationships, multiple submissions and financial rollups against the real server."""
import base64
import json
import pathlib
import subprocess
from test_system import ApiTestCase, ROOT


class BusinessTest(ApiTestCase):
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
        self.call('DELETE', f"/api/customers/{customer['id']}", {'version': renamed['version']})


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
