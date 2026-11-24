"""Per-submission costs and append-only correction/receipt invariants."""
import base64
import datetime
import io
import zipfile
import json
import urllib.request
from test_system import ApiTestCase


class CostLedgerTest(ApiTestCase):
    def today(self):
        return datetime.date.today().isoformat()

    def binary(self,path,body,headers,expected=201):
        request=urllib.request.Request(self.base+path,data=body,method='POST',headers={'X-CSRF-Token':self.csrf,**headers})
        with self.client.open(request,timeout=20) as response:
            self.assertEqual(expected,response.status)
            return json.loads(response.read())

    def cost_paper(self):
        self.setup_account()
        p = self.call('POST', '/api/papers', {'title': '投稿分账', 'serviceType': 'half',
            'contractAmount': '5000', 'journal': '旧期刊', 'publicationFeeMode': 'included',
            'publicationFeeAmount': '500'}, expected=201)
        return self.call('GET', '/api/papers/' + p['id'])

    def cost_transaction(self, p, kind, amount, account='', **extra):
        p = self.call('POST', '/api/papers/' + p['id'] + '/transactions', {
            'version': p['version'], 'type': kind, 'amount': amount, 'date': self.today(),
            'publicationAccountId': account, 'confirmPublicationPayment': True, **extra}, expected=201)
        return self.call('GET', '/api/papers/' + p['id'])

    def test_resubmission_never_reuses_old_payment_and_final_loss_counts_in_profit(self):
        p = self.cost_paper(); path = '/api/papers/' + p['id']; old = p['publicationFees'][0]['id']
        p = self.cost_transaction(p, 'outgoing_publication', '500', old)
        p = self.call('POST', path + '/submissions', {'version': p['version'], 'journal': '新期刊',
            'publicationFeeMode': 'included', 'publicationFeeAmount': '1000'}, expected=201)
        p = self.call('GET', path); new = next(a for a in p['publicationFees'] if a['current'])['id']
        self.assertEqual((150000, 50000, 100000, 350000),
            (p['publicationFeeTotalCents'], p['publicationPaidCents'], p['publicationPayableCents'], p['estimatedProfitCents']))
        self.call('POST', path + '/transactions', {'version': p['version'], 'type': 'outgoing_publication',
            'amount': '1', 'date': self.today(), 'confirmPublicationPayment': True}, expected=400)
        p = self.call('PUT', path + '/publication-fee', {'version': p['version'], 'publicationAccountId': old,
            'publicationSettlementStatus': 'confirmed', 'publicationFinalAmount': '500',
            'confirmPublicationFinal': True, 'reason': '核对原期刊不退费用'})
        p = self.cost_transaction(p, 'outgoing_publication', '1000', new)
        p = self.cost_transaction(p, 'incoming_balance', '5000')
        self.assertTrue(p['profitSettled']); self.assertEqual(350000, p['settledProfitCents'])
        self.assertEqual(2, len(p['publicationFees']))
        for a in p['publicationFees']:
            sub = next(s for s in p['submissions'] if s['id'] == a['submissionId'])
            self.call('DELETE', path + '/submissions/' + sub['id'], {'version': sub['version']}, expected=409)

    def test_refunds_and_reversal_limits_stay_inside_their_own_journal(self):
        p = self.cost_paper(); path = '/api/papers/' + p['id']; old = p['publicationFees'][0]['id']
        p = self.cost_transaction(p, 'outgoing_publication', '500', old)
        original = p['transactions'][0]
        p = self.call('POST', path + '/submissions', {'version': p['version'], 'journal': '新期刊',
            'publicationFeeMode': 'included', 'publicationFeeAmount': '1000'}, expected=201)
        p = self.call('GET', path); new = next(a for a in p['publicationFees'] if a['current'])['id']
        self.call('POST', path + '/transactions', {'version': p['version'], 'type': 'incoming_publication_refund',
            'publicationAccountId': new, 'amount': '1', 'date': self.today(), 'confirmPublicationPayment': True}, expected=400)
        p = self.call('PUT', path + '/publication-fee', {'version': p['version'], 'publicationAccountId': old,
            'publicationSettlementStatus': 'confirmed', 'publicationFinalAmount': '200',
            'confirmPublicationFinal': True, 'reason': '核对原期刊最终成本'})
        p = self.cost_transaction(p, 'incoming_publication_refund', '300', old)
        self.assertEqual((120000,100000,0), (p['publicationFeeTotalCents'], p['publicationPayableCents'], p['publicationRefundableCents']))
        self.call('POST', path + '/transactions/' + original['id'] + '/reversal', {
            'version': p['version'], 'reason': '不允许破坏已退款余额', 'confirmReversal': True}, expected=400)
        self.assertEqual(2, len(self.call('GET', path)['transactions']))

    def test_reversal_is_immutable_audited_and_reentry_is_linked(self):
        p = self.cost_paper(); path = '/api/papers/' + p['id']
        p = self.cost_transaction(p, 'incoming_balance', '100')
        original = p['transactions'][0]
        self.call('DELETE', path + '/transactions/' + original['id'], {'version': p['version']}, expected=405)
        for changes in [{'reason': ''}, {'confirmReversal': False}]:
            self.call('POST', path + '/transactions/' + original['id'] + '/reversal', {
                'version': p['version'], 'reason': '金额误录', 'confirmReversal': True, **changes}, expected=400)
        p = self.call('POST', path + '/transactions/' + original['id'] + '/reversal', {
            'version': p['version'], 'reason': '金额误录', 'confirmReversal': True})
        self.assertEqual((0, 2), (p['contractReceivedCents'], len(p['transactions'])))
        self.assertEqual(-10000, p['transactions'][1]['signedAmountCents'])
        self.assertTrue(p['transactions'][0]['reversed'])
        p = self.cost_transaction(p, 'incoming_balance', '80', correctsTransactionId=original['id'])
        self.assertEqual(8000, p['contractReceivedCents'])
        self.assertEqual(original['id'], p['transactions'][-1]['correctsTransactionId'])
        self.assertEqual(['record','reverse','record'], [a['action'] for a in p['financialAudit']])
        self.assertTrue(all(a['actor'] == 'test-user' for a in p['financialAudit']))
        self.call('POST', path + '/transactions/' + original['id'] + '/reversal', {
            'version': p['version'], 'reason': '重复操作', 'confirmReversal': True}, expected=409)
        self.call('DELETE', path, {'version': p['version']}, expected=409)

    def test_receipts_are_separate_encrypted_and_survive_backup_and_restart(self):
        p = self.cost_paper(); path = '/api/papers/' + p['id']
        p = self.cost_transaction(p, 'incoming_balance', '100'); tx = p['transactions'][0]
        pdf = b'%PDF-1.4\nprivate-payment-receipt\n%%EOF'
        p = self.binary(path + '/files', pdf, headers={
            'Content-Type':'application/octet-stream','X-Paper-Version':str(p['version']),
            'X-Transaction-Id':tx['id'],'X-File-Name':'receipt.pdf'})
        receipt = p['files'][0]
        self.assertEqual('receipt', receipt['purpose']); self.assertEqual(tx['id'], receipt['transactionId'])
        self.assertEqual('receipt', p['financialAudit'][-1]['action'])
        self.assertEqual(pdf, self.call('GET', path + '/files/' + receipt['id'], raw=True))
        backup = self.call('GET', '/api/backup', raw=True)
        self.assertNotIn(b'private-payment-receipt', backup)
        self.binary('/api/restore-archive', backup, headers={
            'Content-Type':'application/octet-stream','X-Backup-Password':'Test-password-2026'},expected=200)
        p = self.call('GET', path); restored = p['files'][0]
        self.assertNotEqual(receipt['id'], restored['id'])
        self.assertEqual(restored['id'], p['financialAudit'][-1]['fileId'])
        self.process.terminate(); self.process.wait(timeout=10); self.reset_client(); self.start_server()
        self.csrf = self.call('POST','/api/login',{'username':'test-user','password':'Test-password-2026'})['csrf']
        p = self.call('GET', path); self.assertEqual(tx['id'], p['files'][0]['transactionId'])
        self.assertEqual(10000, p['contractReceivedCents'])
