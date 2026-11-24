"""Exercise write-side amount limits, concurrency, and unchanged historical overpayments."""
import base64
import concurrent.futures
import datetime
import subprocess
from test_system import ApiTestCase, ROOT


class FinancialRulesTest(ApiTestCase):
    def finance_paper(self, **changes):
        paper=self.call('POST','/api/papers',{'title':'收付流程校验','serviceType':'full','contractAmount':'5000',
                     'contractDepositAmount':'1000','writerFee':'2000','writerDepositAmount':'500',**changes},expected=201)
        return self.call('GET','/api/papers/'+paper['id'])

    def finance_tx(self,paper,kind,amount,expected=201):
        result=self.call('POST','/api/papers/'+paper['id']+'/transactions',{'version':paper['version'],
                         'type':kind,'amount':amount,'date':datetime.date.today().isoformat()},expected=expected)
        return self.call('GET','/api/papers/'+paper['id']) if expected==201 else result

    def test_receipts_and_direct_writer_payments_cannot_exceed_remaining_agreement(self):
        self.setup_account();paper=self.finance_paper();path='/api/papers/'+paper['id']
        for kind,amount in [('incoming_deposit','28888'),('incoming_deposit','1000.01'),('incoming_balance','4000.01'),
                            ('outgoing_deposit','500.01'),('outgoing_balance','1500.01')]:
            self.finance_tx(paper,kind,amount,expected=400)
            self.assertEqual(paper,self.call('GET',path))
        for kind,amount in [('incoming_deposit','400'),('incoming_deposit','600'),('incoming_balance','4000'),
                            ('outgoing_deposit','200'),('outgoing_deposit','300'),('outgoing_balance','1500')]:
            paper=self.finance_tx(paper,kind,amount)
        self.assertEqual((500000,200000,0,0),(paper['contractReceivedCents'],paper['writerPaidCents'],paper['receivableCents'],paper['payableCents']))
        for kind in ['incoming_deposit','incoming_balance','outgoing_deposit','outgoing_balance']:
            self.finance_tx(paper,kind,'0.01',expected=400)
        paper=self.finance_tx(paper,'incoming_other','12.34');paper=self.finance_tx(paper,'outgoing_other','5.67')
        self.assertEqual((500000,200000,1234,567,300667),(paper['contractReceivedCents'],paper['writerPaidCents'],paper['otherIncomeCents'],paper['otherExpenseCents'],paper['netCents']))

    def test_zero_unspecified_installments_still_cap_totals_and_cents(self):
        self.setup_account();paper=self.finance_paper(contractAmount='0.30',contractDepositAmount='0',writerFee='0.20',writerDepositAmount='0')
        for kind,amount in [('incoming_deposit','0.10'),('incoming_balance','0.20'),('outgoing_deposit','0.04'),('outgoing_balance','0.16')]:
            paper=self.finance_tx(paper,kind,amount)
        self.assertEqual((30,20,10),(paper['contractReceivedCents'],paper['writerPaidCents'],paper['netCents']))
        for kind in ['incoming_deposit','incoming_balance','outgoing_deposit','outgoing_balance']:
            self.finance_tx(paper,kind,'0.01',expected=400)
        empty=self.finance_paper(contractAmount='0',contractDepositAmount='0',writerFee='0',writerDepositAmount='0')
        self.finance_tx(empty,'incoming_deposit','1',expected=400)
        self.finance_tx(empty,'outgoing_deposit','1',expected=400)

    def test_contract_changes_cannot_hide_recorded_receipts_and_failed_edits_are_atomic(self):
        self.setup_account();paper=self.finance_paper();path='/api/papers/'+paper['id']
        paper=self.finance_tx(paper,'incoming_deposit','1000');paper=self.finance_tx(paper,'incoming_balance','2000')
        for changes in [{'contractAmount':'2999'},{'contractDepositAmount':'999'},{'contractDepositAmount':'3500'}]:
            self.call('PUT',path,{'version':paper['version'],'title':'不应保存',**changes},expected=400)
            self.assertEqual(paper,self.call('GET',path))
        paper=self.call('PUT',path,{'version':paper['version'],'contractAmount':'6000'})
        self.assertEqual((600000,300000),(paper['contractCents'],paper['receivableCents']))

    def test_concurrent_or_retried_receipts_record_only_one_payment(self):
        self.setup_account();paper=self.finance_paper();path='/api/papers/'+paper['id']
        payload={'version':paper['version'],'type':'incoming_deposit','amount':'800','date':datetime.date.today().isoformat()}
        # Reuse the existing opener in threads; CookieJar is protected internally.
        def request_status(_):
            import urllib.request,urllib.error,json
            request=urllib.request.Request(self.base+path+'/transactions',data=json.dumps(payload).encode(),method='POST',
                  headers={'Content-Type':'application/json','X-CSRF-Token':self.csrf})
            try:
                with self.client.open(request,timeout=10) as response:return response.code
            except urllib.error.HTTPError as error:
                code=error.code;error.close();return code
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:codes=list(pool.map(request_status,range(2)))
        self.assertEqual([201,409],sorted(codes))
        paper=self.call('GET',path);self.assertEqual((80000,1),(paper['contractReceivedCents'],len(paper['transactions'])))
        self.finance_tx(paper,'incoming_deposit','200.01',expected=400)

    def test_reversing_receipt_reopens_balance_and_legacy_overpayments_remain_readable(self):
        self.setup_account();paper=self.finance_paper();path='/api/papers/'+paper['id']
        paper=self.finance_tx(paper,'incoming_deposit','1000');tx=paper['transactions'][0]
        paper=self.call('POST',path+'/transactions/'+tx['id']+'/reversal',{'version':paper['version'],'reason':'录入错误','confirmReversal':True})
        self.assertEqual((0,500000),(paper['contractReceivedCents'],paper['receivableCents']))
        paper=self.finance_tx(paper,'incoming_deposit','1000')
        backup=self.data/'legacy-receipt.vault';backup.write_bytes(self.call('GET','/api/backup',raw=True))
        helper=self.data/'legacy-finance-classes';helper.mkdir()
        subprocess.run(['javac','-encoding','UTF-8','--release','17','-d',str(helper),
                        *[str(source) for source in (ROOT/'src').glob('*.java')],str(ROOT/'tests'/'LegacyFinanceFixture.java')],cwd=ROOT,check=True,capture_output=True)
        subprocess.run(['java','-cp',str(helper),'LegacyFinanceFixture',str(backup),'Test-password-2026'],cwd=ROOT,check=True,capture_output=True)
        self.call('POST','/api/restore',{'backup':base64.b64encode(backup.read_bytes()).decode(),'password':'Test-password-2026'})
        paper=self.call('GET',path);self.assertEqual(2988800,paper['contractReceivedCents'])
        paper=self.call('PUT',path,{'version':paper['version'],'title':'保留旧金额，允许修改资料'})
        self.assertEqual(2988800,paper['contractReceivedCents'])
        self.finance_tx(paper,'incoming_deposit','0.01',expected=400)
