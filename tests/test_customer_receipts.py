"""Service receipts and writing payments save atomically in their own fee sections."""
import uuid
from test_system import ApiTestCase


class CustomerReceiptsTest(ApiTestCase):
    @staticmethod
    def receipt(kind='deposit',amount='2000',**fields):
        return {'type':'incoming_'+kind,'amount':amount,'date':'2026-01-02',**fields}

    def create(self,**fields):
        return self.call('POST','/api/papers',{'title':'独立费用区域','serviceType':'full',
            'contractAmount':'22000','contractDepositAmount':'2000','writerFee':'14000',
            'writerDepositAmount':'1500',**fields},expected=201)

    def test_create_both_sides_and_retry_edit_without_double_counting(self):
        self.setup_account()
        self.assertTrue(self.call('GET','/api/session')['customerReceiptsSupported'])
        request_id=str(uuid.uuid4())
        fields={'createRequestId':request_id,'customerReceipts':[self.receipt()], 'confirmCustomerReceipts':True,
            'writerPayments':[{'type':'outgoing_deposit','amount':'1500','date':'2026-01-02'}], 'confirmWriterPayments':True}
        p=self.create(**fields)
        self.assertEqual((200000,150000,2000000,1250000,2),(p['contractReceivedCents'],p['writerPaidCents'],p['receivableCents'],p['payableCents'],len(p['transactions'])))
        self.call('POST','/api/papers',{'title':'重复请求',**fields},expected=409)
        path='/api/papers/'+p['id']
        p=self.call('PUT',path,{'version':p['version'],'notes':'不重复收付款'})
        self.assertEqual(2,len(p['transactions']))
        payload={'version':p['version'],'customerReceipts':[self.receipt('balance','20000')],'confirmCustomerReceipts':True}
        p=self.call('PUT',path,payload)
        self.assertEqual((2200000,0,150000),(p['contractReceivedCents'],p['receivableCents'],p['writerPaidCents']))
        self.call('PUT',path,payload,expected=409)
        self.assertEqual(3,len(self.call('GET',path)['transactions']))

    def test_invalid_receipts_roll_back_terms_and_writer_payments(self):
        self.setup_account();p=self.create();path='/api/papers/'+p['id'];p=self.call('GET',path)
        invalid=[{'customerReceipts':[self.receipt()]},
            {'customerReceipts':[self.receipt()],'confirmCustomerReceipts':'true'},
            {'customerReceipts':'bad','confirmCustomerReceipts':True},
            {'customerReceipts':[self.receipt(),self.receipt()],'confirmCustomerReceipts':True},
            {'customerReceipts':[self.receipt(amount='2000.01')],'confirmCustomerReceipts':True},
            {'customerReceipts':[self.receipt(),self.receipt('balance',date='2999-01-01')],'confirmCustomerReceipts':True},
            {'customerReceipts':[self.receipt(type='outgoing_deposit')],'confirmCustomerReceipts':True}]
        for amount in ['0','-1','0.001']:
            invalid.append({'customerReceipts':[self.receipt(amount=amount)],'confirmCustomerReceipts':True})
        for fields in invalid:
            with self.subTest(fields=fields):
                self.call('PUT',path,{'version':p['version'],'title':'不应保存','writerPayments':[{'type':'outgoing_deposit','amount':'1500','date':'2026-01-02'}],'confirmWriterPayments':True,**fields},expected=400)
                self.assertEqual(p,self.call('GET',path))
        self.call('POST','/api/papers',{'title':'失败新建','contractAmount':'22000','customerReceipts':[self.receipt()]},expected=400)
        self.assertEqual(1,len(self.call('GET','/api/papers')))

    def test_half_partial_receipts_and_changed_terms_use_latest_limits(self):
        self.setup_account()
        p=self.call('POST','/api/papers',{'title':'半包收款','serviceType':'half','contractAmount':'0.30','contractDepositAmount':'0.10','customerReceipts':[self.receipt(amount='0.04')],'confirmCustomerReceipts':True},expected=201)
        path='/api/papers/'+p['id']
        self.assertEqual((4,26,0),(p['contractReceivedCents'],p['receivableCents'],p['writerPaidCents']))
        p=self.call('PUT',path,{'version':p['version'],'customerReceipts':[self.receipt(amount='0.06'),self.receipt('balance','0.20')],'confirmCustomerReceipts':True})
        self.assertEqual((30,0,0),(p['contractReceivedCents'],p['receivableCents'],p['writerPaidCents']))
        self.call('PUT',path,{'version':p['version'],'contractDepositAmount':'0.09'},expected=400)
        p=self.call('PUT',path,{'version':p['version'],'contractAmount':'0.50','customerReceipts':[self.receipt('balance','0.20')],'confirmCustomerReceipts':True})
        self.assertEqual((50,0),(p['contractReceivedCents'],p['receivableCents']))


    def test_cumulative_amounts_save_repeat_correct_and_restart_without_duplicate_cash(self):
        self.setup_account()
        p=self.create(customerReceiptTotals={'deposit':'2000','balance':'0'})
        path='/api/papers/'+p['id']
        self.assertEqual((200000,2000000),(p['contractReceivedCents'],p['receivableCents']))
        self.assertEqual(1,len(p['transactions']))
        for unused in range(2):
            p=self.call('PUT',path,{'version':p['version'],'customerReceiptTotals':{'deposit':'2000','balance':'0'}})
        self.assertEqual(1,len(p['transactions']))
        p=self.call('PUT',path,{'version':p['version'],'customerReceiptTotals':{'deposit':'2000','balance':'3000'}})
        self.assertEqual((500000,1700000),(p['contractReceivedCents'],p['receivableCents']))
        p=self.call('PUT',path,{'version':p['version'],'customerReceiptTotals':{'deposit':'1500','balance':'3000'}})
        self.assertEqual((450000,1750000),(p['contractReceivedCents'],p['receivableCents']))
        self.assertTrue(any(t.get('reversalOf') for t in p['transactions']))
        count=len(p['transactions'])
        p=self.call('PUT',path,{'version':p['version'],'customerReceiptTotals':{'deposit':'1500','balance':'3000'}})
        self.assertEqual(count,len(p['transactions']))
        p=self.call('PUT',path,{'version':p['version'],'contractAmount':'4000','contractDepositAmount':'1000','customerReceiptTotals':{'deposit':'1000','balance':'3000'}})
        self.assertEqual((400000,0),(p['contractReceivedCents'],p['receivableCents']))
        self.process.terminate();self.process.wait(timeout=10);self.start_server()
        self.csrf=self.call('POST','/api/login',{'username':'test-user','password':'Test-password-2026'})['csrf']
        self.assertEqual(400000,self.call('GET',path)['contractReceivedCents'])

    def test_invalid_cumulative_values_roll_back_and_cannot_change_other_payments(self):
        self.setup_account();p=self.create(customerReceiptTotals={'deposit':'2000','balance':'0'});path='/api/papers/'+p['id'];p=self.call('GET',path)
        for values in [{'deposit':'2000.01','balance':'0'},{'deposit':'-1','balance':'0'},{'deposit':'0.001','balance':'0'},{'deposit':'2000','balance':'20000.01'},{'deposit':'2000'},'bad']:
            self.call('PUT',path,{'version':p['version'],'title':'invalid','customerReceiptTotals':values},expected=400)
            self.assertEqual(p,self.call('GET',path))
        self.call('PUT',path,{'version':p['version'],'contractAmount':'1000','customerReceiptTotals':{'deposit':'2000','balance':'0'}},expected=400)
        self.assertEqual(p,self.call('GET',path))
