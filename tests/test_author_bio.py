import base64
from test_system import ApiTestCase


class AuthorBioTest(ApiTestCase):
    def test_full_and_half_biographies_persist_edit_clear_backup_and_restart(self):
        self.setup_account()
        biography='张发栋、1983-6、男、汉族、吉林省松原市人、中级工程师、本科\n研究方向：建筑施工'
        papers=[]
        for service in ['full','half']:
            p=self.call('POST','/api/papers',{'title':'作者简介 '+service,'serviceType':service,'authorBio':biography},expected=201)
            self.assertEqual(biography,p['authorBio']);path='/api/papers/'+p['id']
            p=self.call('PUT',path,{'version':p['version'],'notes':'编辑其他字段'})
            self.assertEqual(biography,p['authorBio'])
            self.call('PUT',path,{'version':p['version'],'authorBio':'a'*2001},expected=400)
            self.assertEqual(biography,self.call('GET',path)['authorBio']);papers.append(p)
        backup=self.call('GET','/api/backup',raw=True)
        path='/api/papers/'+papers[0]['id']
        p=self.call('PUT',path,{'version':papers[0]['version'],'authorBio':''});self.assertEqual('',p['authorBio'])
        self.call('POST','/api/restore',{'backup':base64.b64encode(backup).decode(),'password':'Test-password-2026'})
        self.process.terminate();self.process.wait(timeout=10);self.reset_client();self.start_server()
        self.csrf=self.call('POST','/api/login',{'username':'test-user','password':'Test-password-2026'})['csrf']
        self.assertTrue(all(p['authorBio']==biography for p in self.call('GET','/api/papers')))

    def test_biography_is_optional_for_old_and_new_papers(self):
        self.setup_account()
        p=self.call('POST','/api/papers',{'title':'无简介'},expected=201)
        self.assertEqual('',p['authorBio'])
