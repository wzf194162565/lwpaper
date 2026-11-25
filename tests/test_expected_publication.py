from test_system import ApiTestCase

class ExpectedPublicationTest(ApiTestCase):
    def test_estimate_is_after_acceptance_and_does_not_publish_article(self):
        self.setup_account()
        p=self.call('POST','/api/papers',{'title':'预计发表日期测试'},expected=201)
        path='/api/papers/'+p['id']+'/submissions'
        payload={'version':p['version'],'journal':'测试期刊','status':'已录用','submittedAt':'2026-01-01','endedAt':'2026-02-01','expectedPublishedAt':'2099-01-01'}
        p=self.call('POST',path,payload,expected=201);s=p['submissions'][0]
        self.assertEqual('2099-01-01',s['expectedPublishedAt']);self.assertEqual('',s['publishedAt']);self.assertEqual('已录用',s['status'])
        for value in ['2026-02-01','2026-01-31']:
            self.call('PUT',path+'/'+s['id'],{'version':s['version'],'expectedPublishedAt':value},expected=400)
        p=self.call('PUT',path+'/'+s['id'],{'version':s['version'],'expectedPublishedAt':'2099-02-01'})
        self.assertEqual('2099-02-01',p['submissions'][0]['expectedPublishedAt'])
        self.assertEqual('',p['submissions'][0]['publishedAt'])

    def test_estimate_is_available_before_acceptance_and_optional(self):
        self.setup_account();p=self.call('POST','/api/papers',{'title':'待录用'},expected=201)
        path='/api/papers/'+p['id']+'/submissions'
        early=self.call('POST',path,{'version':p['version'],'journal':'预排期刊','expectedPublishedAt':'2099-01-01'},expected=201)
        self.assertEqual('2099-01-01',early['submissions'][0]['expectedPublishedAt'])
        self.assertEqual('待投稿',early['submissions'][0]['status'])
        p=early
        p=self.call('POST',path,{'version':p['version'],'journal':'未录用期刊'},expected=201)
        self.assertEqual('',p['submissions'][-1]['expectedPublishedAt'])


    def test_acceptance_requires_explicit_date(self):
        self.setup_account();p=self.call('POST','/api/papers',{'title':'录用日期必填'},expected=201)
        path='/api/papers/'+p['id']+'/submissions'
        self.call('POST',path,{'version':p['version'],'journal':'测试期刊','status':'已录用','submittedAt':'2026-01-01'},expected=400)
        p=self.call('POST',path,{'version':p['version'],'journal':'测试期刊','status':'审稿中','submittedAt':'2026-01-01'},expected=201)
        sub=p['submissions'][0]
        self.call('PUT',path+'/'+sub['id'],{'version':sub['version'],'status':'已录用'},expected=400)
        p=self.call('PUT',path+'/'+sub['id'],{'version':sub['version'],'status':'已录用','endedAt':'2026-01-02','expectedPublishedAt':'2099-01-01'})
        self.assertEqual('2099-01-01',p['submissions'][0]['expectedPublishedAt'])
