"""Confirmed writing payments are exact, atomic, retry-safe and part of the existing ledger."""
import base64
import uuid
from test_system import ApiTestCase


class WriterPaymentTest(ApiTestCase):
    def paper(self, **values):
        return self.call('POST', '/api/papers', {'title': '稿酬测试', 'serviceType': 'full',
                         'writerFee': '3000', 'writerDepositAmount': '1500', **values}, expected=201)

    @staticmethod
    def payment(kind='deposit', amount='1500', **changes):
        return {'type': 'outgoing_' + kind, 'amount': amount, 'date': '2026-01-01', 'method': '银行转账', **changes}

    def test_terms_alone_do_not_pay_and_confirmed_deposit_and_balance_settle_once(self):
        self.setup_account()
        self.assertTrue(self.call('GET', '/api/session')['writerPaymentsSupported'])
        paper = self.paper()
        path = '/api/papers/' + paper['id']
        self.assertEqual((150000, 150000, 300000, []),
                         (paper['writerDepositCents'], paper['writerBalanceCents'], paper['payableCents'], paper['transactions']))
        paper = self.call('PUT', path, {'version': paper['version'], 'writerPayments': [self.payment()], 'confirmWriterPayments': True})
        self.assertEqual((150000, 150000, 1), (paper['writerPaidCents'], paper['payableCents'], len(paper['transactions'])))
        paper = self.call('PUT', path, {'version': paper['version'], 'title': '编辑不重复付款'})
        self.assertEqual(1, len(paper['transactions']))
        paper = self.call('PUT', path, {'version': paper['version'], 'writerPayments': [self.payment('balance')], 'confirmWriterPayments': True})
        self.assertEqual((300000, 0, 2), (paper['writerPaidCents'], paper['payableCents'], len(paper['transactions'])))
        self.assertEqual(0, paper['receivedCents'])
        self.assertEqual(-300000, paper['netCents'])

    def test_create_with_payment_cannot_duplicate_paper_or_payment_on_retry(self):
        self.setup_account()
        request_id = str(uuid.uuid4())
        payload = {'title': '一并登记实际付款', 'serviceType': 'full', 'writerFee': '3000',
                   'writerDepositAmount': '1500', 'createRequestId': request_id,
                   'writerPayments': [self.payment()], 'confirmWriterPayments': True}
        paper = self.call('POST', '/api/papers', payload, expected=201)
        self.assertEqual(request_id, paper['id'])
        self.assertEqual(150000, paper['payableCents'])
        self.call('POST', '/api/papers', payload, expected=409)
        papers = self.call('GET', '/api/papers')
        self.assertEqual(1, len(papers))
        self.assertEqual(1, len(papers[0]['transactions']))

    def test_bad_payment_batch_rolls_back_terms_and_every_payment(self):
        self.setup_account()
        paper = self.paper()
        path = '/api/papers/' + paper['id']
        paper = self.call('GET', path)
        invalid = [
            {'writerPayments': [self.payment()]},
            {'writerPayments': [self.payment()], 'confirmWriterPayments': 'true'},
            {'writerPayments': '1500', 'confirmWriterPayments': True},
            {'writerPayments': [self.payment(), self.payment()], 'confirmWriterPayments': True},
            {'writerPayments': [self.payment(), self.payment('balance', date='2999-01-01')], 'confirmWriterPayments': True},
            {'writerPayments': [self.payment(amount='1500.01')], 'confirmWriterPayments': True},
            {'writerPayments': [self.payment('balance', '1500.01')], 'confirmWriterPayments': True},
            {'writerPayments': [self.payment(amount='0')], 'confirmWriterPayments': True},
            {'writerPayments': [self.payment(amount='-1')], 'confirmWriterPayments': True},
            {'writerPayments': [self.payment(amount='0.001')], 'confirmWriterPayments': True},
            {'writerPayments': [self.payment(date='')], 'confirmWriterPayments': True},
            {'writerPayments': [self.payment('other')], 'confirmWriterPayments': True},
        ]
        for values in invalid:
            with self.subTest(values=values):
                self.call('PUT', path, {'version': paper['version'], 'title': '不应保存的修改', **values}, expected=400)
                self.assertEqual(paper, self.call('GET', path))
        self.call('POST', '/api/papers', {'title': '失败的新建', 'serviceType': 'full', 'writerFee': '3000',
                  'writerDepositAmount': '1500', 'writerPayments': [self.payment()]}, expected=400)
        self.assertEqual(1, len(self.call('GET', '/api/papers')))

    def test_partial_payments_precision_and_version_prevent_double_counting(self):
        self.setup_account()
        paper = self.paper(writerFee='0.30', writerDepositAmount='0.10')
        path = '/api/papers/' + paper['id']
        payment = {'version': paper['version'], 'writerPayments': [self.payment(amount='0.04')], 'confirmWriterPayments': True}
        paper = self.call('PUT', path, payment)
        self.assertEqual(26, paper['payableCents'])
        self.call('PUT', path, payment, expected=409)
        paper = self.call('PUT', path, {'version': paper['version'], 'writerPayments': [self.payment(amount='0.06'),
                          self.payment('balance', '0.20')], 'confirmWriterPayments': True})
        self.assertEqual((30, 0, 3), (paper['writerPaidCents'], paper['payableCents'], len(paper['transactions'])))
        self.call('PUT', path, {'version': paper['version'], 'writerPayments': [self.payment(amount='0.01')],
                  'confirmWriterPayments': True}, expected=400)

    def test_fee_reductions_cannot_erase_recorded_payments_and_half_has_no_payments(self):
        self.setup_account()
        paper = self.paper(writerPayments=[self.payment(), self.payment('balance', '500')], confirmWriterPayments=True)
        path = '/api/papers/' + paper['id']
        paper = self.call('GET', path)
        for changes in [{'writerFee': '1999'}, {'writerDepositAmount': '1499'}, {'writerDepositAmount': '2700'}]:
            self.call('PUT', path, {'version': paper['version'], **changes}, expected=400)
            self.assertEqual(paper, self.call('GET', path))
        self.call('POST', '/api/papers', {'title': '半包不应支付稿酬', 'serviceType': 'half',
                  'writerPayments': [self.payment()], 'confirmWriterPayments': True}, expected=400)
        self.assertEqual(1, len(self.call('GET', '/api/papers')))

    def test_shortcut_payments_and_existing_ledger_share_calculation_after_restore(self):
        self.setup_account()
        paper = self.paper()
        path = '/api/papers/' + paper['id']
        paper = self.call('POST', path + '/transactions', {'version': paper['version'], **self.payment(),
                          'confirmWriterPayment': True}, expected=201)
        self.assertEqual(150000, paper['payableCents'])
        self.call('POST', path + '/transactions', {'version': paper['version'], **self.payment('balance'),
                  'confirmWriterPayment': False}, expected=400)
        self.call('POST', path + '/transactions', {'version': paper['version'], **self.payment(),
                  'confirmWriterPayment': True}, expected=400)
        paper = self.call('POST', path + '/transactions', {'version': paper['version'], **self.payment('other', '100')}, expected=201)
        self.assertEqual((160000, 150000), (paper['paidCents'], paper['payableCents']))
        backup = self.call('GET', '/api/backup', raw=True)
        self.call('PUT', path, {'version': paper['version'], 'writerPayments': [self.payment('balance')], 'confirmWriterPayments': True})
        self.call('POST', '/api/restore', {'backup': base64.b64encode(backup).decode(), 'password': 'Test-password-2026'})
        paper = self.call('GET', path)
        self.assertEqual((160000, 150000, 2), (paper['paidCents'], paper['payableCents'], len(paper['transactions'])))
