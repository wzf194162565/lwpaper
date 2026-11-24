"""Service closure preserves editorial history and settles only confirmed cash movements."""
import base64
import datetime
from test_system import ApiTestCase


class TerminationTest(ApiTestCase):
    def termination_paper(self, **changes):
        paper=self.call('POST', '/api/papers', {'title': '终止服务测试', 'serviceType': 'full',
                         'contractAmount': '3000', 'contractDepositAmount': '1000', 'writerFee': '1500', 'publicationFeeMode':'free',
                         'writerDepositAmount': '500', 'journal': '测试期刊', 'writingStatus': '写作中',
                         'followUpAt': '2030-01-01', 'followUpReason': '联系客户确认', **changes}, expected=201)
        return self.call('GET','/api/papers/'+paper['id'])

    def termination_tx(self, paper, kind, amount, **changes):
        self.call('POST', '/api/papers/' + paper['id'] + '/transactions', {
            'version': paper['version'], 'type': kind, 'amount': amount, 'date': datetime.date.today().isoformat(),
            'confirmSettlementPayment': True, **changes}, expected=201)
        return self.call('GET','/api/papers/'+paper['id'])

    def termination_input(self, paper, **changes):
        return {'version': paper['version'], 'terminatedAt': datetime.date.today().isoformat(),
                'terminationReason': '客户爽约', 'customerSettlement': '600', 'writerSettlement': '400',
                'confirmTermination': True, **changes}

    def test_termination_keeps_editorial_history_and_settles_refund_and_writer_recovery(self):
        self.setup_account()
        paper = self.termination_paper()
        path = '/api/papers/' + paper['id']
        sub = paper['submissions'][0]
        paper = self.call('PUT', path + '/submissions/' + sub['id'], {'version': sub['version'], 'status': '审稿中', 'submittedAt': datetime.date.today().isoformat()})
        paper = self.termination_tx(paper, 'incoming_deposit', '1000')
        paper = self.termination_tx(paper, 'outgoing_deposit', '500')
        original_submissions = paper['submissions']
        paper = self.call('POST', path + '/termination', self.termination_input(paper))
        self.assertEqual('terminated', paper['serviceStatus'])
        self.assertEqual('审稿中', paper['status'])
        self.assertEqual('写作中', paper['writingStatus'])
        self.assertEqual(original_submissions, paper['submissions'])
        self.assertEqual((300000, 150000, 60000, 40000), (paper['contractCents'], paper['writerFeeCents'], paper['settlementContractCents'], paper['settlementWriterFeeCents']))
        self.assertEqual((0, 0, 40000, 10000, False), (paper['receivableCents'], paper['payableCents'], paper['refundableCents'], paper['recoverableCents'], paper['settlementComplete']))
        self.assertEqual(2, len(paper['transactions']))
        paper = self.termination_tx(paper, 'outgoing_refund', '250')
        self.assertEqual((75000, 15000, 10000), (paper['contractReceivedCents'], paper['refundableCents'], paper['recoverableCents']))
        paper = self.termination_tx(paper, 'outgoing_refund', '150')
        paper = self.termination_tx(paper, 'incoming_writer_refund', '100')
        self.assertTrue(paper['settlementComplete'])
        self.assertEqual((60000, 40000, 20000, 0, 0), (paper['contractReceivedCents'], paper['writerPaidCents'], paper['netCents'], paper['otherIncomeCents'], paper['otherExpenseCents']))

    def test_termination_rejects_duplicate_stale_invalid_and_normal_workflow_changes(self):
        self.setup_account()
        paper = self.termination_paper()
        path = '/api/papers/' + paper['id']
        invalid = [{'terminationReason': ''}, {'terminatedAt': '2999-01-01'}, {'terminatedAt': '1000-01-01'},
                   {'customerSettlement': '-1'}, {'customerSettlement': '3001'}, {'writerSettlement': '1501'},
                   {'customerSettlement': ''}, {'writerSettlement': ''}, {'confirmTermination': False}]
        for changes in invalid:
            self.call('POST', path + '/termination', self.termination_input(paper, **changes), expected=400)
            self.assertEqual(paper, self.call('GET', path))
        paper = self.call('POST', path + '/termination', self.termination_input(paper))
        paper = self.call('GET',path)
        self.call('POST', path + '/termination', self.termination_input(paper), expected=409)
        self.call('PUT', path, {'version': paper['version'], 'title': '不允许继续服务'}, expected=409)
        self.call('POST', path + '/submissions', {'publicationFeeMode':'free', 'version': paper['version'], 'journal': '新期刊'}, expected=409)
        sub = paper['submissions'][0]
        self.call('PUT', path + '/submissions/' + sub['id'], {'version': sub['version'], 'status': '已撤稿'}, expected=409)
        self.call('DELETE', path + '/submissions/' + sub['id'], {'version': sub['version']}, expected=409)
        self.call('POST', path + '/transactions', {'version': paper['version'], 'type': 'incoming_balance', 'amount': '1', 'date': datetime.date.today().isoformat()}, expected=400)
        self.call('POST', path + '/transactions', {'version': paper['version'], 'type': 'incoming_settlement', 'amount': '1', 'date': datetime.date.today().isoformat()}, expected=400)
        self.assertEqual(paper, self.call('GET', path))
        updated = self.termination_tx(paper, 'incoming_settlement', '100')
        self.call('POST', path + '/transactions', {'version': paper['version'], 'type': 'incoming_settlement', 'amount': '100', 'date': datetime.date.today().isoformat(), 'confirmSettlementPayment': True}, expected=409)
        self.assertEqual(1, len(updated['transactions']))

    def test_termination_adjustments_and_cash_validation_backup_restart_isolation(self):
        self.setup_account()
        paper = self.termination_paper()
        path = '/api/papers/' + paper['id']
        paper = self.termination_tx(paper, 'incoming_deposit', '1000')
        paper = self.call('POST', path + '/termination', self.termination_input(paper, customerSettlement='1000', writerSettlement='800'))
        self.assertEqual(80000, paper['payableCents'])
        paper = self.termination_tx(paper, 'outgoing_settlement', '800')
        self.assertTrue(paper['settlementComplete'])
        paper = self.call('PUT', path + '/termination', self.termination_input(paper, customerSettlement='500', writerSettlement='800'))
        self.assertEqual(50000, paper['refundableCents'])
        self.call('POST', path + '/transactions', {'version': paper['version'], 'type': 'outgoing_refund', 'amount': '500.01', 'date': datetime.date.today().isoformat(), 'confirmSettlementPayment': True}, expected=400)
        paper = self.termination_tx(paper, 'outgoing_refund', '500')
        receipt = next(tx for tx in paper['transactions'] if tx['type'] == 'incoming_deposit')
        self.call('POST', path + '/transactions/' + receipt['id'] + '/reversal', {'version': paper['version'],'reason':'检查冲销余额','confirmReversal':True}, expected=400)
        self.assertEqual(paper, self.call('GET', path))
        backup = self.call('GET', '/api/backup', raw=True)
        paper = self.call('PUT', path + '/termination', self.termination_input(paper, customerSettlement='1000', writerSettlement='800'))
        self.call('POST', '/api/restore', {'backup': base64.b64encode(backup).decode(), 'password': 'Test-password-2026'})
        self.assertTrue(self.call('GET', path)['settlementComplete'])
        self.process.terminate(); self.process.wait(timeout=10); self.reset_client(); self.start_server()
        self.csrf = self.call('POST', '/api/login', {'username': 'test-user', 'password': 'Test-password-2026'})['csrf']
        restored = self.call('GET', path)
        self.assertEqual('客户爽约', restored['termination']['reason'])
        self.assertEqual((50000, 80000, True), (restored['settlementContractCents'], restored['settlementWriterFeeCents'], restored['settlementComplete']))
        self.csrf = self.call('POST', '/api/register', {'username': 'other-account', 'password': 'Other-password-2026'})['csrf']
        self.call('POST', path + '/termination', self.termination_input(restored), expected=404)
        self.assertEqual([], self.call('GET', '/api/papers'))

    def test_half_termination_needs_no_writer_and_never_changes_original_contract(self):
        self.setup_account()
        paper = self.call('POST', '/api/papers', {'title': '半包服务', 'serviceType': 'half', 'contractAmount': '1000', 'publicationFeeMode':'free'}, expected=201)
        path = '/api/papers/' + paper['id']
        self.call('POST', path + '/termination', self.termination_input(paper), expected=400)
        paper = self.call('POST', path + '/termination', self.termination_input(paper, writerSettlement='0'))
        paper = self.termination_tx(paper, 'incoming_settlement', '600')
        self.assertTrue(paper['settlementComplete']); self.assertEqual(100000, paper['contractCents'])
        self.call('POST', path + '/transactions', {'version': paper['version'], 'type': 'outgoing_settlement', 'amount': '1', 'date': datetime.date.today().isoformat(), 'confirmSettlementPayment': True}, expected=400)
