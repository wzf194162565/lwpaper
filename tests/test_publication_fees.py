"""Publication costs, author-paid exclusions, cash settlement and persistent accounting."""
import base64
import datetime
from test_system import ApiTestCase


class PublicationFeesTest(ApiTestCase):
    def test_resubmission_reconfirms_fees_preserves_payments_and_updates_profit(self):
        self.setup_account()
        paper=self.publication_paper(publicationFeeMode='included',publicationFeeAmount='800')
        path='/api/papers/'+paper['id']
        paper=self.call('POST',path+'/submissions',{'version':paper['version'],'journal':'Original journal',
            'status':'已拒稿','submittedAt':datetime.date.today().isoformat()},expected=201)
        paper=self.publication_tx(paper,'outgoing_publication','300')
        original=paper['submissions'][0];old_account=paper['publicationFees'][0]['id'];before=paper
        self.call('POST',path+'/submissions',{'version':paper['version'],'journal':'New journal',
            'publicationFeeMode':'included','publicationFeeAmount':'0'},expected=400)
        self.assertEqual(before,self.call('GET',path))
        paper=self.call('POST',path+'/submissions',{'version':paper['version'],'journal':'New journal',
            'publicationFeeMode':'included','publicationFeeAmount':'1200'},expected=201)
        paper=self.call('GET',path)
        self.assertEqual((200000,30000,170000,600000),(paper['publicationFeeTotalCents'],paper['publicationPaidCents'],paper['publicationPayableCents'],paper['estimatedProfitCents']))
        self.assertEqual(original,paper['submissions'][0]);self.assertEqual(before['transactions'],paper['transactions'])
        current=next(a for a in paper['publicationFees'] if a['current'])
        paper=self.call('PUT',path+'/publication-fee',{'version':paper['version'],'publicationAccountId':old_account,
            'publicationSettlementStatus':'confirmed','publicationFinalAmount':'300',
            'confirmPublicationFinal':True,'reason':'核对原期刊不退费用'})
        paper=self.publication_tx(paper,'outgoing_publication','100',publicationAccountId=current['id'])
        active=next(sub for sub in paper['submissions'] if sub['id']==paper['activeSubmissionId'])
        self.call('PUT',path+'/submissions/'+active['id'],{'version':active['version'],'paperVersion':paper['version'],
            'journal':'Cannot overwrite paid journal','publicationFeeMode':'included','publicationFeeAmount':'700'},expected=409)
        self.call('DELETE',path+'/submissions/'+active['id'],{'version':active['version']},expected=409)
        paper=self.call('PUT',path+'/publication-fee',{'version':paper['version'],'publicationAccountId':current['id'],
            'publicationFeeMode':'included','publicationFeeAmount':'700'})
        self.assertEqual((100000,40000,60000,700000),(paper['publicationFeeTotalCents'],paper['publicationPaidCents'],paper['publicationPayableCents'],paper['estimatedProfitCents']))

    def publication_paper(self, **changes):
        paper=self.call('POST','/api/papers',{'title':'版面费核算','serviceType':'full','publicationFeeMode':'free',
            'contractAmount':'10000','contractDepositAmount':'3000','writerFee':'2000',
            'writerDepositAmount':'500',**changes},expected=201)
        return self.call('GET','/api/papers/'+paper['id'])

    def publication_tx(self,paper,kind,amount,expected=201,**changes):
        result=self.call('POST',f"/api/papers/{paper['id']}/transactions",{'version':paper['version'],
            'type':kind,'amount':amount,'date':datetime.date.today().isoformat(),
            'confirmPublicationPayment':True,'confirmSettlementPayment':True,**changes},expected=expected)
        return self.call('GET','/api/papers/'+paper['id']) if expected==201 else result

    def publication_terms(self,paper,**changes):
        self.call('PUT',f"/api/papers/{paper['id']}/publication-fee",{'version':paper['version'],**changes})
        return self.call('GET','/api/papers/'+paper['id'])

    def test_included_fee_is_cost_once_and_cash_is_not_profit_until_settled(self):
        self.setup_account()
        paper=self.publication_paper(publicationFeeMode='included',publicationFeeAmount='1500.25')
        self.assertEqual((150025,649975,0,False,None),(paper['publicationPayableCents'],paper['estimatedProfitCents'],
            paper['netCents'],paper['profitSettled'],paper['settledProfitCents']))
        for kind,amount in [('incoming_deposit','3000'),('outgoing_deposit','500'),('outgoing_publication','500.10')]:
            paper=self.publication_tx(paper,kind,amount)
        self.assertEqual((199990,649975,100015),(paper['netCents'],paper['estimatedProfitCents'],paper['publicationPayableCents']))
        self.assertFalse(paper['profitSettled'])
        for kind,amount in [('incoming_balance','7000'),('outgoing_balance','1500'),('outgoing_publication','1000.15'),
                            ('outgoing_other','20.05'),('incoming_other','10')]:
            paper=self.publication_tx(paper,kind,amount)
        self.assertEqual((648970,648970,648970,True),(paper['estimatedProfitCents'],paper['settledProfitCents'],paper['netCents'],paper['profitSettled']))
        self.assertEqual(200000,paper['writerPaidCents'])
        self.publication_tx(paper,'outgoing_publication','0.01',expected=400)

    def test_author_free_and_pending_modes_never_create_our_page_fee_expense(self):
        self.setup_account()
        for mode in ['pending','free','author']:
            paper=self.publication_paper(publicationFeeMode=mode,publicationFeeAmount='9999')
            self.assertEqual((0,0,0),(paper['publicationFeeCents'],paper['publicationPaidCents'],paper['netCents']))
            self.assertEqual(None if mode=='pending' else 800000,paper['estimatedProfitCents'])
            self.publication_tx(paper,'outgoing_publication','1',expected=400)
            self.publication_tx(paper,'incoming_publication_refund','1',expected=400)
        half=self.publication_paper(serviceType='half',writerFee='0',writerDepositAmount='0',publicationFeeMode='included',publicationFeeAmount='500')
        self.assertEqual(950000,half['estimatedProfitCents'])
        half=self.publication_tx(half,'outgoing_publication','500')
        self.assertEqual((0,50000),(half['publicationPayableCents'],half['publicationPaidCents']))

    def test_payment_confirmation_limits_edits_and_stale_versions_are_atomic(self):
        self.setup_account()
        paper=self.publication_paper(publicationFeeMode='included',publicationFeeAmount='800')
        path='/api/papers/'+paper['id']
        for values in [{'publicationFeeMode':'invalid'},{'publicationFeeMode':'included','publicationFeeAmount':'0'},
                       {'publicationFeeMode':'included','publicationFeeAmount':'-1'},{'publicationFeeAmount':'0.001'}]:
            self.call('PUT',path+'/publication-fee',{'version':paper['version'],**values},expected=400)
            self.assertEqual(paper,self.call('GET',path))
        self.publication_tx(paper,'outgoing_publication','100',expected=400,confirmPublicationPayment=False)
        self.publication_tx(paper,'outgoing_publication','800.01',expected=400)
        paid=self.publication_tx(paper,'outgoing_publication','500')
        self.publication_tx(paper,'outgoing_publication','500',expected=409)
        self.publication_tx(paid,'incoming_publication_refund','500.01',expected=400)
        paper=self.publication_terms(paid,publicationFeeMode='free')
        self.assertEqual((0,50000,1000000-200000),(paper['publicationFeeCents'],paper['publicationRefundableCents'],paper['estimatedProfitCents']))
        paper=self.publication_tx(paper,'incoming_publication_refund','500')
        payment=next(tx for tx in paper['transactions'] if tx['type']=='outgoing_publication')
        self.call('POST',path+'/transactions/'+payment['id']+'/reversal',{'version':paper['version'],'reason':'检查退款关联','confirmReversal':True},expected=400)
        self.assertEqual(paper,self.call('GET',path))
        paper=self.publication_terms(paper,publicationFeeMode='included',publicationFeeAmount='600')
        paper=self.call('PUT',path,{'version':paper['version'],'title':'正常编辑不改变版面费','publicationFeeCents':1})
        self.assertEqual(60000,paper['publicationFeeCents'])

    def test_termination_requires_page_fee_settlement_and_unknown_fee_confirmation(self):
        self.setup_account()
        paper=self.publication_paper(publicationFeeMode='included',publicationFeeAmount='1000')
        paper=self.publication_tx(paper,'incoming_deposit','3000')
        paper=self.publication_tx(paper,'outgoing_deposit','500')
        paper=self.publication_tx(paper,'outgoing_publication','1000')
        path='/api/papers/'+paper['id']
        paper=self.call('POST',path+'/termination',{'version':paper['version'],'terminatedAt':datetime.date.today().isoformat(),
            'terminationReason':'客户终止合作','customerSettlement':'3000','writerSettlement':'500','confirmTermination':True})
        self.assertTrue(paper['settlementComplete']);self.assertEqual(150000,paper['settledProfitCents'])
        paper=self.publication_terms(paper,publicationFeeMode='author')
        self.assertFalse(paper['settlementComplete']);self.assertEqual(100000,paper['publicationRefundableCents'])
        paper=self.publication_tx(paper,'incoming_publication_refund','1000')
        self.assertTrue(paper['settlementComplete']);self.assertEqual(250000,paper['settledProfitCents'])
        paper=self.publication_terms(paper,publicationFeeMode='pending')
        self.assertFalse(paper['settlementComplete']);self.assertIsNone(paper['estimatedProfitCents'])
        paper=self.publication_terms(paper,publicationFeeMode='free')
        self.assertTrue(paper['settlementComplete'])

    def test_fees_and_ledger_survive_restore_restart_and_are_account_isolated(self):
        self.setup_account()
        paper=self.publication_paper(publicationFeeMode='included',publicationFeeAmount='800.15')
        paper=self.publication_tx(paper,'outgoing_publication','100.05')
        path='/api/papers/'+paper['id'];backup=self.call('GET','/api/backup',raw=True)
        changed=self.publication_terms(paper,publicationFeeMode='free')
        self.assertEqual(10005,changed['publicationRefundableCents'])
        self.call('POST','/api/restore',{'backup':base64.b64encode(backup).decode(),'password':'Test-password-2026'})
        self.assertEqual(paper,self.call('GET',path))
        self.process.terminate();self.process.wait(timeout=10);self.reset_client();self.start_server()
        self.csrf=self.call('POST','/api/login',{'username':'test-user','password':'Test-password-2026'})['csrf']
        self.assertEqual(paper,self.call('GET',path))
        self.csrf=self.call('POST','/api/register',{'username':'other-account','password':'Other-password-2026'})['csrf']
        self.call('PUT',path+'/publication-fee',{'version':paper['version'],'publicationFeeMode':'free'},expected=404)
        self.assertEqual([],self.call('GET','/api/papers'))
