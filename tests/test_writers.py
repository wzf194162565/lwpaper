import base64
from test_system import ApiTestCase


class WriterTest(ApiTestCase):
    def test_profiles_legacy_linking_payments_rename_backup_and_isolation(self):
        self.setup_account()
        paper=self.create(writer='Writer One',writerFee='1000',writerDepositAmount='200')
        writer=self.call('GET','/api/writers')[0]
        self.assertEqual(1,writer['paperCount'])
        self.assertEqual(100000,writer['payableCents'])
        path='/api/writers/'+writer['id']
        writer=self.call('PUT',path,{'version':writer['version'],'name':'Writer Renamed','email':'writer@example.test','phone':'123','specialties':'Engineering'})
        fresh=self.call('GET','/api/papers/'+paper['id'])
        self.assertEqual('Writer Renamed',fresh['writer'])
        self.call('PUT',path,{'version':1,'phone':'stale'},expected=409)
        self.call('POST','/api/writers',{'name':'writer renamed'},expected=409)
        self.call('POST',f"/api/papers/{paper['id']}/transactions",{'version':fresh['version'],'type':'outgoing_deposit','amount':'200','date':'2026-01-01','confirmWriterPayment':True},expected=201)
        detail=self.call('GET',path)
        self.assertEqual((20000,80000),(detail['paidCents'],detail['payableCents']))
        self.assertNotIn('submissionPassword',detail['papers'][0])
        self.call('DELETE',path,{'version':detail['version']},expected=409)
        backup=self.call('GET','/api/backup',raw=True)
        self.call('PUT',path,{'version':detail['version'],'specialties':'Changed','status':'archived'})
        self.call('POST','/api/restore',{'backup':base64.b64encode(backup).decode(),'password':'Test-password-2026'})
        self.assertEqual('Engineering',self.call('GET',path)['specialties'])
        self.process.terminate();self.process.wait(timeout=10)
        self.reset_client();self.start_server()
        self.csrf=self.call('POST','/api/login',{'username':'test-user','password':'Test-password-2026'})['csrf']
        self.assertEqual('Engineering',self.call('GET',path)['specialties'])
        other=self.call('POST','/api/writers',{'name':'Unassigned'},expected=201)
        self.call('DELETE','/api/writers/'+other['id'],{'version':other['version']})
        first_client,first_csrf=self.client,self.csrf
        self.reset_client();self.csrf=self.register_account({'username':'writer-other-user','password':'Other-password-2026'})['csrf']
        self.assertEqual([],self.call('GET','/api/writers'))
        self.call('GET',path,expected=404)
        self.client,self.csrf=first_client,first_csrf
        self.assertEqual(1,len(self.call('GET','/api/writers')))

    def test_invalid_profile_and_reassignment_do_not_merge_accounts(self):
        self.setup_account()
        self.call('POST','/api/writers',{'name':'','email':'bad'},expected=400)
        self.call('POST','/api/writers',{'name':'Invalid','email':'bad'},expected=400)
        first=self.call('POST','/api/writers',{'name':'First'},expected=201)
        second=self.call('POST','/api/writers',{'name':'Second'},expected=201)
        paper=self.create(writer='First')
        self.call('PUT','/api/writers/'+first['id'],{'version':first['version'],'name':'Second'},expected=409)
        self.assertEqual('First',self.call('GET','/api/papers/'+paper['id'])['writer'])
        self.call('PUT','/api/papers/'+paper['id'],{'version':paper['version'],'writer':'Second'},expected=409)
        self.call('POST','/api/papers/'+paper['id']+'/writer-reassignment',{'version':paper['version'],'writerId':second['id'],'reason':'Replacement','previousSettlement':'0','writerFee':'1000','writerDepositAmount':'200'})
        self.assertEqual(1,self.call('GET','/api/writers/'+first['id'])['paperCount'])
        self.assertEqual(1,self.call('GET','/api/writers/'+second['id'])['paperCount'])

    def test_terminated_settlement_and_half_papers(self):
        self.setup_account()
        paper=self.create(writer='Settlement writer',writerFee='1000',writerDepositAmount='200',publicationFeeMode='free')
        paper=self.call('POST',f"/api/papers/{paper['id']}/transactions",{'version':paper['version'],'type':'outgoing_deposit','amount':'200','date':'2026-01-01'},expected=201)
        import datetime
        paper=self.call('POST',f"/api/papers/{paper['id']}/termination",{'version':paper['version'],'terminatedAt':datetime.date.today().isoformat(),'terminationReason':'test','customerSettlement':'0','writerSettlement':'100','confirmTermination':True})
        self.create(serviceType='half',writer='',writerFee='0')
        writer=self.call('GET','/api/writers')[0]
        self.assertEqual((1,0,10000,20000,0,10000),(writer['paperCount'],writer['activeCount'],writer['agreedCents'],writer['paidCents'],writer['payableCents'],writer['recoverableCents']))
