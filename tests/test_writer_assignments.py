import base64
import datetime
from test_system import ApiTestCase

class WriterAssignmentTest(ApiTestCase):
    def test_reassignment_cannot_change_customer_terms_or_submission_fields(self):
        self.setup_account()
        p=self.create(writer='Original',writerFee='1000',writerDepositAmount='200',journal='Original journal',publicationFeeMode='free')
        w=self.call('POST','/api/writers',{'name':'Replacement'},expected=201)
        p=self.call('POST',f"/api/papers/{p['id']}/writer-reassignment",{
            'version':p['version'],'writerId':w['id'],'reason':'New specialist',
            'previousSettlement':'100','writerFee':'800','writerDepositAmount':'100',
            'contractAmount':'1','journal':'Injected journal','title':'Injected title'})
        self.assertEqual(800010,p['contractCents'])
        self.assertEqual('Original journal',p['journal'])
        self.assertNotEqual('Injected title',p['title'])

    def test_former_writer_statement_uses_their_own_delivery_dates_and_status(self):
        self.setup_account()
        old_date=(datetime.date.today()-datetime.timedelta(days=5)).isoformat()
        p=self.create(writer='Original',writerFee='1000',writerDepositAmount='200',writingStartAt=old_date,writingDueAt=old_date,writingDeliveredAt=old_date,writingStatus='已交稿')
        old_writer=next(w for w in self.call('GET','/api/writers') if w['name']=='Original')
        w=self.call('POST','/api/writers',{'name':'Replacement'},expected=201)
        self.call('POST',f"/api/papers/{p['id']}/writer-reassignment",{
            'version':p['version'],'writerId':w['id'],'reason':'New specialist',
            'previousSettlement':'100','writerFee':'800','writerDepositAmount':'100'})
        old=self.call('GET','/api/writers/'+old_writer['id'])['papers'][0]
        self.assertEqual('已交稿',old['writingStatus'])
        self.assertEqual(old_date,old['writingDeliveredAt'])
        self.assertEqual(old_writer['id'],old['writerId'])

    def test_reassignment_preserves_owners_settlement_reversal_and_backup(self):
        self.setup_account()
        first=self.call('POST','/api/writers',{'name':'First'},expected=201)
        second=self.call('POST','/api/writers',{'name':'Second'},expected=201)
        p=self.create(writer='',writerId=first['id'],writerFee='1000',writerDepositAmount='200',publicationFeeMode='free')
        path='/api/papers/'+p['id']
        old=p['writerAssignmentId']
        def tx(p,kind,amount,assignment,expected=201):
            return self.call('POST',path+'/transactions',{'version':p['version'],'type':kind,'amount':amount,'date':datetime.date.today().isoformat(),'writerAssignmentId':assignment,'confirmSettlementPayment':True},expected=expected)
        p=tx(p,'outgoing_deposit','200',old)
        p=self.call('POST',path+'/writer-reassignment',{'version':p['version'],'writerId':second['id'],'reason':'new specialist','previousSettlement':'300','writerFee':'800','writerDepositAmount':'100'})
        current=p['writerAssignmentId']
        self.assertEqual(110000,p['totalWriterFeeCents'])
        self.assertEqual(first['id'],p['transactions'][0]['writerId'])
        p=tx(p,'outgoing_settlement','100',old)
        tx(p,'outgoing_settlement','1',old,400)
        p=tx(p,'outgoing_deposit','100',current)
        self.assertEqual(30000,self.call('GET','/api/writers/'+first['id'])['paidCents'])
        self.assertEqual(10000,self.call('GET','/api/writers/'+second['id'])['paidCents'])
        p=tx(p,'outgoing_balance','700',current)
        self.assertEqual(0,p['payableCents'])
        old_tx=next(t for t in p['transactions'] if t['type']=='outgoing_settlement')
        p=self.call('POST',path+'/transactions/'+old_tx['id']+'/reversal',{'version':p['version'],'reason':'wrong transfer','confirmReversal':True})
        self.assertEqual(10000,p['payableCents'])
        self.assertEqual(old,p['transactions'][-1]['writerAssignmentId'])
        p=tx(p,'outgoing_settlement','100',old)
        first=self.call('PUT','/api/writers/'+first['id'],{'version':first['version'],'name':'Renamed'})
        p=self.call('GET',path)
        self.assertEqual('First',p['transactions'][0]['writerName'])
        self.assertEqual('Second',p['writer'])
        p=self.call('POST',path+'/termination',{'version':p['version'],'terminatedAt':datetime.date.today().isoformat(),'terminationReason':'stop','customerSettlement':'0','writerSettlement':'1000','confirmTermination':True})
        self.assertEqual(10000,p['recoverableCents'])
        p=tx(p,'incoming_writer_refund','100',current)
        self.assertEqual(0,p['recoverableCents'])
        backup=self.call('GET','/api/backup',raw=True)
        self.call('POST','/api/restore',{'backup':base64.b64encode(backup).decode(),'password':'Test-password-2026'})
        self.assertEqual(p['writerAssignments'],self.call('GET',path)['writerAssignments'])
        self.process.terminate();self.process.wait(timeout=10);self.reset_client();self.start_server()
        self.csrf=self.call('POST','/api/login',{'username':'test-user','password':'Test-password-2026'})['csrf']
        self.assertEqual(p['writerAssignments'],self.call('GET',path)['writerAssignments'])

    def test_old_writer_refund_does_not_offset_new_writer_payable(self):
        self.setup_account()
        p=self.create(writer='Old',writerFee='1000',writerDepositAmount='200')
        path='/api/papers/'+p['id'];old=p['writerAssignmentId']
        p=self.call('POST',path+'/transactions',{'version':p['version'],'type':'outgoing_deposit','amount':'200','date':datetime.date.today().isoformat()},expected=201)
        new=self.call('POST','/api/writers',{'name':'New'},expected=201)
        p=self.call('POST',path+'/writer-reassignment',{'version':p['version'],'writerId':new['id'],'previousSettlement':'100','writerFee':'500','writerDepositAmount':'0','reason':'rework'})
        self.assertEqual((50000,10000),(p['payableCents'],p['recoverableCents']))
        self.call('POST',path+'/transactions',{'version':p['version'],'type':'outgoing_balance','amount':'501','date':datetime.date.today().isoformat()},expected=400)
        p=self.call('POST',path+'/transactions',{'version':p['version'],'writerAssignmentId':old,'type':'incoming_writer_refund','amount':'100','date':datetime.date.today().isoformat(),'confirmSettlementPayment':True},expected=201)
        self.assertEqual((50000,0),(p['payableCents'],p['recoverableCents']))
