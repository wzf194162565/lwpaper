import base64
import json
from test_system import ApiTestCase
import test_files


class WriterTest(ApiTestCase):
    binary = test_files.AttachmentTest.binary
    upload = test_files.AttachmentTest.upload
    download_file = test_files.AttachmentTest.download_file
    restore_archive = test_files.AttachmentTest.restore_archive

    def test_deletion_clears_current_historical_papers_files_and_survives_restore(self):
        self.setup_account()
        writer=self.call('POST','/api/writers',{'name':'Delete writer'},expected=201)
        replacement=self.call('POST','/api/writers',{'name':'Keep writer'},expected=201)
        current=self.create(writer='',writerId=writer['id'],writerFee='1000',writerDepositAmount='200')
        current_path='/api/papers/'+current['id']
        current=self.call('POST',current_path+'/transactions',{'version':current['version'],
            'type':'outgoing_deposit','amount':'200','date':'2026-01-01'},expected=201)
        current=self.upload(current)
        current=self.upload(current,name='receipt.pdf',**{'X-Transaction-Id':current['transactions'][0]['id']})
        current=self.call('POST',current_path+'/followups',{'version':current['version'],
            'content':'Delete follow-up','date':'2030-01-01'},expected=201)
        historical=self.create(writer='',writerId=writer['id'],writerFee='500',writerDepositAmount='0')
        historical_path='/api/papers/'+historical['id']
        historical=self.call('POST',historical_path+'/writer-reassignment',{'version':historical['version'],
            'writerId':replacement['id'],'previousSettlement':'100','writerFee':'400',
            'writerDepositAmount':'0','reason':'Replacement'})
        historical=self.upload(historical)
        kept=self.upload(self.create(writer='',writerId=replacement['id']))
        kept=self.call('GET','/api/papers/'+kept['id'])
        customer_id=current['customerId']
        before=self.call('GET','/api/papers')
        path='/api/writers/'+writer['id']
        self.call('DELETE',path,{'version':writer['version']},expected=409)
        self.assertEqual(before,self.call('GET','/api/papers'))
        self.assertEqual(4,len(list(self.data.rglob('*.bin'))))
        result=self.call('DELETE',path,{'version':writer['version'],'confirmCascadeDelete':True})
        self.assertEqual(2,result['deletedPaperCount'])
        self.assertEqual({current['id'],historical['id']},set(result['deletedPaperIds']))
        self.assertEqual([kept['id']],[p['id'] for p in self.call('GET','/api/papers')])
        self.assertEqual(kept,self.call('GET','/api/papers/'+kept['id']))
        self.assertEqual([replacement['id']],[w['id'] for w in self.call('GET','/api/writers')])
        self.assertEqual(1,self.call('GET','/api/customers/'+customer_id)['paperCount'])
        for deleted in (current,historical):
            self.call('GET','/api/papers/'+deleted['id'],expected=404)
            for file in deleted['files']:
                self.call('GET',f"/api/papers/{deleted['id']}/files/{file['id']}",expected=404)
        self.assertEqual(test_files.PDF,self.download_file(kept))
        self.assertEqual(1,len(list(self.data.rglob('*.bin'))))
        self.call('GET',path,expected=404)
        self.call('DELETE',path,{'version':writer['version'],'confirmCascadeDelete':True},expected=404)
        backup=self.call('GET','/api/backup',raw=True)
        self.restore_archive(backup)
        self.process.terminate();self.process.wait(timeout=10);self.reset_client();self.start_server()
        self.csrf=self.call('POST','/api/login',{'username':'test-user','password':'Test-password-2026'})['csrf']
        self.assertEqual([kept['id']],[p['id'] for p in self.call('GET','/api/papers')])
        restored=self.call('GET','/api/papers/'+kept['id'])
        # Archive restoration gives files new IDs and updates their audit references.
        def comparable(paper):
            value=json.dumps(paper,sort_keys=True)
            for index,file in enumerate(paper['files']):
                value=value.replace(file['id'],'restored-file-'+str(index))
            return value
        self.assertEqual(comparable(kept),comparable(restored))
        self.assertEqual([replacement['id']],[w['id'] for w in self.call('GET','/api/writers')])
        self.assertEqual(test_files.PDF,self.download_file(restored))
        self.call('GET',path,expected=404)
        recreated=self.call('POST','/api/writers',{'name':writer['name']},expected=201)
        self.assertNotEqual(writer['id'],recreated['id'])
        self.assertEqual(0,recreated['paperCount'])

    def test_cascade_requires_confirmation_and_version_but_not_archived_status(self):
        self.setup_account()
        for status in ('active','paused','archived'):
            writer=self.call('POST','/api/writers',{'name':'Delete '+status},expected=201)
            paper=self.create(writer='',writerId=writer['id'])
            writer=self.call('PUT','/api/writers/'+writer['id'],{'version':writer['version'],'status':status})
            path='/api/writers/'+writer['id']
            before=self.call('GET','/api/papers')
            for confirmation in (None,False,'true'):
                self.call('DELETE',path,{'version':writer['version'],'confirmCascadeDelete':confirmation},expected=409)
            self.call('DELETE',path,{'confirmCascadeDelete':True},expected=400)
            self.call('DELETE',path,{'version':writer['version']-1,'confirmCascadeDelete':True},expected=409)
            self.assertEqual(before,self.call('GET','/api/papers'))
            self.assertEqual(status,self.call('GET',path)['status'])
            deleted=self.call('DELETE',path,{'version':writer['version'],'confirmCascadeDelete':True})
            self.assertEqual([paper['id']],deleted['deletedPaperIds'])
            self.assertEqual([],self.call('GET','/api/papers'))
            self.assertEqual([],self.call('GET','/api/writers'))

    def test_cascade_deletes_terminated_balances_and_preserves_other_accounts(self):
        import datetime
        self.setup_account()
        paper=self.create(writer='Shared name',writerFee='1000',writerDepositAmount='200',publicationFeeMode='free')
        path='/api/papers/'+paper['id']
        paper=self.call('POST',path+'/transactions',{'version':paper['version'],'type':'outgoing_deposit',
            'amount':'200','date':datetime.date.today().isoformat()},expected=201)
        paper=self.call('POST',path+'/termination',{'version':paper['version'],
            'terminatedAt':datetime.date.today().isoformat(),'terminationReason':'Stop',
            'customerSettlement':'0','writerSettlement':'100','confirmTermination':True})
        self.assertEqual(10000,paper['recoverableCents'])
        writer=self.call('GET','/api/writers')[0]
        original_client,original_csrf=self.client,self.csrf
        self.reset_client();self.csrf=self.register_account({'username':'cascade-writer-other','password':'Other-password-2026'})['csrf']
        other=self.create(writer='Shared name')
        other=self.call('GET','/api/papers/'+other['id'])
        self.call('DELETE','/api/writers/'+writer['id'],{'version':writer['version'],'confirmCascadeDelete':True},expected=404)
        other_client,other_csrf=self.client,self.csrf
        self.client,self.csrf=original_client,original_csrf
        self.call('DELETE','/api/writers/'+writer['id'],{'version':writer['version'],'confirmCascadeDelete':True})
        self.assertEqual([],self.call('GET','/api/papers'))
        self.assertEqual([],self.call('GET','/api/writers'))
        backup=self.call('GET','/api/backup',raw=True)
        self.call('POST','/api/restore',{'backup':base64.b64encode(backup).decode(),'password':'Test-password-2026'})
        self.assertEqual([],self.call('GET','/api/papers'))
        self.client,self.csrf=other_client,other_csrf
        self.assertEqual([other['id']],[p['id'] for p in self.call('GET','/api/papers')])
        self.assertEqual(other,self.call('GET','/api/papers/'+other['id']))
        self.assertEqual(1,len(self.call('GET','/api/writers')))

    def test_renaming_writer_updates_current_assignment_and_new_payments_only(self):
        self.setup_account()
        writer=self.call('POST','/api/writers',{'name':'Original writer'},expected=201)
        paper=self.create(writer='',writerId=writer['id'],writerFee='1000',writerDepositAmount='500')
        path='/api/papers/'+paper['id']
        paper=self.call('POST',path+'/transactions',{'version':paper['version'],'type':'outgoing_deposit',
            'amount':'100','date':'2026-01-01'},expected=201)
        paper=self.call('GET',path)
        original_transaction=paper['transactions'][0]
        writer=self.call('PUT','/api/writers/'+writer['id'],{'version':writer['version'],'name':'Renamed writer'})
        paper=self.call('GET',path)
        current=next(a for a in paper['writerAssignments'] if a['current'])
        self.assertEqual('Renamed writer',paper['writer'])
        self.assertEqual('Renamed writer',current['writer'])
        self.assertEqual(original_transaction,paper['transactions'][0])
        paper=self.call('POST',path+'/transactions',{'version':paper['version'],'type':'outgoing_deposit',
            'amount':'100','date':'2026-01-01'},expected=201)
        self.assertEqual('Renamed writer',paper['transactions'][-1]['writerName'])
        paper=self.call('GET',path)
        backup=self.call('GET','/api/backup',raw=True)
        self.call('POST','/api/restore',{'backup':base64.b64encode(backup).decode(),'password':'Test-password-2026'})
        self.process.terminate();self.process.wait(timeout=10);self.reset_client();self.start_server()
        self.csrf=self.call('POST','/api/login',{'username':'test-user','password':'Test-password-2026'})['csrf']
        restored=self.call('GET',path)
        self.assertEqual(paper['writerAssignments'],restored['writerAssignments'])
        self.assertEqual(paper['transactions'],restored['transactions'])
        replacement=self.call('POST','/api/writers',{'name':'Replacement writer'},expected=201)
        restored=self.call('POST',path+'/writer-reassignment',{'version':restored['version'],
            'writerId':replacement['id'],'previousSettlement':'200','writerFee':'800',
            'writerDepositAmount':'100','reason':'Different specialist'})
        restored=self.call('GET',path)
        historical=next(a for a in restored['writerAssignments'] if not a['current'])
        self.call('PUT','/api/writers/'+writer['id'],{'version':writer['version'],'name':'Later name'})
        after=self.call('GET',path)
        self.assertEqual(historical,next(a for a in after['writerAssignments'] if not a['current']))
        self.assertEqual('Replacement writer',after['writer'])

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
